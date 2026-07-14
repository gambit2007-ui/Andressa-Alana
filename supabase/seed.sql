-- Dados demonstrativos idempotentes. Execute somente em desenvolvimento/homologacao.
do $$
declare org_id uuid;
begin
  select id into org_id from public.organizations where slug = 'gr-solution' limit 1;
  if org_id is null then raise exception 'A migration GR Solution Rental precisa ser aplicada antes do seed'; end if;

  insert into public.rental_clients(id, organization_id, full_name, cpf, rg, phone, email, profession, monthly_income, city, state, internal_risk_score, risk_label)
  values
    ('10000000-0000-0000-0000-000000000001', org_id, 'Marina Oliveira', '12345678901', '123456789', '(11) 99999-0101', 'marina@example.com', 'Arquiteta', 9200, 'Sao Paulo', 'SP', 820, 'baixo'),
    ('10000000-0000-0000-0000-000000000002', org_id, 'Rafael Costa', '98765432100', '987654321', '(21) 98888-0202', 'rafael@example.com', 'Analista', 6500, 'Rio de Janeiro', 'RJ', 690, 'moderado')
  on conflict (organization_id, cpf) do nothing;

  insert into public.devices(id, organization_id, model, color, capacity_gb, imei_1, imei_2, serial_number, battery_health, purchase_date, purchase_amount, supplier, condition, market_value, status, apple_business_registered, mdm_enrolled)
  values
    ('20000000-0000-0000-0000-000000000001', org_id, 'iPhone 15 Pro Max', 'Titanio Natural', 256, '350000000000001', '350000000000002', 'GR15PM0001', 96, current_date - 180, 7200, 'Apple Distribuidor', 'Excelente', 6600, 'rented', true, true),
    ('20000000-0000-0000-0000-000000000002', org_id, 'iPhone 14 Pro', 'Roxo Profundo', 128, '350000000000003', '350000000000004', 'GR14PRO002', 88, current_date - 360, 5100, 'Apple Distribuidor', 'Bom', 4200, 'available', true, false)
  on conflict (organization_id, imei_1) do nothing;

  insert into public.contracts(id, organization_id, client_id, device_id, contract_number, start_date, end_date, due_day, term_months, monthly_amount, deposit_amount, late_fee_percent, daily_interest_percent, purchase_option, purchase_option_amount, status)
  values ('30000000-0000-0000-0000-000000000001', org_id, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'GR-DEMO-001', (date_trunc('month', current_date) - interval '2 months')::date, (date_trunc('month', current_date) + interval '10 months')::date, 10, 12, 699, 900, 2, 0.033, true, 3500, 'active')
  on conflict (organization_id, contract_number) do nothing;

  insert into public.installments(id, organization_id, contract_id, installment_number, due_date, original_amount, paid_amount, status)
  values
    ('40000000-0000-0000-0000-000000000001', org_id, '30000000-0000-0000-0000-000000000001', 1, (date_trunc('month', current_date) - interval '1 month' + interval '9 days')::date, 699, 699, 'paid'),
    ('40000000-0000-0000-0000-000000000002', org_id, '30000000-0000-0000-0000-000000000001', 2, (date_trunc('month', current_date) + interval '9 days')::date, 699, 0, 'pending'),
    ('40000000-0000-0000-0000-000000000003', org_id, '30000000-0000-0000-0000-000000000001', 3, (date_trunc('month', current_date) + interval '1 month 9 days')::date, 699, 0, 'pending')
  on conflict (contract_id, installment_number) do nothing;

  insert into public.payments(id, organization_id, installment_id, amount, method, paid_at, notes)
  values ('50000000-0000-0000-0000-000000000001', org_id, '40000000-0000-0000-0000-000000000001', 699, 'pix', date_trunc('month', current_date) - interval '20 days', 'Pagamento demonstrativo')
  on conflict (id) do nothing;

  insert into public.cash_transactions(id, organization_id, device_id, contract_id, payment_id, kind, direction, amount, occurred_on, description)
  values ('60000000-0000-0000-0000-000000000001', org_id, '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'rental_payment', 'in', 699, (date_trunc('month', current_date) - interval '20 days')::date, 'Recebimento demonstrativo')
  on conflict (id) do nothing;

  insert into public.deposits(organization_id, contract_id, amount, status, received_at)
  values (org_id, '30000000-0000-0000-0000-000000000001', 900, 'held', now() - interval '2 months')
  on conflict (contract_id) do nothing;
end $$;
