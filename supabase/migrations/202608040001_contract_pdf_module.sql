-- Modulo de documentos contratuais. Mantem os contratos legados sem recalculo.
alter table public.rental_clients
  add column if not exists birth_date date,
  add column if not exists secondary_phone text,
  add column if not exists address_complement text,
  add column if not exists work_address text,
  add column if not exists reference_name text,
  add column if not exists reference_phone text;

alter table public.devices
  add column if not exists indemnity_value numeric(14,2),
  add column if not exists notes text;

update public.devices
set indemnity_value = nullif(market_value, 0)
where indemnity_value is null;

alter table public.devices
  drop constraint if exists devices_indemnity_value_check;
alter table public.devices
  add constraint devices_indemnity_value_check
  check (indemnity_value is null or indemnity_value > 0);

alter table public.contracts
  add column if not exists first_installment_date date,
  add column if not exists deposit_paid_at timestamptz,
  add column if not exists deposit_payment_method text,
  add column if not exists indemnity_value numeric(14,2);

alter table public.contracts
  alter column daily_interest_percent set default 1.5;

update public.contracts contract
set first_installment_date = coalesce(
      (select min(installment.due_date)
       from public.installments installment
       where installment.contract_id = contract.id
         and (
           not contract.deposit_as_first_installment
           or installment.installment_number > 1
         )),
      contract.start_date
    ),
    deposit_paid_at = case
      when contract.deposit_as_first_installment then contract.created_at
      else (select deposit.received_at from public.deposits deposit where deposit.contract_id = contract.id)
    end,
    deposit_payment_method = case
      when contract.deposit_as_first_installment then 'other'
      when exists (
        select 1 from public.deposits deposit
        where deposit.contract_id = contract.id and deposit.received_at is not null
      ) then 'other'
      else null
    end,
    indemnity_value = coalesce(device.indemnity_value, nullif(device.market_value, 0))
from public.devices device
where device.id = contract.device_id
  and (
    contract.first_installment_date is null
    or contract.indemnity_value is null
    or (contract.deposit_amount > 0 and contract.deposit_paid_at is null)
  );

alter table public.contracts
  drop constraint if exists contracts_deposit_payment_method_check;
alter table public.contracts
  add constraint contracts_deposit_payment_method_check
  check (
    deposit_payment_method is null
    or deposit_payment_method in ('pix', 'card', 'transfer', 'cash', 'other')
  );

alter table public.contracts
  drop constraint if exists contracts_indemnity_value_check;
alter table public.contracts
  add constraint contracts_indemnity_value_check
  check (indemnity_value is null or indemnity_value > 0);

create table if not exists public.organization_contract_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  legal_name text not null,
  tax_id text,
  address text,
  phone text,
  email text,
  logo_storage_path text,
  city text,
  default_venue text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.organization_contract_settings(organization_id, legal_name)
select organization.id, organization.name
from public.organizations organization
on conflict (organization_id) do nothing;

drop trigger if exists set_organization_contract_settings_updated_at on public.organization_contract_settings;
create trigger set_organization_contract_settings_updated_at
before update on public.organization_contract_settings
for each row execute function public.set_updated_at();

create table if not exists public.contract_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  document_type text not null check (document_type in ('rental_contract', 'delivery_term')),
  version integer not null check (version > 0),
  status text not null default 'generating' check (status in ('generating', 'ready', 'failed')),
  bucket_id text not null default 'contracts' check (bucket_id = 'contracts'),
  storage_path text not null unique,
  file_name text not null,
  generated_at timestamptz,
  generated_by uuid references auth.users(id) on delete set null,
  generation_reason text,
  metadata jsonb not null default '{}'::jsonb,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (contract_id, document_type, version)
);

insert into storage.buckets(id, name, public)
values ('contracts', 'contracts', false)
on conflict (id) do update set public = false;

create index if not exists contract_documents_contract_idx
  on public.contract_documents(contract_id, document_type, version desc);
create unique index if not exists contract_documents_current_unique
  on public.contract_documents(contract_id, document_type)
  where is_current;
alter table public.organization_contract_settings enable row level security;
alter table public.contract_documents enable row level security;

drop policy if exists organization_contract_settings_select on public.organization_contract_settings;
create policy organization_contract_settings_select
on public.organization_contract_settings for select to authenticated
using (organization_id = public.current_organization_id());

drop policy if exists organization_contract_settings_write on public.organization_contract_settings;
create policy organization_contract_settings_write
on public.organization_contract_settings for all to authenticated
using (
  organization_id = public.current_organization_id()
  and public.has_role(array['admin', 'manager'])
)
with check (
  organization_id = public.current_organization_id()
  and public.has_role(array['admin', 'manager'])
);

drop policy if exists contract_documents_select on public.contract_documents;
create policy contract_documents_select
on public.contract_documents for select to authenticated
using (organization_id = public.current_organization_id());

