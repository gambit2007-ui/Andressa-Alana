-- Permite corrigir uma caucao recebida mantendo um unico lancamento ativo no caixa.

create or replace function public.update_contract_with_separate_deposit(
  p_contract_id uuid,
  p_client_id uuid,
  p_device_id uuid,
  p_start_date date,
  p_first_installment_date date,
  p_due_day integer,
  p_term_months integer,
  p_monthly_amount numeric,
  p_deposit_amount numeric,
  p_deposit_paid_at timestamptz,
  p_deposit_payment_method text,
  p_late_fee_percent numeric,
  p_daily_interest_percent numeric,
  p_indemnity_value numeric,
  p_purchase_option boolean,
  p_purchase_option_amount numeric,
  p_delivery_checklist jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  contract_row public.contracts%rowtype;
  deposit_row public.deposits%rowtype;
  deposit_transaction_row public.cash_transactions%rowtype;
  device_row public.devices%rowtype;
  previous_values jsonb;
  contract_end_date date;
  month_start date;
  due_date_value date;
  plan_changed boolean;
  has_overdue boolean := false;
  i integer;
begin
  select * into contract_row
  from public.contracts
  where id = p_contract_id
    and organization_id = public.current_organization_id()
  for update;

  if not found or not public.has_role(array['admin', 'manager', 'operator']) then
    raise exception 'Contrato invalido ou sem permissao';
  end if;

  if contract_row.deposit_as_first_installment then
    raise exception 'Contrato legado deve ser alterado pelo fluxo historico';
  end if;

  if p_start_date is null
    or p_first_installment_date is null
    or p_first_installment_date < p_start_date
    or p_due_day not between 1 and 31
    or p_term_months not between 1 and 60
    or p_monthly_amount <= 0
    or p_deposit_amount < 0
    or p_late_fee_percent < 0
    or p_daily_interest_percent < 0
    or p_indemnity_value <= 0
    or (p_purchase_option and coalesce(p_purchase_option_amount, 0) <= 0)
    or (
      p_deposit_amount > 0
      and (
        p_deposit_paid_at is null
        or p_deposit_payment_method not in ('pix', 'card', 'transfer', 'cash', 'other')
      )
    ) then
    raise exception 'Condicoes contratuais invalidas';
  end if;

  plan_changed := contract_row.start_date is distinct from p_start_date
    or contract_row.first_installment_date is distinct from p_first_installment_date
    or contract_row.due_day is distinct from p_due_day
    or contract_row.term_months is distinct from p_term_months
    or contract_row.monthly_amount is distinct from p_monthly_amount;

  if plan_changed and exists (
    select 1 from public.payments payment
    join public.installments installment on installment.id = payment.installment_id
    where installment.contract_id = p_contract_id
      and payment.status = 'confirmed'
  ) then
    raise exception 'Contrato com mensalidades pagas nao pode ter o plano financeiro alterado';
  end if;

  select * into deposit_row
  from public.deposits where contract_id = p_contract_id for update;

  if deposit_row.status in ('applied', 'refunded')
    and (
      deposit_row.amount <> p_deposit_amount
      or contract_row.deposit_paid_at is distinct from p_deposit_paid_at
      or contract_row.deposit_payment_method is distinct from p_deposit_payment_method
    ) then
    raise exception 'Caucao movimentada nao pode ter valor, data ou forma alterados';
  end if;

  perform 1
  from public.rental_clients
  where id = p_client_id and organization_id = contract_row.organization_id;
  if not found then raise exception 'Cliente invalido'; end if;

  if p_device_id = contract_row.device_id then
    select * into device_row from public.devices where id = p_device_id;
  else
    select * into device_row
    from public.devices
    where id = p_device_id
      and organization_id = contract_row.organization_id
      and status = 'available'
    for update;
    if not found then raise exception 'Aparelho indisponivel'; end if;
  end if;

  previous_values := to_jsonb(contract_row);

  if plan_changed then
    delete from public.billing_notifications
    where installment_id in (
      select id from public.installments where contract_id = p_contract_id
    );
    delete from public.installments where contract_id = p_contract_id;
  end if;

  if p_term_months = 1 then
    contract_end_date := p_first_installment_date;
  else
    month_start := (
      date_trunc('month', p_first_installment_date)::date
      + make_interval(months => p_term_months - 1)
    )::date;
    contract_end_date := month_start
      + (least(p_due_day, extract(day from (month_start + interval '1 month - 1 day'))::integer) - 1);
  end if;

  update public.contracts
  set client_id = p_client_id,
      device_id = p_device_id,
      start_date = p_start_date,
      end_date = contract_end_date,
      first_installment_date = p_first_installment_date,
      due_day = p_due_day,
      term_months = p_term_months,
      monthly_amount = p_monthly_amount,
      deposit_amount = p_deposit_amount,
      deposit_paid_at = case when p_deposit_amount > 0 then p_deposit_paid_at else null end,
      deposit_payment_method = case when p_deposit_amount > 0 then p_deposit_payment_method else null end,
      indemnity_value = p_indemnity_value,
      late_fee_percent = p_late_fee_percent,
      daily_interest_percent = p_daily_interest_percent,
      purchase_option = p_purchase_option,
      purchase_option_amount = case when p_purchase_option then p_purchase_option_amount else null end
  where id = p_contract_id;

  if plan_changed then
    for i in 1..p_term_months loop
      if i = 1 then
        due_date_value := p_first_installment_date;
      else
        month_start := (
          date_trunc('month', p_first_installment_date)::date
          + make_interval(months => i - 1)
        )::date;
        due_date_value := month_start
          + (least(p_due_day, extract(day from (month_start + interval '1 month - 1 day'))::integer) - 1);
      end if;

      insert into public.installments(
        organization_id, contract_id, installment_number, due_date,
        original_amount, status
      ) values (
        contract_row.organization_id, p_contract_id, i, due_date_value,
        p_monthly_amount,
        case when due_date_value < current_date
          then 'overdue'::public.installment_status
          else 'pending'::public.installment_status
        end
      );
      has_overdue := has_overdue or due_date_value < current_date;
    end loop;
  else
    select exists (
      select 1 from public.installments
      where contract_id = p_contract_id and status = 'overdue'
    ) into has_overdue;
  end if;

  update public.contracts
  set status = case when has_overdue
    then 'overdue'::public.contract_status
    else 'active'::public.contract_status
  end
  where id = p_contract_id and status in ('active', 'overdue');

  update public.deposits
  set amount = p_deposit_amount,
      status = case when p_deposit_amount > 0 then 'held' else 'pending' end,
      received_at = case when p_deposit_amount > 0 then p_deposit_paid_at else null end,
      notes = case when p_deposit_amount > 0
        then 'Caucao contratual recebida separadamente das mensalidades'
        else null
      end
  where contract_id = p_contract_id;

  select * into deposit_transaction_row
  from public.cash_transactions
  where contract_id = p_contract_id
    and kind = 'deposit_received'
    and status = 'confirmed'
  order by created_at
  limit 1
  for update;

  if p_deposit_amount > 0 then
    if deposit_transaction_row.id is null then
      insert into public.cash_transactions(
        organization_id, device_id, contract_id, kind, direction,
        amount, occurred_on, description
      ) values (
        contract_row.organization_id, p_device_id, p_contract_id, 'deposit_received', 'in',
        p_deposit_amount, p_deposit_paid_at::date,
        'Caucao recebida no contrato ' || contract_row.contract_number
      );
    else
      update public.cash_transactions
      set device_id = p_device_id,
          amount = p_deposit_amount,
          occurred_on = p_deposit_paid_at::date,
          description = 'Caucao recebida no contrato ' || contract_row.contract_number
      where id = deposit_transaction_row.id;
    end if;
  elsif deposit_transaction_row.id is not null then
    update public.cash_transactions
    set status = 'reversed'
    where id = deposit_transaction_row.id;
  end if;

  if p_device_id <> contract_row.device_id then
    update public.devices set status = 'available'
    where id = contract_row.device_id and status = 'rented';
    update public.devices set status = 'rented' where id = p_device_id;
    update public.cash_transactions
    set device_id = p_device_id
    where contract_id = p_contract_id and kind = 'deposit_received';
  end if;

  update public.inspections
  set device_id = p_device_id,
      condition_summary = device_row.condition,
      battery_health = device_row.battery_health,
      checklist = coalesce(p_delivery_checklist, '{}'::jsonb),
      inspected_by = auth.uid(),
      inspected_at = now()
  where id = (
    select inspection.id from public.inspections inspection
    where inspection.contract_id = p_contract_id
      and inspection.inspection_type = 'delivery'
    order by inspection.inspected_at desc
    limit 1
  );

  if not found then
    insert into public.inspections(
      organization_id, device_id, contract_id, inspection_type,
      condition_summary, battery_health, checklist
    ) values (
      contract_row.organization_id, p_device_id, p_contract_id, 'delivery',
      device_row.condition, device_row.battery_health, coalesce(p_delivery_checklist, '{}'::jsonb)
    );
  end if;

  insert into public.contract_amendments(
    organization_id, contract_id, amendment_type, effective_date,
    reason, previous_values, new_values
  ) values (
    contract_row.organization_id, p_contract_id, 'other', current_date,
    'Correcao contratual pelo painel', previous_values,
    jsonb_build_object(
      'client_id', p_client_id,
      'device_id', p_device_id,
      'start_date', p_start_date,
      'first_installment_date', p_first_installment_date,
      'monthly_installments', p_term_months,
      'monthly_amount', p_monthly_amount,
      'deposit_amount', p_deposit_amount,
      'deposit_as_first_installment', false,
      'indemnity_value', p_indemnity_value
    )
  );

  return p_contract_id;
end $$;

revoke all on function public.update_contract_with_separate_deposit(
  uuid, uuid, uuid, date, date, integer, integer, numeric, numeric,
  timestamptz, text, numeric, numeric, numeric, boolean, numeric, jsonb
) from public;
grant execute on function public.update_contract_with_separate_deposit(
  uuid, uuid, uuid, date, date, integer, integer, numeric, numeric,
  timestamptz, text, numeric, numeric, numeric, boolean, numeric, jsonb
) to authenticated;
