create or replace function public.record_client_payment(
  p_client_id uuid,
  p_amount numeric,
  p_method text,
  p_paid_at timestamptz,
  p_notes text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  organization_id_value uuid := public.current_organization_id();
  batch_reference text := 'client_payment:' || gen_random_uuid()::text;
  client_balance numeric := 0;
  remaining_amount numeric := p_amount;
  allocation_amount numeric;
  total_due numeric;
  payment_id_value uuid;
  installment_row record;
begin
  if organization_id_value is null
    or not public.has_role(array['admin', 'manager', 'finance']) then
    raise exception 'Sem permissao para registrar recebimento';
  end if;

  perform 1
  from public.rental_clients
  where id = p_client_id
    and organization_id = organization_id_value;
  if not found then
    raise exception 'Cliente invalido';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Valor de pagamento invalido';
  end if;

  if p_method is null or p_method not in ('pix', 'card', 'transfer', 'cash', 'other') then
    raise exception 'Meio de pagamento invalido';
  end if;

  if p_paid_at is null then
    raise exception 'Data de pagamento invalida';
  end if;

  perform installment.id
  from public.installments installment
  join public.contracts contract on contract.id = installment.contract_id
  where contract.client_id = p_client_id
    and contract.organization_id = organization_id_value
    and contract.status in ('active', 'overdue')
    and installment.status in ('pending', 'partial', 'overdue')
    and installment.paid_amount < installment.original_amount
      + installment.late_fee_amount
      + installment.interest_amount
      - installment.discount_amount
  order by installment.due_date, installment.installment_number
  for update of installment;

  select coalesce(sum(greatest(
    0,
    installment.original_amount
      + installment.late_fee_amount
      + installment.interest_amount
      - installment.discount_amount
      - installment.paid_amount
  )), 0)
  into client_balance
  from public.installments installment
  join public.contracts contract on contract.id = installment.contract_id
  where contract.client_id = p_client_id
    and contract.organization_id = organization_id_value
    and contract.status in ('active', 'overdue')
    and installment.status in ('pending', 'partial', 'overdue');

  if client_balance <= 0 then
    raise exception 'Cliente sem saldo em aberto';
  end if;

  if p_amount > client_balance + 0.009 then
    raise exception 'Pagamento maior que o saldo total do cliente';
  end if;

  for installment_row in
    select
      installment.*,
      contract.device_id,
      contract.contract_number,
      contract.deposit_as_first_installment
    from public.installments installment
    join public.contracts contract on contract.id = installment.contract_id
    where contract.client_id = p_client_id
      and contract.organization_id = organization_id_value
      and contract.status in ('active', 'overdue')
      and installment.status in ('pending', 'partial', 'overdue')
      and installment.paid_amount < installment.original_amount
        + installment.late_fee_amount
        + installment.interest_amount
        - installment.discount_amount
    order by installment.due_date, installment.installment_number
  loop
    exit when remaining_amount <= 0.009;

    total_due := installment_row.original_amount
      + installment_row.late_fee_amount
      + installment_row.interest_amount
      - installment_row.discount_amount;
    allocation_amount := least(remaining_amount, total_due - installment_row.paid_amount);

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
      organization_id_value,
      installment_row.id,
      allocation_amount,
      p_method,
      p_paid_at,
      'confirmed',
      batch_reference,
      coalesce(nullif(trim(p_notes), ''), 'Recebimento consolidado do cliente')
    ) returning id into payment_id_value;

    update public.installments
    set paid_amount = paid_amount + allocation_amount,
        status = case
          when paid_amount + allocation_amount >= total_due - 0.009 then 'paid'::public.installment_status
          else 'partial'::public.installment_status
        end
    where id = installment_row.id;

    if installment_row.deposit_as_first_installment
      and installment_row.installment_number = 1 then
      update public.deposits
      set status = 'applied',
          received_at = coalesce(received_at, p_paid_at),
          resolved_at = p_paid_at,
          notes = 'Aplicada como primeira parcela paga'
      where contract_id = installment_row.contract_id;
    end if;

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
      organization_id_value,
      installment_row.device_id,
      installment_row.contract_id,
      payment_id_value,
      'rental_payment',
      'in',
      allocation_amount,
      p_paid_at::date,
      'Recebimento do cliente no contrato ' || installment_row.contract_number
    );

    remaining_amount := remaining_amount - allocation_amount;
  end loop;

  if remaining_amount > 0.009 then
    raise exception 'Nao foi possivel distribuir todo o pagamento';
  end if;

  update public.contracts contract
  set status = case
    when exists (
      select 1
      from public.installments installment
      where installment.contract_id = contract.id
        and installment.status = 'overdue'
    ) then 'overdue'::public.contract_status
    else 'active'::public.contract_status
  end
  where contract.client_id = p_client_id
    and contract.organization_id = organization_id_value
    and contract.status in ('active', 'overdue');

  return batch_reference;
end $$;