create or replace function public.create_contract_with_separate_deposit(
  p_organization_id uuid,
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
  contract_id_value uuid := gen_random_uuid();
  contract_ref text;
  contract_end_date date;
  month_start date;
  due_date_value date;
  device_row public.devices%rowtype;
  has_overdue boolean := false;
  i integer;
begin
  if p_organization_id <> public.current_organization_id()
    or not public.has_role(array['admin', 'manager', 'operator']) then
    raise exception 'Sem permissao para criar contrato';
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

  perform 1
  from public.rental_clients
  where id = p_client_id and organization_id = p_organization_id;
  if not found then
    raise exception 'Cliente invalido';
  end if;

  select * into device_row
  from public.devices
  where id = p_device_id
    and organization_id = p_organization_id
    and status = 'available'
  for update;
  if not found then
    raise exception 'Aparelho indisponivel';
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

  contract_ref := 'GR-' || to_char(p_start_date, 'YYYY') || '-'
    || upper(substr(replace(contract_id_value::text, '-', ''), 1, 8));

  insert into public.contracts(
    id, organization_id, client_id, device_id, contract_number,
    start_date, end_date, first_installment_date, due_day, term_months,
    monthly_amount, deposit_amount, deposit_as_first_installment,
    deposit_paid_at, deposit_payment_method, indemnity_value,
    late_fee_percent, daily_interest_percent,
    purchase_option, purchase_option_amount, status
  ) values (
    contract_id_value, p_organization_id, p_client_id, p_device_id, contract_ref,
    p_start_date, contract_end_date, p_first_installment_date, p_due_day, p_term_months,
    p_monthly_amount, p_deposit_amount, false,
    case when p_deposit_amount > 0 then p_deposit_paid_at else null end,
    case when p_deposit_amount > 0 then p_deposit_payment_method else null end,
    p_indemnity_value,
    p_late_fee_percent, p_daily_interest_percent,
    p_purchase_option, case when p_purchase_option then p_purchase_option_amount else null end,
    'active'
  );

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
      p_organization_id, contract_id_value, i, due_date_value,
      p_monthly_amount,
      case when due_date_value < current_date
        then 'overdue'::public.installment_status
        else 'pending'::public.installment_status
      end
    );
    has_overdue := has_overdue or due_date_value < current_date;
  end loop;

  if has_overdue then
    update public.contracts set status = 'overdue' where id = contract_id_value;
  end if;

  insert into public.deposits(
    organization_id, contract_id, amount, status, received_at, notes
  ) values (
    p_organization_id,
    contract_id_value,
    p_deposit_amount,
    case when p_deposit_amount > 0 then 'held' else 'pending' end,
    case when p_deposit_amount > 0 then p_deposit_paid_at else null end,
    case when p_deposit_amount > 0 then 'Caucao contratual recebida separadamente das mensalidades' else null end
  );

  if p_deposit_amount > 0 then
    insert into public.cash_transactions(
      organization_id, device_id, contract_id, kind, direction,
      amount, occurred_on, description
    ) values (
      p_organization_id, p_device_id, contract_id_value, 'deposit_received', 'in',
      p_deposit_amount, p_deposit_paid_at::date,
      'Caucao recebida no contrato ' || contract_ref
    );
  end if;

  insert into public.inspections(
    organization_id, device_id, contract_id, inspection_type,
    condition_summary, battery_health, checklist
  ) values (
    p_organization_id, p_device_id, contract_id_value, 'delivery',
    device_row.condition, device_row.battery_health, coalesce(p_delivery_checklist, '{}'::jsonb)
  );

  update public.devices set status = 'rented' where id = p_device_id;

  insert into public.device_events(
    organization_id, device_id, event_type, description, metadata
  ) values (
    p_organization_id, p_device_id, 'contract_started',
    'Aparelho vinculado ao contrato ' || contract_ref,
    jsonb_build_object('contract_id', contract_id_value)
  );

  return contract_id_value;
end $$;

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
  device_row public.devices%rowtype;
  previous_values jsonb;
  contract_end_date date;
  month_start date;
  due_date_value date;
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

  if exists (
    select 1 from public.payments payment
    join public.installments installment on installment.id = payment.installment_id
    where installment.contract_id = p_contract_id
      and payment.status = 'confirmed'
  ) then
    raise exception 'Contrato com mensalidades pagas nao pode ter o plano financeiro alterado';
  end if;

  select * into deposit_row
  from public.deposits where contract_id = p_contract_id for update;

  if deposit_row.status in ('held', 'applied', 'refunded')
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

  delete from public.billing_notifications
  where installment_id in (
    select id from public.installments where contract_id = p_contract_id
  );
  delete from public.installments where contract_id = p_contract_id;

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

  if p_deposit_amount > 0 and deposit_row.status = 'pending' then
    insert into public.cash_transactions(
      organization_id, device_id, contract_id, kind, direction,
      amount, occurred_on, description
    ) values (
      contract_row.organization_id, p_device_id, p_contract_id, 'deposit_received', 'in',
      p_deposit_amount, p_deposit_paid_at::date,
      'Caucao recebida no contrato ' || contract_row.contract_number
    );
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

