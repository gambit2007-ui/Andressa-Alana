-- Adiciona frequencias de cobranca sem alterar os contratos historicos mensais.

alter table public.contracts
  add column if not exists payment_frequency text not null default 'monthly';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contracts_payment_frequency_check'
      and conrelid = 'public.contracts'::regclass
  ) then
    alter table public.contracts
      add constraint contracts_payment_frequency_check
      check (payment_frequency in ('daily', 'weekly', 'biweekly', 'monthly'));
  end if;
end $$;

create or replace function public.contract_charge_due_date(
  p_first_due_date date,
  p_due_day integer,
  p_payment_frequency text,
  p_installment_index integer
) returns date
language plpgsql
immutable
strict
set search_path = public
as $$
declare
  month_start date;
begin
  if p_due_day not between 1 and 31
    or p_payment_frequency not in ('daily', 'weekly', 'biweekly', 'monthly')
    or p_installment_index < 0 then
    raise exception 'Parametros de vencimento invalidos';
  end if;

  if p_installment_index = 0 then
    return p_first_due_date;
  end if;

  if p_payment_frequency = 'daily' then
    return p_first_due_date + p_installment_index;
  elsif p_payment_frequency = 'weekly' then
    return p_first_due_date + (p_installment_index * 7);
  elsif p_payment_frequency = 'biweekly' then
    return p_first_due_date + (p_installment_index * 14);
  end if;

  month_start := (
    date_trunc('month', p_first_due_date)::date
    + make_interval(months => p_installment_index)
  )::date;
  return month_start
    + (least(p_due_day, extract(day from (month_start + interval '1 month - 1 day'))::integer) - 1);
end $$;