create or replace function public.reverse_payment(
  p_payment_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_payment public.payments%rowtype;
  target_installment public.installments%rowtype;
  target_contract public.contracts%rowtype;
  batch_reference text;
  total_refund numeric := 0;
  remaining_paid numeric;
  total_due numeric;
  affected_contract_ids uuid[] := array[]::uuid[];
  payment_row record;
begin
  select * into target_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found
    or target_payment.organization_id <> public.current_organization_id()
    or not public.has_role(array['admin', 'manager', 'finance']) then
    raise exception 'Pagamento invalido ou sem permissao';
  end if;

  if target_payment.status = 'reversed' then
    raise exception 'Pagamento ja estornado';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Informe o motivo do estorno';
  end if;

  select * into target_installment
  from public.installments
  where id = target_payment.installment_id;

  select * into target_contract
  from public.contracts
  where id = target_installment.contract_id;

  batch_reference := case
    when target_payment.external_reference like 'client_payment:%' then target_payment.external_reference
    else null
  end;

  for payment_row in
    select
      payment.id as payment_id,
      payment.amount as payment_amount,
      payment.external_reference,
      installment.id as installment_id,
      installment.paid_amount as installment_paid_amount,
      installment.original_amount,
      installment.discount_amount,
      installment.late_fee_amount,
      installment.interest_amount,
      installment.due_date,
      installment.contract_id,
      installment.installment_number,
      contract.deposit_as_first_installment
    from public.payments payment
    join public.installments installment on installment.id = payment.installment_id
    join public.contracts contract on contract.id = installment.contract_id
    where payment.organization_id = target_payment.organization_id
      and payment.status = 'confirmed'
      and (
        (batch_reference is not null and payment.external_reference = batch_reference)
        or (batch_reference is null and payment.id = target_payment.id)
      )
    order by payment.created_at
    for update of payment, installment
  loop
    total_due := payment_row.original_amount
      + payment_row.late_fee_amount
      + payment_row.interest_amount
      - payment_row.discount_amount;
    remaining_paid := greatest(0, payment_row.installment_paid_amount - payment_row.payment_amount);

    update public.payments
    set status = 'reversed',
        reversed_at = now(),
        reversal_reason = trim(p_reason)
    where id = payment_row.payment_id;

    update public.installments
    set paid_amount = remaining_paid,
        status = case
          when remaining_paid >= total_due - 0.009 then 'paid'::public.installment_status
          when remaining_paid > 0 then 'partial'::public.installment_status
          when due_date < current_date then 'overdue'::public.installment_status
          else 'pending'::public.installment_status
        end
    where id = payment_row.installment_id;

    if payment_row.deposit_as_first_installment
      and payment_row.installment_number = 1 then
      update public.deposits
      set status = 'pending',
          resolved_at = now(),
          notes = 'Estornada: ' || trim(p_reason)
      where contract_id = payment_row.contract_id;
    end if;

    if not payment_row.contract_id = any(affected_contract_ids) then
      affected_contract_ids := array_append(affected_contract_ids, payment_row.contract_id);
    end if;

    total_refund := total_refund + payment_row.payment_amount;
  end loop;

  if total_refund <= 0 then
    raise exception 'Nenhum pagamento confirmado para estornar';
  end if;

  update public.contracts contract
  set status = case
    when exists (
      select 1
      from public.installments installment
      where installment.contract_id = contract.id
        and installment.status = 'overdue'
    ) then 'overdue'::public.contract_status
    else 'active'::public.contract_status
  end
  where contract.id = any(affected_contract_ids)
    and contract.status in ('active', 'overdue');

  insert into public.cash_transactions(
    organization_id,
    device_id,
    contract_id,
    kind,
    direction,
    amount,
    occurred_on,
    description
  ) values (
    target_payment.organization_id,
    case when batch_reference is null then target_contract.device_id else null end,
    case when batch_reference is null then target_contract.id else null end,
    'payment_reversal',
    'out',
    total_refund,
    current_date,
    'Estorno de recebimento: ' || trim(p_reason)
  );
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
      and payment.external_reference is distinct from 'upfront_deposit'
  ) then
    raise exception 'Contrato com mensalidades pagas nao pode ser alterado; use renegociacao';
  end if;

  if contract_row.deposit_as_first_installment then
    select installment.id into upfront_installment_id
    from public.installments installment
    where installment.contract_id = p_contract_id
      and installment.installment_number = 1
    limit 1;

    if upfront_installment_id is null then
      raise exception 'Parcela inicial do contrato nao foi localizada';
    end if;
  end if;

  if contract_row.deposit_as_first_installment
    and contract_row.deposit_amount <> p_deposit_amount then
    raise exception 'Caucao ja movimentada nao pode ter o valor alterado';
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

    with payment_created as (
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
      ) returning id
    )
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
    )
    select
      contract_row.organization_id,
      p_device_id,
      p_contract_id,
      payment_created.id,
      'rental_payment',
      'in',
      p_deposit_amount,
      current_date,
      'Caucao recebida como primeira parcela do contrato ' || contract_row.contract_number
    from payment_created;
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

  select exists (
    select 1
    from public.installments installment
    where installment.contract_id = p_contract_id
      and installment.due_date < current_date
      and installment.status in ('pending', 'partial', 'overdue')
  ) into has_overdue;

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
    where payment_id in (
      select payment.id
      from public.payments payment
      where payment.installment_id = upfront_installment_id
    );

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

revoke all on function public.record_client_payment(uuid, numeric, text, timestamptz, text) from public;
grant execute on function public.record_client_payment(uuid, numeric, text, timestamptz, text) to authenticated;

revoke all on function public.reverse_payment(uuid, text) from public;
grant execute on function public.reverse_payment(uuid, text) to authenticated;

revoke all on function public.update_contract_with_installments(uuid, uuid, uuid, date, integer, integer, numeric, numeric, numeric, numeric, boolean, numeric) from public;
grant execute on function public.update_contract_with_installments(uuid, uuid, uuid, date, integer, integer, numeric, numeric, numeric, numeric, boolean, numeric) to authenticated;
