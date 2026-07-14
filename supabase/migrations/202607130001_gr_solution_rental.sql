-- GR Solution Rental: evolucao incremental. As tabelas legadas de estetica permanecem intactas.
create extension if not exists pgcrypto;

do $$ begin create type public.app_role as enum ('admin', 'manager', 'finance', 'operator', 'viewer'); exception when duplicate_object then null; end $$;
do $$ begin create type public.device_status as enum ('available', 'rented', 'maintenance', 'sold', 'retired'); exception when duplicate_object then null; end $$;
do $$ begin create type public.contract_status as enum ('draft', 'active', 'overdue', 'completed', 'cancelled', 'renegotiated'); exception when duplicate_object then null; end $$;
do $$ begin create type public.installment_status as enum ('pending', 'partial', 'overdue', 'paid', 'cancelled', 'renegotiated'); exception when duplicate_object then null; end $$;
do $$ begin create type public.payment_status as enum ('confirmed', 'reversed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.mdm_command_status as enum ('requested', 'awaiting_approval', 'sent', 'acknowledged', 'executed', 'failed'); exception when duplicate_object then null; end $$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  full_name text not null,
  role public.app_role not null default 'operator',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A tabela public.clients ja pertence ao app de estetica; o novo dominio usa rental_clients.
create table if not exists public.rental_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  full_name text not null,
  cpf text not null check (cpf ~ '^\d{11}$'),
  rg text,
  phone text not null,
  email text,
  profession text,
  monthly_income numeric(14,2) not null default 0 check (monthly_income >= 0),
  address_line text,
  address_number text,
  neighborhood text,
  city text,
  state text check (state is null or char_length(state) = 2),
  postal_code text,
  internal_risk_score integer not null default 650 check (internal_risk_score between 0 and 1000),
  risk_label text not null default 'moderado',
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, cpf)
);

create table if not exists public.client_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.rental_clients(id) on delete cascade,
  kind text not null check (kind in ('selfie', 'identity', 'income', 'residence')),
  bucket_id text not null default 'client-documents',
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  file_size bigint check (file_size is null or file_size >= 0),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.client_risk_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.rental_clients(id) on delete cascade,
  score integer not null check (score between 0 and 1000),
  classification text not null,
  source text not null default 'internal' check (source = 'internal'),
  notes text,
  assessed_by uuid references auth.users(id) on delete set null default auth.uid(),
  assessed_at timestamptz not null default now()
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  model text not null,
  color text not null,
  capacity_gb integer not null check (capacity_gb > 0),
  imei_1 text not null check (imei_1 ~ '^\d{15}$'),
  imei_2 text check (imei_2 is null or imei_2 ~ '^\d{15}$'),
  serial_number text not null,
  battery_health integer not null check (battery_health between 0 and 100),
  purchase_date date not null,
  purchase_amount numeric(14,2) not null default 0 check (purchase_amount >= 0),
  supplier text,
  invoice_number text,
  warranty_until date,
  condition text not null default 'Bom',
  accessories text[] not null default '{}',
  market_value numeric(14,2) not null default 0 check (market_value >= 0),
  status public.device_status not null default 'available',
  apple_business_registered boolean not null default false,
  mdm_enrolled boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, imei_1),
  unique (organization_id, serial_number)
);

create unique index if not exists devices_org_imei2_unique on public.devices(organization_id, imei_2) where imei_2 is not null;

create table if not exists public.device_photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  device_id uuid not null references public.devices(id) on delete cascade,
  bucket_id text not null default 'device-photos',
  storage_path text not null unique,
  caption text,
  created_at timestamptz not null default now()
);

create table if not exists public.device_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  device_id uuid not null references public.devices(id) on delete restrict,
  event_type text not null,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null default auth.uid(),
  occurred_at timestamptz not null default now()
);

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.rental_clients(id) on delete restrict,
  device_id uuid not null references public.devices(id) on delete restrict,
  contract_number text not null,
  start_date date not null,
  end_date date not null,
  due_day integer not null check (due_day between 1 and 31),
  term_months integer not null check (term_months between 1 and 60),
  monthly_amount numeric(14,2) not null check (monthly_amount > 0),
  deposit_amount numeric(14,2) not null default 0 check (deposit_amount >= 0),
  late_fee_percent numeric(7,4) not null default 2 check (late_fee_percent >= 0),
  daily_interest_percent numeric(7,4) not null default 0.033 check (daily_interest_percent >= 0),
  purchase_option boolean not null default false,
  purchase_option_amount numeric(14,2) check (purchase_option_amount is null or purchase_option_amount >= 0),
  status public.contract_status not null default 'active',
  cancellation_reason text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, contract_number)
);

