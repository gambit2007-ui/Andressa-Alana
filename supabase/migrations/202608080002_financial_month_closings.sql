-- Fechamento financeiro mensal com snapshot imutavel e trilha de auditoria.
create table if not exists public.financial_month_closings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  month date not null check (month = date_trunc('month', month)::date),
  status text not null default 'closed' check (status in ('closed', 'reopened')),
  snapshot jsonb not null default '{}'::jsonb,
  closed_at timestamptz not null default now(),
  closed_by uuid references auth.users(id) on delete set null default auth.uid(),
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, month)
);

create index if not exists financial_month_closings_org_month_idx
  on public.financial_month_closings(organization_id, month desc);

drop trigger if exists set_financial_month_closings_updated_at on public.financial_month_closings;
create trigger set_financial_month_closings_updated_at
  before update on public.financial_month_closings
  for each row execute function public.set_updated_at();

drop trigger if exists audit_financial_month_closings_changes on public.financial_month_closings;
create trigger audit_financial_month_closings_changes
  after insert or update or delete on public.financial_month_closings
  for each row execute function public.audit_business_change();

alter table public.financial_month_closings enable row level security;
drop policy if exists financial_month_closings_select on public.financial_month_closings;
create policy financial_month_closings_select on public.financial_month_closings
  for select using (organization_id = public.current_organization_id());
drop policy if exists financial_month_closings_insert on public.financial_month_closings;
create policy financial_month_closings_insert on public.financial_month_closings
  for insert with check (
    organization_id = public.current_organization_id()
    and public.has_role(array['admin','manager'])
  );
drop policy if exists financial_month_closings_update on public.financial_month_closings;
create policy financial_month_closings_update on public.financial_month_closings
  for update using (
    organization_id = public.current_organization_id()
    and public.has_role(array['admin','manager'])
  ) with check (organization_id = public.current_organization_id());

create or replace function public.close_financial_month(
  p_organization_id uuid,
  p_month date,
  p_snapshot jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  closing_id uuid;
begin
  if p_organization_id <> public.current_organization_id()
    or not public.has_role(array['admin','manager']) then
    raise exception 'Sem permissao para fechar o mes financeiro';
  end if;
  if p_month <> date_trunc('month', p_month)::date then
    raise exception 'O mes deve ser informado pelo primeiro dia';
  end if;
  if p_month > date_trunc('month', current_date)::date then
    raise exception 'Nao e permitido fechar uma competencia futura';
  end if;

  insert into public.financial_month_closings(
    organization_id, month, status, snapshot, closed_at, closed_by, reopened_at, reopened_by
  ) values (
    p_organization_id, p_month, 'closed', p_snapshot, now(), auth.uid(), null, null
  )
  on conflict (organization_id, month) do update set
    status = 'closed',
    snapshot = excluded.snapshot,
    closed_at = now(),
    closed_by = auth.uid(),
    reopened_at = null,
    reopened_by = null
  returning id into closing_id;

  return closing_id;
end;
$$;

create or replace function public.reopen_financial_month(p_closing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(array['admin','manager']) then
    raise exception 'Sem permissao para reabrir o mes financeiro';
  end if;

  update public.financial_month_closings
  set status = 'reopened', reopened_at = now(), reopened_by = auth.uid()
  where id = p_closing_id
    and organization_id = public.current_organization_id();

  if not found then raise exception 'Fechamento financeiro nao encontrado'; end if;
end;
$$;

grant execute on function public.close_financial_month(uuid, date, jsonb) to authenticated;
grant execute on function public.reopen_financial_month(uuid) to authenticated;
grant select on table public.financial_month_closings to authenticated;
revoke insert, update, delete on table public.financial_month_closings from anon, authenticated;

create or replace function public.assert_financial_month_open(p_organization_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.financial_month_closings
    where organization_id = p_organization_id
      and month = date_trunc('month', p_date)::date
      and status = 'closed'
  ) then
    raise exception 'O mes financeiro % esta fechado. Reabra o mes antes de alterar lancamentos.', to_char(p_date, 'MM/YYYY');
  end if;
end;
$$;

revoke all on function public.assert_financial_month_open(uuid, date) from public, anon, authenticated;

create or replace function public.protect_closed_financial_month()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_date date;
  new_date date;
  old_organization uuid;
  new_organization uuid;
begin
  if tg_op <> 'INSERT' then
    old_organization := old.organization_id;
    old_date := case tg_table_name
      when 'cash_transactions' then old.occurred_on::date
      when 'payments' then old.paid_at::date
      when 'device_sales' then old.sold_at::date
      when 'devices' then old.purchase_date::date
    end;
    perform public.assert_financial_month_open(old_organization, old_date);
  end if;

  if tg_op <> 'DELETE' then
    new_organization := new.organization_id;
    new_date := case tg_table_name
      when 'cash_transactions' then new.occurred_on::date
      when 'payments' then new.paid_at::date
      when 'device_sales' then new.sold_at::date
      when 'devices' then new.purchase_date::date
    end;
    perform public.assert_financial_month_open(new_organization, new_date);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.protect_closed_financial_month() from public, anon, authenticated;

drop trigger if exists protect_cash_transactions_closed_month on public.cash_transactions;
create trigger protect_cash_transactions_closed_month
  before insert or update or delete on public.cash_transactions
  for each row execute function public.protect_closed_financial_month();

drop trigger if exists protect_payments_closed_month on public.payments;
create trigger protect_payments_closed_month
  before insert or update or delete on public.payments
  for each row execute function public.protect_closed_financial_month();

drop trigger if exists protect_device_sales_closed_month on public.device_sales;
create trigger protect_device_sales_closed_month
  before insert or update or delete on public.device_sales
  for each row execute function public.protect_closed_financial_month();

drop trigger if exists protect_devices_closed_month_insert_delete on public.devices;
create trigger protect_devices_closed_month_insert_delete
  before insert or delete on public.devices
  for each row execute function public.protect_closed_financial_month();

drop trigger if exists protect_devices_closed_month_update on public.devices;
create trigger protect_devices_closed_month_update
  before update of purchase_date, purchase_amount on public.devices
  for each row execute function public.protect_closed_financial_month();