create or replace function public.create_contract_with_payment_frequency(
  p_organization_id uuid,
  p_client_id uuid,
  p_device_id uuid,
  p_start_date date,
  p_first_installment_date date,
  p_payment_frequency text,
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
  contract_id_value uuid;
  due_date_value date;
  has_overdue boolean := false;
  i integer;
begin
  if p_payment_frequency not in ('daily', 'weekly', 'biweekly', 'monthly') then
    raise exception 'Frequencia de pagamento invalida';
  end if;

  contract_id_value := public.create_contract_with_separate_deposit(
    p_organization_id,
    p_client_id,
    p_device_id,
    p_start_date,
    p_first_installment_date,
    p_due_day,
    p_term_months,
    p_monthly_amount,
    p_deposit_amount,
    p_deposit_paid_at,
    p_deposit_payment_method,
    p_late_fee_percent,
    p_daily_interest_percent,
    p_indemnity_value,
    p_purchase_option,
    p_purchase_option_amount,
    p_delivery_checklist
  );

  delete from public.installments where contract_id = contract_id_value;

  for i in 1..p_term_months loop
    due_date_value := public.contract_charge_due_date(
      p_first_installment_date,
      p_due_day,
      p_payment_frequency,
      i - 1
    );
    insert into public.installments(
      organization_id, contract_id, installment_number, due_date,
      original_amount, status
    ) values (
      p_organization_id, contract_id_value, i, due_date_value,
      p_monthly_amount,
      case when due_date_value < current_date
        then 'overdue'::public.installment_status
        else 'pending'::public.installment_status
      end
    );
    has_overdue := has_overdue or due_date_value < current_date;
  end loop;

  update public.contracts
  set payment_frequency = p_payment_frequency,
      end_date = public.contract_charge_due_date(
        p_first_installment_date,
        p_due_day,
        p_payment_frequency,
        p_term_months - 1
      ),
      status = case when has_overdue
        then 'overdue'::public.contract_status
        else 'active'::public.contract_status
      end
  where id = contract_id_value;

  return contract_id_value;
end $$;

create or replace function public.update_contract_with_payment_frequency(
  p_contract_id uuid,
  p_client_id uuid,
  p_device_id uuid,
  p_start_date date,
  p_first_installment_date date,
  p_payment_frequency text,
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
  plan_changed boolean;
  due_date_value date;
  has_overdue boolean := false;
  i integer;
begin
  if p_payment_frequency not in ('daily', 'weekly', 'biweekly', 'monthly') then
    raise exception 'Frequencia de pagamento invalida';
  end if;

  select * into contract_row
  from public.contracts
  where id = p_contract_id
    and organization_id = public.current_organization_id()
  for update;
  if not found or not public.has_role(array['admin', 'manager', 'operator']) then
    raise exception 'Sem permissao para editar contrato';
  end if;

  plan_changed := contract_row.start_date <> p_start_date
    or contract_row.first_installment_date is distinct from p_first_installment_date
    or contract_row.payment_frequency is distinct from p_payment_frequency
    or contract_row.due_day <> p_due_day
    or contract_row.term_months <> p_term_months
    or contract_row.monthly_amount <> p_monthly_amount;

  if plan_changed and exists (
    select 1
    from public.payments payment
    join public.installments installment on installment.id = payment.installment_id
    where installment.contract_id = p_contract_id
      and payment.status = 'confirmed'
  ) then
    raise exception 'Contrato com cobrancas pagas nao pode ter o plano financeiro alterado';
  end if;

  perform public.update_contract_with_separate_deposit(
    p_contract_id,
    p_client_id,
    p_device_id,
    p_start_date,
    p_first_installment_date,
    p_due_day,
    p_term_months,
    p_monthly_amount,
    p_deposit_amount,
    p_deposit_paid_at,
    p_deposit_payment_method,
    p_late_fee_percent,
    p_daily_interest_percent,
    p_indemnity_value,
    p_purchase_option,
    p_purchase_option_amount,
    p_delivery_checklist
  );

  if plan_changed then
    delete from public.billing_notifications
    where installment_id in (
      select id from public.installments where contract_id = p_contract_id
    );
    delete from public.installments where contract_id = p_contract_id;

    for i in 1..p_term_months loop
      due_date_value := public.contract_charge_due_date(
        p_first_installment_date,
        p_due_day,
        p_payment_frequency,
        i - 1
      );
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
  set payment_frequency = p_payment_frequency,
      end_date = public.contract_charge_due_date(
        p_first_installment_date,
        p_due_day,
        p_payment_frequency,
        p_term_months - 1
      ),
      status = case when has_overdue
        then 'overdue'::public.contract_status
        else 'active'::public.contract_status
      end
  where id = p_contract_id and status in ('active', 'overdue');

  update public.contract_amendments
  set new_values = new_values || jsonb_build_object(
    'payment_frequency', p_payment_frequency,
    'installment_count', p_term_months,
    'installment_amount', p_monthly_amount
  )
  where id = (
    select id from public.contract_amendments
    where contract_id = p_contract_id
    order by created_at desc
    limit 1
  );

  return p_contract_id;
end $$;

revoke all on function public.contract_charge_due_date(date, integer, text, integer) from public;
grant execute on function public.contract_charge_due_date(date, integer, text, integer) to authenticated;

revoke all on function public.create_contract_with_payment_frequency(
  uuid, uuid, uuid, date, date, text, integer, integer, numeric, numeric,
  timestamptz, text, numeric, numeric, numeric, boolean, numeric, jsonb
) from public;
grant execute on function public.create_contract_with_payment_frequency(
  uuid, uuid, uuid, date, date, text, integer, integer, numeric, numeric,
  timestamptz, text, numeric, numeric, numeric, boolean, numeric, jsonb
) to authenticated;

revoke all on function public.update_contract_with_payment_frequency(
  uuid, uuid, uuid, date, date, text, integer, integer, numeric, numeric,
  timestamptz, text, numeric, numeric, numeric, boolean, numeric, jsonb
) from public;
grant execute on function public.update_contract_with_payment_frequency(
  uuid, uuid, uuid, date, date, text, integer, integer, numeric, numeric,
  timestamptz, text, numeric, numeric, numeric, boolean, numeric, jsonb
) to authenticated;