create or replace function public.reserve_contract_document(
  p_organization_id uuid,
  p_contract_id uuid,
  p_document_type text,
  p_actor_id uuid,
  p_reason text default null
) returns public.contract_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  contract_row public.contracts%rowtype;
  document_row public.contract_documents%rowtype;
  next_version integer;
  document_slug text;
begin
  if p_document_type not in ('rental_contract', 'delivery_term') then
    raise exception 'Tipo de documento invalido';
  end if;

  select * into contract_row from public.contracts
  where id = p_contract_id and organization_id = p_organization_id;
  if not found then raise exception 'Contrato invalido'; end if;

  perform 1 from public.profiles
  where id = p_actor_id
    and organization_id = p_organization_id
    and active
    and role::text = any(array['admin', 'manager', 'operator']);
  if not found then raise exception 'Usuario sem permissao'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_contract_id::text || ':' || p_document_type, 0));
  select coalesce(max(version), 0) + 1 into next_version
  from public.contract_documents
  where contract_id = p_contract_id and document_type = p_document_type;

  document_slug := case when p_document_type = 'rental_contract'
    then 'contrato'
    else 'termo-entrega'
  end;

  insert into public.contract_documents(
    organization_id, contract_id, document_type, version, status,
    storage_path, file_name, generated_by, generation_reason
  ) values (
    p_organization_id,
    p_contract_id,
    p_document_type,
    next_version,
    'generating',
    p_organization_id::text || '/' || contract_row.client_id::text || '/'
      || p_contract_id::text || '/' || document_slug || '-v' || next_version || '.pdf',
    document_slug || '-' || contract_row.contract_number || '-v' || next_version || '.pdf',
    p_actor_id,
    nullif(trim(coalesce(p_reason, '')), '')
  ) returning * into document_row;

  return document_row;
end $$;

create or replace function public.complete_contract_document(
  p_document_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns public.contract_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  document_row public.contract_documents%rowtype;
begin
  select * into document_row from public.contract_documents
  where id = p_document_id for update;
  if not found then raise exception 'Documento invalido'; end if;

  if not exists (
    select 1 from public.contract_documents current_document
    where current_document.contract_id = document_row.contract_id
      and current_document.document_type = document_row.document_type
      and current_document.is_current
      and current_document.version > document_row.version
  ) then
    update public.contract_documents
    set is_current = false
    where contract_id = document_row.contract_id
      and document_type = document_row.document_type
      and id <> p_document_id
      and is_current;

    update public.contract_documents
    set status = 'ready',
        generated_at = now(),
        metadata = coalesce(p_metadata, '{}'::jsonb),
        is_current = true
    where id = p_document_id
    returning * into document_row;
  else
    update public.contract_documents
    set status = 'ready',
        generated_at = now(),
        metadata = coalesce(p_metadata, '{}'::jsonb),
        is_current = false
    where id = p_document_id
    returning * into document_row;
  end if;

  insert into public.audit_logs(
    organization_id, actor_id, action, table_name, record_id, new_data
  ) values (
    document_row.organization_id,
    document_row.generated_by,
    'document_generated',
    'contract_documents',
    document_row.id::text,
    jsonb_build_object(
      'contract_id', document_row.contract_id,
      'document_type', document_row.document_type,
      'version', document_row.version,
      'reason', document_row.generation_reason
    )
  );

  return document_row;
end $$;

create or replace function public.fail_contract_document(
  p_document_id uuid,
  p_error_code text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.contract_documents
  set status = 'failed',
      generated_at = now(),
      is_current = false,
      metadata = jsonb_build_object('error_code', left(coalesce(p_error_code, 'generation_failed'), 80))
  where id = p_document_id;
end $$;

revoke all on function public.create_contract_with_separate_deposit(
  uuid, uuid, uuid, date, date, integer, integer, numeric, numeric,
  timestamptz, text, numeric, numeric, numeric, boolean, numeric, jsonb
) from public;
grant execute on function public.create_contract_with_separate_deposit(
  uuid, uuid, uuid, date, date, integer, integer, numeric, numeric,
  timestamptz, text, numeric, numeric, numeric, boolean, numeric, jsonb
) to authenticated;

revoke all on function public.update_contract_with_separate_deposit(
  uuid, uuid, uuid, date, date, integer, integer, numeric, numeric,
  timestamptz, text, numeric, numeric, numeric, boolean, numeric, jsonb
) from public;
grant execute on function public.update_contract_with_separate_deposit(
  uuid, uuid, uuid, date, date, integer, integer, numeric, numeric,
  timestamptz, text, numeric, numeric, numeric, boolean, numeric, jsonb
) to authenticated;

revoke all on function public.reserve_contract_document(uuid, uuid, text, uuid, text) from public;
revoke all on function public.complete_contract_document(uuid, jsonb) from public;
revoke all on function public.fail_contract_document(uuid, text) from public;
grant execute on function public.reserve_contract_document(uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.complete_contract_document(uuid, jsonb) to service_role;
grant execute on function public.fail_contract_document(uuid, text) to service_role;