create unique index if not exists contracts_one_open_per_device on public.contracts(device_id) where status in ('draft', 'active', 'overdue', 'renegotiated');

create table if not exists public.contract_amendments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  amendment_type text not null check (amendment_type in ('renewal', 'swap', 'renegotiation', 'return', 'cancellation', 'other')),
  effective_date date not null,
  reason text not null,
  previous_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.installments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  installment_number integer not null check (installment_number > 0),
  due_date date not null,
  original_amount numeric(14,2) not null check (original_amount > 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  late_fee_amount numeric(14,2) not null default 0 check (late_fee_amount >= 0),
  interest_amount numeric(14,2) not null default 0 check (interest_amount >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  status public.installment_status not null default 'pending',
  renegotiated_to uuid references public.installments(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contract_id, installment_number)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  installment_id uuid not null references public.installments(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (method in ('pix', 'card', 'transfer', 'cash', 'other')),
  paid_at timestamptz not null,
  status public.payment_status not null default 'confirmed',
  external_reference text,
  notes text,
  reversed_at timestamptz,
  reversal_reason text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  device_id uuid references public.devices(id) on delete restrict,
  contract_id uuid references public.contracts(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete restrict,
  kind text not null,
  direction text not null check (direction in ('in', 'out')),
  amount numeric(14,2) not null check (amount > 0),
  occurred_on date not null,
  description text not null,
  status public.payment_status not null default 'confirmed',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.deposits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  amount numeric(14,2) not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'held', 'refunded', 'applied')),
  received_at timestamptz,
  resolved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contract_id)
);

create table if not exists public.maintenance_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  device_id uuid not null references public.devices(id) on delete restrict,
  contract_id uuid references public.contracts(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'diagnosis', 'approved', 'in_progress', 'completed', 'cancelled')),
  description text not null,
  provider text,
  opened_on date not null default current_date,
  completed_on date,
  cost numeric(14,2) not null default 0 check (cost >= 0),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inspections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  device_id uuid not null references public.devices(id) on delete restrict,
  contract_id uuid references public.contracts(id) on delete restrict,
  inspection_type text not null check (inspection_type in ('delivery', 'return', 'maintenance', 'inventory')),
  condition_summary text not null,
  battery_health integer check (battery_health between 0 and 100),
  checklist jsonb not null default '{}'::jsonb,
  storage_paths text[] not null default '{}',
  inspected_by uuid references auth.users(id) on delete set null default auth.uid(),
  inspected_at timestamptz not null default now()
);

create table if not exists public.device_sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  device_id uuid not null references public.devices(id) on delete restrict,
  contract_id uuid references public.contracts(id) on delete restrict,
  client_id uuid references public.rental_clients(id) on delete restrict,
  sale_amount numeric(14,2) not null check (sale_amount > 0),
  sold_at timestamptz not null,
  paid_in_full boolean not null default false,
  apple_release_confirmed boolean not null default false,
  confirmed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (device_id)
);

create table if not exists public.mdm_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  device_id uuid not null references public.devices(id) on delete restrict unique,
  provider text not null default 'mock' check (provider in ('mock', 'mosyle')),
  provider_device_id text,
  status text not null default 'pending' check (status in ('pending', 'assigned', 'enrolled', 'unmanaged', 'error')),
  supervised boolean not null default false,
  activation_lock_managed boolean not null default false,
  last_sync_at timestamptz,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mdm_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  mdm_device_id uuid not null references public.mdm_devices(id) on delete restrict,
  command text not null check (command in ('sync', 'lock', 'lost_mode_on', 'lost_mode_off', 'erase', 'clear_activation_lock', 'remove_management')),
  status public.mdm_command_status not null default 'requested',
  reason text not null,
  is_destructive boolean not null default false,
  provider_reference text,
  provider_response jsonb not null default '{}'::jsonb,
  requested_by uuid references auth.users(id) on delete set null default auth.uid(),
  approved_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.billing_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  installment_id uuid not null references public.installments(id) on delete restrict,
  channel text not null check (channel in ('whatsapp', 'email', 'pix')),
  provider text not null default 'mock',
  status text not null default 'simulated' check (status in ('pending', 'simulated', 'sent', 'delivered', 'failed')),
  scheduled_for timestamptz,
  sent_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  provider_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists rental_clients_org_name_idx on public.rental_clients(organization_id, full_name);
