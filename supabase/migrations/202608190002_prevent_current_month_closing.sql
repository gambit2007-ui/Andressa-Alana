-- A competencia em andamento precisa continuar aberta para novos recebimentos e saidas.
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
  if p_month >= date_trunc('month', current_date)::date then
    raise exception 'Somente competencias anteriores podem ser fechadas';
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
end $$;

revoke all on function public.close_financial_month(uuid, date, jsonb) from public;
grant execute on function public.close_financial_month(uuid, date, jsonb) to authenticated;
