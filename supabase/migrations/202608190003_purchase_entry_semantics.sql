-- Mantem os nomes tecnicos legados, mas trata o deposito como entrada de compra nao reembolsavel.

update public.deposits
set notes = 'Entrada contratual nao reembolsavel destinada a compra futura'
where amount > 0
  and status in ('held', 'applied')
  and coalesce(notes, '') <> 'Entrada contratual nao reembolsavel destinada a compra futura';

update public.cash_transactions cash_entry
set description = 'Entrada de compra recebida no contrato ' || contract.contract_number
from public.contracts contract
where cash_entry.contract_id = contract.id
  and cash_entry.kind = 'deposit_received'
  and cash_entry.description is distinct from 'Entrada de compra recebida no contrato ' || contract.contract_number;

create or replace function public.normalize_purchase_entry_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  contract_ref text;
begin
  if new.kind <> 'deposit_received' then
    return new;
  end if;

  select contract_number into contract_ref
  from public.contracts
  where id = new.contract_id;

  new.description := case
    when contract_ref is not null then 'Entrada de compra recebida no contrato ' || contract_ref
    else 'Entrada de compra recebida'
  end;
  return new;
end
$$;

drop trigger if exists normalize_purchase_entry_transaction on public.cash_transactions;
create trigger normalize_purchase_entry_transaction
before insert or update of kind, contract_id, description
on public.cash_transactions
for each row
when (new.kind = 'deposit_received')
execute function public.normalize_purchase_entry_transaction();

comment on column public.deposits.status is
  'Campo legado: held representa entrada de compra recebida e nao implica valor reembolsavel.';