create index if not exists devices_org_status_idx on public.devices(organization_id, status);
create index if not exists contracts_org_status_idx on public.contracts(organization_id, status);
create index if not exists contracts_client_idx on public.contracts(client_id);
create index if not exists installments_org_due_idx on public.installments(organization_id, due_date, status);
create index if not exists payments_org_paid_idx on public.payments(organization_id, paid_at);
create index if not exists cash_transactions_org_date_idx on public.cash_transactions(organization_id, occurred_on);
create index if not exists device_events_device_date_idx on public.device_events(device_id, occurred_at desc);
create index if not exists audit_logs_org_date_idx on public.audit_logs(organization_id, created_at desc);

create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path = public
as $$ select organization_id from public.profiles where id = auth.uid() and active limit 1 $$;

create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and active limit 1 $$;

create or replace function public.has_role(allowed_roles text[])
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_app_role()::text = any(allowed_roles), false) $$;

insert into public.organizations(name, slug)
values ('GR Solution', 'gr-solution')
on conflict (slug) do update set name = excluded.name;

with target_org as (select id from public.organizations where slug = 'gr-solution' limit 1),
ranked_users as (select id, email, raw_user_meta_data, row_number() over (order by created_at) as rn from auth.users)
insert into public.profiles(id, organization_id, full_name, role)
select u.id, o.id, coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), split_part(coalesce(u.email, 'Usuario'), '@', 1)),
       case when u.rn = 1 then 'admin'::public.app_role else 'operator'::public.app_role end
from ranked_users u cross join target_org o
on conflict (id) do nothing;

create or replace function public.handle_new_rental_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  target_org uuid;
  target_role public.app_role;
begin
  select id into target_org from public.organizations where slug = 'gr-solution' limit 1;
  if target_org is null then
    insert into public.organizations(name, slug) values ('GR Solution', 'gr-solution') returning id into target_org;
  end if;
  target_role := case when exists(select 1 from public.profiles where organization_id = target_org) then 'operator'::public.app_role else 'admin'::public.app_role end;
  insert into public.profiles(id, organization_id, full_name, role)
  values (new.id, target_org, coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(coalesce(new.email, 'Usuario'), '@', 1)), target_role)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_rental_auth_user_created on auth.users;
create trigger on_rental_auth_user_created after insert on auth.users for each row execute function public.handle_new_rental_user();

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array['organizations','profiles','rental_clients','devices','contracts','installments','deposits','maintenance_orders','mdm_devices'] loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', table_name, table_name);
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

create or replace function public.protect_profile_scope()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (new.organization_id <> old.organization_id or new.role <> old.role) and not public.has_role(array['admin']) then
    raise exception 'Somente administradores alteram organizacao ou perfil de acesso';
  end if;
  return new;
end $$;

drop trigger if exists protect_profile_scope on public.profiles;
create trigger protect_profile_scope before update on public.profiles for each row execute function public.protect_profile_scope();

create or replace function public.create_mdm_device_for_asset()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.mdm_devices(organization_id, device_id, provider, status)
  values (new.organization_id, new.id, 'mock', 'pending') on conflict (device_id) do nothing;
  return new;
end $$;

drop trigger if exists create_mdm_device_after_asset on public.devices;
create trigger create_mdm_device_after_asset after insert on public.devices for each row execute function public.create_mdm_device_for_asset();

create or replace function public.prevent_device_delete_with_history()
returns trigger language plpgsql set search_path = public
as $$
begin
  if old.status = 'rented' or exists(select 1 from public.contracts where device_id = old.id) or exists(select 1 from public.cash_transactions where device_id = old.id) then
    raise exception 'Aparelho alugado ou com historico nao pode ser excluido';
  end if;
  return old;
end $$;

drop trigger if exists prevent_device_delete_with_history on public.devices;
create trigger prevent_device_delete_with_history before delete on public.devices for each row execute function public.prevent_device_delete_with_history();

