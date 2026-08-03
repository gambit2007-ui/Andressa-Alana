alter table public.contracts
  add column if not exists deposit_as_first_installment boolean not null default false;

create or replace function public.create_contract_with_installments(
  p_organization_id uuid,
  p_client_id uuid,
  p_device_id uuid,
  p_start_date date,
  p_due_day integer,
  p_term_months integer,
  p_monthly_amount numeric,
  p_deposit_amount numeric,
  p_late_fee_percent numeric,
  p_daily_interest_percent numeric,
  p_purchase_option boolean,
  p_purchase_option_amount numeric
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  contract_id uuid := gen_random_uuid();
  contract_ref text;
  upfront_installment_id uuid;
  upfront_payment_id uuid;
  month_start date;
  due_date_value date;
  installment_offset integer := case when p_deposit_amount > 0 then 1 else 0 end;
  i integer;
begin
  if p_organization_id <> public.current_organization_id()
    or not public.has_role(array['admin', 'manager', 'operator']) then
    raise exception 'Sem permissao para criar contrato';
  end if;

  if p_start_date is null
    or p_due_day not between 1 and 31
    or p_term_months not between 1 and 60
    or p_monthly_amount <= 0
    or p_deposit_amount < 0
    or p_late_fee_percent < 0
    or p_daily_interest_percent < 0
    or (p_purchase_option and coalesce(p_purchase_option_amount, -1) < 0) then
    raise exception 'Condicoes contratuais invalidas';
  end if;

  perform 1
  from public.rental_clients
  where id = p_client_id
    and organization_id = p_organization_id;
  if not found then
    raise exception 'Cliente invalido';
  end if;

  update public.devices
  set status = 'rented'
  where id = p_device_id
    and organization_id = p_organization_id
    and status = 'available';
  if not found then
    raise exception 'Aparelho indisponivel';
  end if;

  contract_ref := 'GR-' || to_char(p_start_date, 'YYYY') || '-' || upper(substr(replace(contract_id::text, '-', ''), 1, 8));

  insert into public.contracts(
    id,
    organization_id,
    client_id,
    device_id,
    contract_number,
    start_date,
    end_date,
    due_day,
    term_months,
    monthly_amount,
    deposit_amount,
    deposit_as_first_installment,
    late_fee_percent,
    daily_interest_percent,
    purchase_option,
    purchase_option_amount,
    status
  ) values (
    contract_id,
    p_organization_id,
    p_client_id,
    p_device_id,
    contract_ref,
    p_start_date,
    (p_start_date + make_interval(months => p_term_months + installment_offset))::date,
    p_due_day,
    p_term_months,
    p_monthly_amount,
    p_deposit_amount,
    installment_offset = 1,
    p_late_fee_percent,
    p_daily_interest_percent,
    p_purchase_option,
    case when p_purchase_option then p_purchase_option_amount else null end,
    'active'
  );

  if installment_offset = 1 then
    insert into public.installments(
      organization_id,
      contract_id,
      installment_number,
      due_date,
      original_amount,
      paid_amount,
      status
    ) values (
      p_organization_id,
      contract_id,
      1,
      p_start_date,
      p_deposit_amount,
      p_deposit_amount,
      'paid'
    ) returning id into upfront_installment_id;

    insert into public.payments(
      organization_id,
      installment_id,
      amount,
      method,
      paid_at,
      status,
      external_reference,
      notes
    ) values (
      p_organization_id,
      upfront_installment_id,
      p_deposit_amount,
      'other',
      now(),
      'confirmed',
      'upfront_deposit',
      'Caucao recebida como primeira parcela'
    ) returning id into upfront_payment_id;

    insert into public.cash_transactions(
      organization_id,
      device_id,
      contract_id,
      payment_id,
      kind,
      direction,
      amount,
      occurred_on,
      description
    ) values (
      p_organization_id,
      p_device_id,
      contract_id,
      upfront_payment_id,
      'rental_payment',
      'in',
      p_deposit_amount,
      current_date,
      'Caucao recebida como primeira parcela do contrato ' || contract_ref
    );

    insert into public.deposits(
      organization_id,
      contract_id,
      amount,
      status,
      received_at,
      resolved_at,
      notes
    ) values (
      p_organization_id,
      contract_id,
      p_deposit_amount,
      'applied',
      now(),
      now(),
      'Aplicada como primeira parcela paga'
    );
  else
    insert into public.deposits(organization_id, contract_id, amount)
    values (p_organization_id, contract_id, 0);
  end if;

  for i in 1..p_term_months loop
    month_start := (date_trunc('month', p_start_date)::date + make_interval(months => i))::date;
    due_date_value := month_start + (least(p_due_day, extract(day from (month_start + interval '1 month - 1 day'))::integer) - 1);

    insert into public.installments(
      organization_id,
      contract_id,
      installment_number,
      due_date,
      original_amount
    ) values (
      p_organization_id,
      contract_id,
      i + installment_offset,
      due_date_value,
      p_monthly_amount
    );
  end loop;

  insert into public.device_events(organization_id, device_id, event_type, description, metadata)
  values (
    p_organization_id,
    p_device_id,
    'rented',
    'Aparelho vinculado ao contrato ' || contract_ref,
    jsonb_build_object('contract_id', contract_id)
  );

  return contract_id;
end $$;

create or replace function public.update_contract_with_installments(
  p_contract_id uuid,
  p_client_id uuid,
  p_device_id uuid,
  p_start_date date,
  p_due_day integer,
  p_term_months integer,
  p_monthly_amount numeric,
  p_deposit_amount numeric,
  p_late_fee_percent numeric,
  p_daily_interest_percent numeric,
  p_purchase_option boolean,
  p_purchase_option_amount numeric
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  contract_row public.contracts%rowtype;
  deposit_row public.deposits%rowtype;
  previous_values jsonb;
  upfront_installment_id uuid;
  upfront_payment_id uuid;
  month_start date;
  due_date_value date;
  use_upfront boolean;
  installment_offset integer;
  has_overdue boolean := false;
  i integer;
begin
  select * into contract_row
  from public.contracts
  where id = p_contract_id
  for update;

  if not found
    or contract_row.organization_id <> public.current_organization_id()
    or not public.has_role(array['admin', 'manager', 'operator']) then
    raise exception 'Contrato invalido ou sem permissao para edicao';
  end if;

  if contract_row.status not in ('active', 'overdue') then
    raise exception 'Somente contratos ativos ou inadimplentes podem ser editados';
  end if;

  if exists (
    select 1
    from public.payments payment
    join public.installments installment on installment.id = payment.installment_id
    where installment.contract_id = p_contract_id
      and not (
        payment.external_reference = 'upfront_deposit'
        and payment.status = 'confirmed'
      )
  ) then
    raise exception 'Contrato com mensalidades pagas nao pode ser alterado; use renegociacao';
  end if;

  select installment.id, payment.id
  into upfront_installment_id, upfront_payment_id
  from public.payments payment
  join public.installments installment on installment.id = payment.installment_id
  where installment.contract_id = p_contract_id
    and payment.external_reference = 'upfront_deposit'
    and payment.status = 'confirmed'
  limit 1;

  if contract_row.deposit_as_first_installment and upfront_payment_id is null then
    raise exception 'Recebimento inicial do contrato nao foi localizado';
  end if;

  if contract_row.deposit_as_first_installment
    and contract_row.deposit_amount <> p_deposit_amount then
    raise exception 'Caucao ja recebida nao pode ter o valor alterado';
  end if;

  if exists (
    select 1
    from public.billing_notifications notification
    join public.installments installment on installment.id = notification.installment_id
    where installment.contract_id = p_contract_id
      and notification.status in ('sent', 'delivered')
  ) then
    raise exception 'Contrato com cobrancas enviadas nao pode ser alterado; use renegociacao';
  end if;

  if p_start_date is null
    or p_due_day not between 1 and 31
    or p_term_months not between 1 and 60
    or p_monthly_amount <= 0
    or p_deposit_amount < 0
    or p_late_fee_percent < 0
    or p_daily_interest_percent < 0
    or (p_purchase_option and coalesce(p_purchase_option_amount, -1) < 0) then
    raise exception 'Condicoes contratuais invalidas';
  end if;

  perform 1
  from public.rental_clients
  where id = p_client_id
    and organization_id = contract_row.organization_id;
  if not found then
    raise exception 'Cliente invalido';
  end if;

  if p_device_id <> contract_row.device_id then
    perform 1
    from public.devices
    where id = p_device_id
      and organization_id = contract_row.organization_id
      and status = 'available'
    for update;
    if not found then
      raise exception 'Aparelho indisponivel';
    end if;
  end if;

  select * into deposit_row
  from public.deposits
  where contract_id = p_contract_id
  for update;

  if not contract_row.deposit_as_first_installment
    and deposit_row.id is not null
    and deposit_row.status <> 'pending' then
    raise exception 'Caucao ja movimentada nao pode ser convertida em parcela';
  end if;

  use_upfront := contract_row.deposit_as_first_installment or p_deposit_amount > 0;
  installment_offset := case when use_upfront then 1 else 0 end;
  previous_values := to_jsonb(contract_row);

  delete from public.billing_notifications
  where installment_id in (
    select id
    from public.installments
    where contract_id = p_contract_id
      and (upfront_installment_id is null or id <> upfront_installment_id)
  );

  delete from public.installments
  where contract_id = p_contract_id
    and (upfront_installment_id is null or id <> upfront_installment_id);

  if contract_row.deposit_as_first_installment then
    update public.installments
    set due_date = p_start_date
    where id = upfront_installment_id;
  elsif use_upfront then
    insert into public.installments(
      organization_id,
      contract_id,
      installment_number,
      due_date,
      original_amount,
      paid_amount,
      status
    ) values (
      contract_row.organization_id,
      p_contract_id,
      1,
      p_start_date,
      p_deposit_amount,
      p_deposit_amount,
      'paid'
    ) returning id into upfront_installment_id;

    insert into public.payments(
      organization_id,
      installment_id,
      amount,
      method,
      paid_at,
      status,
      external_reference,
      notes
    ) values (
      contract_row.organization_id,
      upfront_installment_id,
      p_deposit_amount,
      'other',
      now(),
      'confirmed',
      'upfront_deposit',
      'Caucao recebida como primeira parcela'
    ) returning id into upfront_payment_id;

    insert into public.cash_transactions(
      organization_id,
      device_id,
      contract_id,
      payment_id,
      kind,
      direction,
      amount,
      occurred_on,
      description
    ) values (
      contract_row.organization_id,
      p_device_id,
      p_contract_id,
      upfront_payment_id,
      'rental_payment',
      'in',
      p_deposit_amount,
      current_date,
      'Caucao recebida como primeira parcela do contrato ' || contract_row.contract_number
    );
  end if;

  update public.contracts
  set client_id = p_client_id,
      device_id = p_device_id,
      start_date = p_start_date,
      end_date = (p_start_date + make_interval(months => p_term_months + installment_offset))::date,
      due_day = p_due_day,
      term_months = p_term_months,
      monthly_amount = p_monthly_amount,
      deposit_amount = p_deposit_amount,
      deposit_as_first_installment = use_upfront,
      late_fee_percent = p_late_fee_percent,
      daily_interest_percent = p_daily_interest_percent,
      purchase_option = p_purchase_option,
      purchase_option_amount = case when p_purchase_option then p_purchase_option_amount else null end
  where id = p_contract_id;

  for i in 1..p_term_months loop
    month_start := (date_trunc('month', p_start_date)::date + make_interval(months => i))::date;
    due_date_value := month_start + (least(p_due_day, extract(day from (month_start + interval '1 month - 1 day'))::integer) - 1);
    has_overdue := has_overdue or due_date_value < current_date;

    insert into public.installments(
      organization_id,
      contract_id,
      installment_number,
      due_date,
      original_amount,
      status
    ) values (
      contract_row.organization_id,
      p_contract_id,
      i + installment_offset,
      due_date_value,
      p_monthly_amount,
      case when due_date_value < current_date then 'overdue'::public.installment_status else 'pending'::public.installment_status end
    );
  end loop;

  update public.contracts
  set status = case when has_overdue then 'overdue'::public.contract_status else 'active'::public.contract_status end
  where id = p_contract_id;

  if p_device_id <> contract_row.device_id then
    update public.devices
    set status = 'available'
    where id = contract_row.device_id
      and status = 'rented';

    update public.devices
    set status = 'rented'
    where id = p_device_id;

    update public.cash_transactions
    set device_id = p_device_id
    where payment_id = upfront_payment_id;

    insert into public.device_events(organization_id, device_id, event_type, description, metadata)
    values
      (
        contract_row.organization_id,
        contract_row.device_id,
        'contract_changed',
        'Aparelho removido do contrato ' || contract_row.contract_number,
        jsonb_build_object('contract_id', p_contract_id)
      ),
      (
        contract_row.organization_id,
        p_device_id,
        'contract_changed',
        'Aparelho vinculado ao contrato ' || contract_row.contract_number,
        jsonb_build_object('contract_id', p_contract_id)
      );
  end if;

  if use_upfront then
    if deposit_row.id is null then
      insert into public.deposits(
        organization_id,
        contract_id,
        amount,
        status,
        received_at,
        resolved_at,
        notes
      ) values (
        contract_row.organization_id,
        p_contract_id,
        p_deposit_amount,
        'applied',
        now(),
        now(),
        'Aplicada como primeira parcela paga'
      );
    elsif not contract_row.deposit_as_first_installment then
      update public.deposits
      set amount = p_deposit_amount,
          status = 'applied',
          received_at = coalesce(received_at, now()),
          resolved_at = now(),
          notes = 'Aplicada como primeira parcela paga'
      where id = deposit_row.id;
    end if;
  elsif deposit_row.id is null then
    insert into public.deposits(organization_id, contract_id, amount)
    values (contract_row.organization_id, p_contract_id, 0);
  elsif deposit_row.status = 'pending' then
    update public.deposits
    set amount = 0
    where id = deposit_row.id;
  end if;

  insert into public.contract_amendments(
    organization_id,
    contract_id,
    amendment_type,
    effective_date,
    reason,
    previous_values,
    new_values
  ) values (
    contract_row.organization_id,
    p_contract_id,
    'other',
    current_date,
    'Correcao contratual pelo painel',
    previous_values,
    jsonb_build_object(
      'client_id', p_client_id,
      'device_id', p_device_id,
      'start_date', p_start_date,
      'due_day', p_due_day,
      'remaining_installments', p_term_months,
      'total_installments', p_term_months + installment_offset,
      'monthly_amount', p_monthly_amount,
      'deposit_amount', p_deposit_amount,
      'deposit_as_first_installment', use_upfront,
      'late_fee_percent', p_late_fee_percent,
      'daily_interest_percent', p_daily_interest_percent,
      'purchase_option', p_purchase_option,
      'purchase_option_amount', case when p_purchase_option then p_purchase_option_amount else null end
    )
  );

  return p_contract_id;
end $$;

revoke all on function public.create_contract_with_installments(uuid, uuid, uuid, date, integer, integer, numeric, numeric, numeric, numeric, boolean, numeric) from public;
grant execute on function public.create_contract_with_installments(uuid, uuid, uuid, date, integer, integer, numeric, numeric, numeric, numeric, boolean, numeric) to authenticated;

revoke all on function public.update_contract_with_installments(uuid, uuid, uuid, date, integer, integer, numeric, numeric, numeric, numeric, boolean, numeric) from public;
grant execute on function public.update_contract_with_installments(uuid, uuid, uuid, date, integer, integer, numeric, numeric, numeric, numeric, boolean, numeric) to authenticated;
