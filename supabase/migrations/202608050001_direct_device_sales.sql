alter table public.device_sales
  add column if not exists payment_method text,
  add column if not exists notes text;

update public.device_sales
set payment_method = 'other'
where payment_method is null;

alter table public.device_sales
  alter column payment_method set default 'other',
  alter column payment_method set not null;

alter table public.device_sales
  drop constraint if exists device_sales_payment_method_check;
alter table public.device_sales
  add constraint device_sales_payment_method_check
  check (payment_method in ('pix', 'card', 'transfer', 'cash', 'other'));

alter table public.cash_transactions
  add column if not exists device_sale_id uuid references public.device_sales(id) on delete restrict;

create unique index if not exists cash_transactions_device_sale_unique
  on public.cash_transactions(device_sale_id)
  where device_sale_id is not null and kind = 'device_sale' and status = 'confirmed';

create or replace function public.create_direct_device_sale(
  p_organization_id uuid,
  p_device_id uuid,
  p_client_id uuid,
  p_sale_amount numeric,
  p_sold_at timestamptz,
  p_payment_method text,
  p_serial_confirmation text,
  p_apple_release_confirmed boolean,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_id_value uuid := gen_random_uuid();
  device_row public.devices%rowtype;
  client_name text;
  release_confirmed boolean;
  payment_label text;
begin
  if p_organization_id <> public.current_organization_id()
    or not public.has_role(array['admin', 'manager', 'finance']) then
    raise exception 'Sem permissao para registrar venda direta';
  end if;

  if p_sale_amount is null or p_sale_amount <= 0
    or p_sold_at is null
    or p_sold_at > now() + interval '5 minutes'
    or p_payment_method not in ('pix', 'card', 'transfer', 'cash', 'other')
    or char_length(coalesce(p_notes, '')) > 1000 then
    raise exception 'Dados da venda invalidos';
  end if;

  select rental_client.full_name into client_name
  from public.rental_clients rental_client
  where rental_client.id = p_client_id
    and rental_client.organization_id = p_organization_id;
  if not found then
    raise exception 'Cliente invalido';
  end if;

  select * into device_row
  from public.devices device
  where device.id = p_device_id
    and device.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'Aparelho invalido';
  end if;
  if device_row.status <> 'available' then
    raise exception 'Somente aparelhos disponiveis podem ser vendidos';
  end if;
  if upper(btrim(coalesce(p_serial_confirmation, ''))) <> upper(btrim(device_row.serial_number)) then
    raise exception 'Numero de serie nao confere';
  end if;
  if device_row.mdm_enrolled and not coalesce(p_apple_release_confirmed, false) then
    raise exception 'Confirme a remocao do Apple Business/MDM antes da venda';
  end if;
  if exists (
    select 1 from public.contracts contract
    where contract.device_id = device_row.id
      and contract.status in ('active', 'overdue', 'draft', 'renegotiated')
  ) then
    raise exception 'Aparelho possui contrato em aberto';
  end if;

  release_confirmed := not device_row.mdm_enrolled or coalesce(p_apple_release_confirmed, false);
  payment_label := case p_payment_method
    when 'pix' then 'Pix'
    when 'card' then 'Cartao'
    when 'transfer' then 'Transferencia'
    when 'cash' then 'Dinheiro'
    else 'Outros'
  end;

  insert into public.device_sales(
    id, organization_id, device_id, client_id, sale_amount, sold_at,
    payment_method, paid_in_full, apple_release_confirmed, confirmed_by, notes
  ) values (
    sale_id_value, p_organization_id, p_device_id, p_client_id, p_sale_amount, p_sold_at,
    p_payment_method, true, release_confirmed, auth.uid(), nullif(btrim(p_notes), '')
  );

  insert into public.cash_transactions(
    organization_id, device_id, device_sale_id, kind, direction,
    amount, occurred_on, description, status
  ) values (
    p_organization_id, p_device_id, sale_id_value, 'device_sale', 'in',
    p_sale_amount, p_sold_at::date,
    'Venda direta de ' || device_row.model || ' para ' || client_name || ' via ' || payment_label,
    'confirmed'
  );

  update public.devices
  set status = 'sold',
      mdm_enrolled = false,
      apple_business_registered = false
  where id = device_row.id;

  update public.mdm_devices
  set status = 'unmanaged',
      last_sync_at = now()
  where device_id = device_row.id;

  insert into public.device_events(
    organization_id, device_id, event_type, description, actor_id, metadata
  ) values (
    p_organization_id,
    p_device_id,
    'direct_sale_completed',
    'Venda direta quitada para ' || client_name,
    auth.uid(),
    jsonb_build_object(
      'sale_id', sale_id_value,
      'client_id', p_client_id,
      'sale_amount', p_sale_amount,
      'payment_method', p_payment_method,
      'apple_release_confirmed', release_confirmed
    )
  );

  return sale_id_value;
end $$;

revoke all on function public.create_direct_device_sale(uuid, uuid, uuid, numeric, timestamptz, text, text, boolean, text) from public;
grant execute on function public.create_direct_device_sale(uuid, uuid, uuid, numeric, timestamptz, text, text, boolean, text) to authenticated;