create or replace function public.prevent_financial_delete()
returns trigger language plpgsql set search_path = public
as $$ begin raise exception 'Registros financeiros nao podem ser apagados; use estorno ou cancelamento'; end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array['payments','cash_transactions','deposits','device_sales'] loop
    execute format('drop trigger if exists prevent_%I_delete on public.%I', table_name, table_name);
    execute format('create trigger prevent_%I_delete before delete on public.%I for each row execute function public.prevent_financial_delete()', table_name, table_name);
  end loop;
end $$;

create or replace function public.audit_business_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  source jsonb;
  org_id uuid;
  row_id text;
begin
  source := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org_id := (source->>'organization_id')::uuid;
  row_id := source->>'id';
  insert into public.audit_logs(organization_id, actor_id, action, table_name, record_id, old_data, new_data)
  values (org_id, auth.uid(), lower(tg_op), tg_table_name, row_id,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array['rental_clients','devices','contracts','installments','payments','deposits','device_sales','mdm_commands'] loop
    execute format('drop trigger if exists audit_%I_changes on public.%I', table_name, table_name);
    execute format('create trigger audit_%I_changes after insert or update or delete on public.%I for each row execute function public.audit_business_change()', table_name, table_name);
  end loop;
end $$;

create or replace function public.create_contract_with_installments(
  p_organization_id uuid, p_client_id uuid, p_device_id uuid, p_start_date date,
  p_due_day integer, p_term_months integer, p_monthly_amount numeric,
  p_deposit_amount numeric, p_late_fee_percent numeric, p_daily_interest_percent numeric,
  p_purchase_option boolean, p_purchase_option_amount numeric
) returns uuid language plpgsql security definer set search_path = public
as $$
declare
  contract_id uuid := gen_random_uuid();
  contract_ref text;
  month_start date;
  due_date_value date;
  i integer;
begin
  if p_organization_id <> public.current_organization_id() or not public.has_role(array['admin','manager','operator']) then raise exception 'Sem permissao para criar contrato'; end if;
  if p_due_day not between 1 and 31 or p_term_months not between 1 and 60 or p_monthly_amount <= 0 then raise exception 'Condicoes contratuais invalidas'; end if;
  perform 1 from public.rental_clients where id = p_client_id and organization_id = p_organization_id;
  if not found then raise exception 'Cliente invalido'; end if;
  update public.devices set status = 'rented' where id = p_device_id and organization_id = p_organization_id and status = 'available';
  if not found then raise exception 'Aparelho indisponivel'; end if;

  contract_ref := 'GR-' || to_char(p_start_date, 'YYYY') || '-' || upper(substr(replace(contract_id::text, '-', ''), 1, 8));
  insert into public.contracts(id, organization_id, client_id, device_id, contract_number, start_date, end_date, due_day, term_months, monthly_amount, deposit_amount, late_fee_percent, daily_interest_percent, purchase_option, purchase_option_amount, status)
  values (contract_id, p_organization_id, p_client_id, p_device_id, contract_ref, p_start_date, (p_start_date + make_interval(months => p_term_months))::date, p_due_day, p_term_months, p_monthly_amount, p_deposit_amount, p_late_fee_percent, p_daily_interest_percent, p_purchase_option, case when p_purchase_option then p_purchase_option_amount else null end, 'active');

  for i in 1..p_term_months loop
    month_start := (date_trunc('month', p_start_date)::date + make_interval(months => i))::date;
    due_date_value := month_start + (least(p_due_day, extract(day from (month_start + interval '1 month - 1 day'))::integer) - 1);
    insert into public.installments(organization_id, contract_id, installment_number, due_date, original_amount)
    values (p_organization_id, contract_id, i, due_date_value, p_monthly_amount);
  end loop;
  insert into public.deposits(organization_id, contract_id, amount) values (p_organization_id, contract_id, p_deposit_amount);
  insert into public.device_events(organization_id, device_id, event_type, description, metadata)
  values (p_organization_id, p_device_id, 'rented', 'Aparelho vinculado ao contrato ' || contract_ref, jsonb_build_object('contract_id', contract_id));
  return contract_id;
end $$;

create or replace function public.record_installment_payment(p_installment_id uuid, p_amount numeric, p_method text, p_paid_at timestamptz, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  inst public.installments%rowtype;
  cont public.contracts%rowtype;
  payment_id uuid;
  total_due numeric;
  new_paid numeric;
begin
  select * into inst from public.installments where id = p_installment_id for update;
  if not found or inst.organization_id <> public.current_organization_id() or not public.has_role(array['admin','manager','finance']) then raise exception 'Parcela invalida ou sem permissao'; end if;
  select * into cont from public.contracts where id = inst.contract_id;
  total_due := inst.original_amount + inst.late_fee_amount + inst.interest_amount - inst.discount_amount;
  if p_amount <= 0 or inst.paid_amount + p_amount > total_due + 0.009 then raise exception 'Valor de pagamento invalido'; end if;
  if p_method not in ('pix','card','transfer','cash','other') then raise exception 'Meio de pagamento invalido'; end if;
  insert into public.payments(organization_id, installment_id, amount, method, paid_at, notes)
  values (inst.organization_id, inst.id, p_amount, p_method, p_paid_at, p_notes) returning id into payment_id;
  new_paid := inst.paid_amount + p_amount;
  update public.installments set paid_amount = new_paid, status = case when new_paid >= total_due then 'paid'::public.installment_status else 'partial'::public.installment_status end where id = inst.id;
  insert into public.cash_transactions(organization_id, device_id, contract_id, payment_id, kind, direction, amount, occurred_on, description)
  values (inst.organization_id, cont.device_id, cont.id, payment_id, 'rental_payment', 'in', p_amount, p_paid_at::date, 'Recebimento do contrato ' || cont.contract_number);
  return payment_id;
end $$;

create or replace function public.reverse_payment(p_payment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  pay public.payments%rowtype;
  inst public.installments%rowtype;
  cont public.contracts%rowtype;
  remaining numeric;
begin
  select * into pay from public.payments where id = p_payment_id for update;
  if not found or pay.organization_id <> public.current_organization_id() or not public.has_role(array['admin','manager','finance']) then raise exception 'Pagamento invalido ou sem permissao'; end if;
  if pay.status = 'reversed' then raise exception 'Pagamento ja estornado'; end if;
  select * into inst from public.installments where id = pay.installment_id for update;
  select * into cont from public.contracts where id = inst.contract_id;
  remaining := greatest(0, inst.paid_amount - pay.amount);
  update public.payments set status = 'reversed', reversed_at = now(), reversal_reason = p_reason where id = pay.id;
  update public.installments set paid_amount = remaining, status = case when remaining > 0 then 'partial'::public.installment_status when due_date < current_date then 'overdue'::public.installment_status else 'pending'::public.installment_status end where id = inst.id;
  update public.cash_transactions set status = 'reversed' where payment_id = pay.id;
  insert into public.cash_transactions(organization_id, device_id, contract_id, kind, direction, amount, occurred_on, description)
  values (pay.organization_id, cont.device_id, cont.id, 'payment_reversal', 'out', pay.amount, current_date, 'Estorno: ' || p_reason);
end $$;

create or replace function public.refresh_overdue_installments(p_as_of date default current_date)
returns integer language plpgsql security definer set search_path = public
as $$
declare affected integer;
begin
  if auth.role() <> 'service_role' and not public.has_role(array['admin','manager','finance']) then raise exception 'Sem permissao'; end if;
  update public.installments i
  set status = 'overdue',
      late_fee_amount = round(greatest(0, i.original_amount - i.discount_amount - i.paid_amount) * (c.late_fee_percent / 100), 2),
      interest_amount = round(greatest(0, i.original_amount - i.discount_amount - i.paid_amount) * (c.daily_interest_percent / 100) * greatest(0, p_as_of - i.due_date), 2)
  from public.contracts c
  where i.contract_id = c.id and i.due_date < p_as_of and i.status in ('pending','partial','overdue') and i.paid_amount < i.original_amount - i.discount_amount;
  get diagnostics affected = row_count;
  update public.contracts c set status = 'overdue' where c.status = 'active' and exists(select 1 from public.installments i where i.contract_id = c.id and i.status = 'overdue');
  return affected;
end $$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select using (id = public.current_organization_id());
drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations for update using (id = public.current_organization_id() and public.has_role(array['admin','manager'])) with check (id = public.current_organization_id());
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (organization_id = public.current_organization_id());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (organization_id = public.current_organization_id() and (id = auth.uid() or public.has_role(array['admin','manager']))) with check (organization_id = public.current_organization_id());

do $$
declare table_name text;
begin
  foreach table_name in array array['rental_clients','client_documents','client_risk_assessments','devices','device_photos','device_events','contracts','contract_amendments','maintenance_orders','inspections'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_select', table_name);
    execute format('create policy %I on public.%I for select using (organization_id = public.current_organization_id())', table_name || '_select', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_insert', table_name);
    execute format('create policy %I on public.%I for insert with check (organization_id = public.current_organization_id() and public.has_role(array[''admin'',''manager'',''operator'']))', table_name || '_insert', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update', table_name);
    execute format('create policy %I on public.%I for update using (organization_id = public.current_organization_id() and public.has_role(array[''admin'',''manager'',''operator''])) with check (organization_id = public.current_organization_id())', table_name || '_update', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_delete', table_name);
    execute format('create policy %I on public.%I for delete using (organization_id = public.current_organization_id() and public.has_role(array[''admin'',''manager'']))', table_name || '_delete', table_name);
  end loop;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array['installments','payments','cash_transactions','deposits','device_sales','billing_notifications'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_select', table_name);
    execute format('create policy %I on public.%I for select using (organization_id = public.current_organization_id())', table_name || '_select', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_insert', table_name);
    execute format('create policy %I on public.%I for insert with check (organization_id = public.current_organization_id() and public.has_role(array[''admin'',''manager'',''finance'']))', table_name || '_insert', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update', table_name);
    execute format('create policy %I on public.%I for update using (organization_id = public.current_organization_id() and public.has_role(array[''admin'',''manager'',''finance''])) with check (organization_id = public.current_organization_id())', table_name || '_update', table_name);
  end loop;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array['mdm_devices','mdm_commands'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_select', table_name);
    execute format('create policy %I on public.%I for select using (organization_id = public.current_organization_id())', table_name || '_select', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_write', table_name);
    execute format('create policy %I on public.%I for all using (organization_id = public.current_organization_id() and public.has_role(array[''admin'',''manager''])) with check (organization_id = public.current_organization_id())', table_name || '_write', table_name);
  end loop;
end $$;

alter table public.audit_logs enable row level security;
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select using (organization_id = public.current_organization_id() and public.has_role(array['admin','manager']));

insert into storage.buckets(id, name, public) values
  ('client-documents', 'client-documents', false),
  ('device-photos', 'device-photos', false),
  ('contracts', 'contracts', false),
  ('inspections', 'inspections', false),
  ('receipts', 'receipts', false),
  ('invoices', 'invoices', false)
on conflict (id) do update set public = false;

drop policy if exists rental_storage_select on storage.objects;
create policy rental_storage_select on storage.objects for select to authenticated
using (bucket_id in ('client-documents','device-photos','contracts','inspections','receipts','invoices') and split_part(name, '/', 1) = public.current_organization_id()::text);
drop policy if exists rental_storage_insert on storage.objects;
create policy rental_storage_insert on storage.objects for insert to authenticated
with check (bucket_id in ('client-documents','device-photos','contracts','inspections','receipts','invoices') and split_part(name, '/', 1) = public.current_organization_id()::text and public.has_role(array['admin','manager','finance','operator']));
drop policy if exists rental_storage_update on storage.objects;
create policy rental_storage_update on storage.objects for update to authenticated
using (split_part(name, '/', 1) = public.current_organization_id()::text and public.has_role(array['admin','manager']))
with check (split_part(name, '/', 1) = public.current_organization_id()::text);
drop policy if exists rental_storage_delete on storage.objects;
create policy rental_storage_delete on storage.objects for delete to authenticated
using (split_part(name, '/', 1) = public.current_organization_id()::text and public.has_role(array['admin']));

grant execute on function public.create_contract_with_installments(uuid,uuid,uuid,date,integer,integer,numeric,numeric,numeric,numeric,boolean,numeric) to authenticated;
grant execute on function public.record_installment_payment(uuid,numeric,text,timestamptz,text) to authenticated;
grant execute on function public.reverse_payment(uuid,text) to authenticated;
grant execute on function public.refresh_overdue_installments(date) to authenticated, service_role;
