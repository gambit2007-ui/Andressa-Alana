import { supabase } from '../lib/supabase';
import type {
  AuditLog,
  CashTransaction,
  Client,
  ClientDocumentKind,
  Contract,
  ContractDocument,
  ContractDocumentType,
  Device,
  DevicePhoto,
  DeviceSale,
  FinancialMonthClosing,
  Installment,
  MdmCommand,
  MdmDevice,
  Payment,
  OrganizationContractSettings,
} from '../types';
import type {
  CashTransactionFormData,
  ClientFormData,
  ContractFormData,
  DirectDeviceSaleFormData,
  DeviceFormData,
  OrganizationContractSettingsFormData,
} from '../schemas/forms';

const db = () => {
  if (!supabase) throw new Error('Supabase nao configurado.');
  return supabase;
};

const throwIfError = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

const toMoney = (value: unknown): number => Number(value ?? 0);

const normalizeClient = (row: Client): Client => ({
  ...row,
  monthly_income: toMoney(row.monthly_income),
  internal_risk_score: Number(row.internal_risk_score ?? 0),
});

const normalizeDevice = (row: Device): Device => ({
  ...row,
  capacity_gb: Number(row.capacity_gb),
  battery_health: Number(row.battery_health),
  purchase_amount: toMoney(row.purchase_amount),
  market_value: toMoney(row.market_value),
  indemnity_value: row.indemnity_value == null ? null : toMoney(row.indemnity_value),
  accessories: Array.isArray(row.accessories) ? row.accessories : [],
});

const normalizeDeviceSale = (row: DeviceSale): DeviceSale => ({
  ...row,
  sale_amount: toMoney(row.sale_amount),
  device: row.device ? { ...row.device, purchase_amount: toMoney(row.device.purchase_amount) } : undefined,
});

const normalizeContract = (row: Contract): Contract => ({
  ...row,
  due_day: Number(row.due_day),
  term_months: Number(row.term_months),
  monthly_amount: toMoney(row.monthly_amount),
  deposit_amount: toMoney(row.deposit_amount),
  deposit_as_first_installment: Boolean(row.deposit_as_first_installment),
  indemnity_value: row.indemnity_value == null ? null : toMoney(row.indemnity_value),
  late_fee_percent: toMoney(row.late_fee_percent),
  daily_interest_percent: toMoney(row.daily_interest_percent),
  purchase_option_amount: row.purchase_option_amount === null ? null : toMoney(row.purchase_option_amount),
});

const normalizeInstallment = (row: Installment): Installment => ({
  ...row,
  installment_number: Number(row.installment_number),
  original_amount: toMoney(row.original_amount),
  discount_amount: toMoney(row.discount_amount),
  late_fee_amount: toMoney(row.late_fee_amount),
  interest_amount: toMoney(row.interest_amount),
  paid_amount: toMoney(row.paid_amount),
  contract: row.contract ? normalizeContract(row.contract) : undefined,
});

export async function listClients(): Promise<Client[]> {
  const { data, error } = await db().from('rental_clients').select('*').order('full_name');
  throwIfError(error);
  return ((data ?? []) as unknown as Client[]).map(normalizeClient);
}

const clientWritePayload = (values: ClientFormData) => {
  const riskScore = Number(values.internal_risk_score);
  return {
    full_name: values.full_name,
    cpf: values.cpf.replace(/\D/g, ''),
    rg: values.rg || null,
    birth_date: values.birth_date || null,
    phone: values.phone,
    secondary_phone: values.secondary_phone || null,
    email: values.email || null,
    profession: values.profession || null,
    monthly_income: values.monthly_income,
    address_line: values.address_line || null,
    address_number: values.address_number || null,
    address_complement: values.address_complement || null,
    neighborhood: values.neighborhood || null,
    city: values.city || null,
    state: values.state?.toUpperCase() || null,
    postal_code: values.postal_code || null,
    work_address: values.work_address || null,
    reference_name: values.reference_name || null,
    reference_phone: values.reference_phone || null,
    internal_risk_score: riskScore,
    risk_label: riskScore >= 800 ? 'baixo' : riskScore >= 600 ? 'moderado' : riskScore >= 400 ? 'atencao' : 'alto',
    notes: values.notes || null,
  };
};

export async function createClient(organizationId: string, values: ClientFormData): Promise<Client> {
  const payload = clientWritePayload(values);
  const { data, error } = await db().from('rental_clients').insert({
    organization_id: organizationId,
    ...payload,
  }).select('*').single();
  throwIfError(error);
  const client = normalizeClient(data as unknown as Client);

  const { error: riskError } = await db().from('client_risk_assessments').insert({
    organization_id: organizationId,
    client_id: client.id,
    score: payload.internal_risk_score,
    classification: payload.risk_label,
    source: 'internal',
    notes: 'Classificacao interna da Vantage iPhones; nao representa score de bureau.',
  });
  throwIfError(riskError);
  return client;
}

export async function updateClient(organizationId: string, clientId: string, values: ClientFormData): Promise<Client> {
  const payload = clientWritePayload(values);
  const { data, error } = await db().from('rental_clients')
    .update(payload)
    .eq('organization_id', organizationId)
    .eq('id', clientId)
    .select('*')
    .single();
  throwIfError(error);
  const client = normalizeClient(data as unknown as Client);

  const { error: riskError } = await db().from('client_risk_assessments').insert({
    organization_id: organizationId,
    client_id: clientId,
    score: payload.internal_risk_score,
    classification: payload.risk_label,
    source: 'internal',
    notes: 'Classificacao atualizada pelo painel.',
  });
  throwIfError(riskError);
  return client;
}

const safeFileName = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '-');

export async function uploadClientDocument(input: {
  organizationId: string;
  clientId: string;
  kind: ClientDocumentKind;
  file: File;
}): Promise<void> {
  const path = `${input.organizationId}/${input.clientId}/${input.kind}/${crypto.randomUUID()}-${safeFileName(input.file.name)}`;
  const { error: uploadError } = await db().storage.from('client-documents').upload(path, input.file, {
    upsert: false,
    contentType: input.file.type,
  });
  throwIfError(uploadError);
  const { error } = await db().from('client_documents').insert({
    organization_id: input.organizationId,
    client_id: input.clientId,
    kind: input.kind,
    bucket_id: 'client-documents',
    storage_path: path,
    file_name: input.file.name,
    mime_type: input.file.type,
    file_size: input.file.size,
  });
  throwIfError(error);
}

export async function listDevices(): Promise<Device[]> {
  const { data, error } = await db().from('devices').select('*').order('created_at', { ascending: false });
  throwIfError(error);
  return ((data ?? []) as unknown as Device[]).map(normalizeDevice);
}

export async function listDevicePhotos(deviceId: string): Promise<DevicePhoto[]> {
  const { data, error } = await db()
    .from('device_photos')
    .select('*')
    .eq('device_id', deviceId)
    .order('created_at');
  throwIfError(error);
  const photos = (data ?? []) as unknown as DevicePhoto[];
  return Promise.all(photos.map(async (photo) => {
    const { data: signedData, error: signedError } = await db().storage
      .from(photo.bucket_id)
      .createSignedUrl(photo.storage_path, 3600);
    return { ...photo, signed_url: signedError ? null : signedData.signedUrl };
  }));
}

export async function uploadDevicePhotos(input: {
  organizationId: string;
  deviceId: string;
  files: File[];
}): Promise<{ uploaded: number; failed: string[] }> {
  const results = await Promise.allSettled(input.files.map(async (file) => {
    const path = `${input.organizationId}/${input.deviceId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await db().storage.from('device-photos').upload(path, file, {
      upsert: false,
      contentType: file.type,
      cacheControl: '3600',
    });
    throwIfError(uploadError);

    const caption = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Foto do aparelho';
    const { error: metadataError } = await db().from('device_photos').insert({
      organization_id: input.organizationId,
      device_id: input.deviceId,
      bucket_id: 'device-photos',
      storage_path: path,
      caption,
    });
    if (metadataError) {
      await db().storage.from('device-photos').remove([path]);
      throwIfError(metadataError);
    }
  }));

  const failed = results.flatMap((result, index) => result.status === 'rejected'
    ? [`${input.files[index]?.name ?? 'Imagem'}: ${result.reason instanceof Error ? result.reason.message : 'falha no envio'}`]
    : []);
  return { uploaded: results.length - failed.length, failed };
}

const deviceWritePayload = (values: DeviceFormData) => ({
  model: values.model,
  color: values.color,
  capacity_gb: values.capacity_gb,
  imei_1: values.imei_1,
  imei_2: values.imei_2 || null,
  serial_number: values.serial_number.toUpperCase(),
  battery_health: values.battery_health,
  purchase_date: values.purchase_date,
  purchase_amount: values.purchase_amount,
  supplier: values.supplier || null,
  invoice_number: values.invoice_number || null,
  warranty_until: values.warranty_until || null,
  condition: values.condition,
  accessories: values.accessories.split(',').map((item) => item.trim()).filter(Boolean),
  market_value: values.market_value,
  indemnity_value: values.indemnity_value,
  notes: values.notes || null,
  apple_business_registered: values.mdm_enrolled,
  mdm_enrolled: values.mdm_enrolled,
});

export async function createDevice(organizationId: string, values: DeviceFormData): Promise<Device> {
  const { data, error } = await db().from('devices').insert({
    organization_id: organizationId,
    ...deviceWritePayload(values),
    status: 'available',
  }).select('*').single();
  throwIfError(error);
  return normalizeDevice(data as unknown as Device);
}

export async function updateDevice(organizationId: string, deviceId: string, values: DeviceFormData): Promise<Device> {
  const { data, error } = await db()
    .from('devices')
    .update(deviceWritePayload(values))
    .eq('organization_id', organizationId)
    .eq('id', deviceId)
    .select('*')
    .single();
  throwIfError(error);
  return normalizeDevice(data as unknown as Device);
}

export async function listDeviceSales(): Promise<DeviceSale[]> {
  const { data, error } = await db()
    .from('device_sales')
    .select('*,client:rental_clients(id,full_name,cpf),device:devices(id,model,serial_number,status,purchase_amount,mdm_enrolled)')
    .order('sold_at', { ascending: false });
  throwIfError(error);
  return ((data ?? []) as unknown as DeviceSale[]).map(normalizeDeviceSale);
}

export async function createDirectDeviceSale(
  organizationId: string,
  values: DirectDeviceSaleFormData,
): Promise<string> {
  const { data, error } = await db().rpc('create_direct_device_sale', {
    p_organization_id: organizationId,
    p_device_id: values.device_id,
    p_client_id: values.client_id || null,
    p_sale_amount: values.sale_amount,
    p_sold_at: new Date(values.sold_at).toISOString(),
    p_payment_method: values.payment_method,
    p_serial_confirmation: values.serial_confirmation.trim().toUpperCase(),
    p_apple_release_confirmed: values.apple_release_confirmed,
    p_buyer_name: values.buyer_name.trim() || null,
    p_notes: values.notes?.trim() || null,
  });
  throwIfError(error);
  return String(data);
}

export async function listContracts(): Promise<Contract[]> {
  const { data, error } = await db()
    .from('contracts')
    .select('*,client:rental_clients(id,full_name,cpf),device:devices(id,model,serial_number,status)')
    .order('created_at', { ascending: false });
  throwIfError(error);
  return ((data ?? []) as unknown as Contract[]).map(normalizeContract);
}

export async function createContract(organizationId: string, values: ContractFormData): Promise<string> {
  const { data, error } = await db().rpc('create_contract_with_separate_deposit', {
    p_organization_id: organizationId,
    p_client_id: values.client_id,
    p_device_id: values.device_id,
    p_start_date: values.start_date,
    p_first_installment_date: values.first_installment_date,
    p_due_day: values.due_day,
    p_term_months: values.term_months,
    p_monthly_amount: values.monthly_amount,
    p_deposit_amount: values.deposit_amount,
    p_deposit_paid_at: values.deposit_amount > 0 ? values.deposit_paid_at : null,
    p_deposit_payment_method: values.deposit_amount > 0 ? values.deposit_payment_method : null,
    p_late_fee_percent: values.late_fee_percent,
    p_daily_interest_percent: values.daily_interest_percent,
    p_indemnity_value: values.indemnity_value,
    p_purchase_option: values.purchase_option,
    p_purchase_option_amount: values.purchase_option ? values.purchase_option_amount : null,
    p_delivery_checklist: values.delivery_checklist,
  });
  throwIfError(error);
  return String(data);
}

export async function updateContract(contractId: string, values: ContractFormData, legacyMode = false): Promise<string> {
  const functionName = legacyMode
    ? 'update_contract_with_installments'
    : 'update_contract_with_separate_deposit';
  const commonPayload = {
    p_contract_id: contractId,
    p_client_id: values.client_id,
    p_device_id: values.device_id,
    p_start_date: values.start_date,
    p_due_day: values.due_day,
    p_term_months: values.term_months,
    p_monthly_amount: values.monthly_amount,
    p_deposit_amount: values.deposit_amount,
    p_late_fee_percent: values.late_fee_percent,
    p_daily_interest_percent: values.daily_interest_percent,
    p_purchase_option: values.purchase_option,
    p_purchase_option_amount: values.purchase_option ? values.purchase_option_amount : null,
  };
  const payload = legacyMode ? commonPayload : {
    ...commonPayload,
    p_first_installment_date: values.first_installment_date,
    p_deposit_paid_at: values.deposit_amount > 0 ? values.deposit_paid_at : null,
    p_deposit_payment_method: values.deposit_amount > 0 ? values.deposit_payment_method : null,
    p_indemnity_value: values.indemnity_value,
    p_delivery_checklist: values.delivery_checklist,
  };
  const { data, error } = await db().rpc(functionName, payload);
  throwIfError(error);
  return String(data);
}

export async function listContractDocuments(): Promise<ContractDocument[]> {
  const { data, error } = await db()
    .from('contract_documents')
    .select('*')
    .order('version', { ascending: false });
  throwIfError(error);
  return (data ?? []) as unknown as ContractDocument[];
}

export async function getOrganizationContractSettings(): Promise<OrganizationContractSettings | null> {
  const { data, error } = await db()
    .from('organization_contract_settings')
    .select('*')
    .maybeSingle();
  throwIfError(error);
  return data as OrganizationContractSettings | null;
}

export async function saveOrganizationContractSettings(
  organizationId: string,
  values: OrganizationContractSettingsFormData,
): Promise<OrganizationContractSettings> {
  const { data, error } = await db()
    .from('organization_contract_settings')
    .upsert({
      organization_id: organizationId,
      legal_name: values.legal_name,
      tax_id: values.tax_id || null,
      address: values.address || null,
      phone: values.phone || null,
      email: values.email || null,
      city: values.city || null,
      default_venue: values.default_venue || null,
    }, { onConflict: 'organization_id' })
    .select('*')
    .single();
  throwIfError(error);
  return data as OrganizationContractSettings;
}

export async function generateContractDocument(
  contractId: string,
  documentType: ContractDocumentType,
  reason?: string,
): Promise<ContractDocument> {
  const { data: sessionData, error: sessionError } = await db().auth.getSession();
  throwIfError(sessionError);
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Sua sessao expirou. Entre novamente.');

  const endpoint = documentType === 'rental_contract' ? 'generate-pdf' : 'generate-delivery-term';
  const response = await fetch(`/api/contracts/${contractId}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: reason?.trim() || null }),
  });
  const result = await response.json().catch(() => null) as { document?: ContractDocument; error?: string } | null;
  if (!response.ok || !result?.document) {
    throw new Error(result?.error || 'Nao foi possivel gerar o documento.');
  }
  return result.document;
}

export async function createContractDocumentSignedUrl(
  document: ContractDocument,
  download = false,
): Promise<string> {
  const { data, error } = await db().storage.from(document.bucket_id).createSignedUrl(
    document.storage_path,
    300,
    download ? { download: document.file_name } : undefined,
  );
  throwIfError(error);
  if (!data?.signedUrl) throw new Error('Nao foi possivel criar o link seguro.');
  return data.signedUrl;
}

export async function listInstallments(): Promise<Installment[]> {
  const { data, error } = await db()
    .from('installments')
    .select('*,contract:contracts(*,client:rental_clients(id,full_name,cpf),device:devices(id,model,serial_number,status))')
    .order('due_date');
  throwIfError(error);
  return ((data ?? []) as unknown as Installment[]).map(normalizeInstallment);
}

export async function listPayments(): Promise<Payment[]> {
  const { data, error } = await db()
    .from('payments')
    .select('*,installment:installments(*,contract:contracts(*,client:rental_clients(id,full_name,cpf),device:devices(id,model,serial_number,status)))')
    .order('paid_at', { ascending: false });
  throwIfError(error);
  return ((data ?? []) as unknown as Payment[]).map((row) => ({
    ...row,
    amount: toMoney(row.amount),
    installment: row.installment ? normalizeInstallment(row.installment) : undefined,
  }));
}

export async function listCashTransactions(): Promise<CashTransaction[]> {
  const { data, error } = await db().from('cash_transactions').select('*').order('occurred_on', { ascending: false });
  throwIfError(error);
  return ((data ?? []) as unknown as CashTransaction[]).map((row) => ({ ...row, amount: toMoney(row.amount) }));
}

export async function listFinancialMonthClosings(): Promise<{ items: FinancialMonthClosing[]; available: boolean }> {
  const { data, error } = await db()
    .from('financial_month_closings')
    .select('*')
    .order('month', { ascending: false });
  if (error && ['PGRST205', '42P01'].includes((error as { code?: string }).code ?? '')) {
    return { items: [], available: false };
  }
  throwIfError(error);
  return { items: (data ?? []) as unknown as FinancialMonthClosing[], available: true };
}

export async function closeFinancialMonth(
  organizationId: string,
  month: string,
  snapshot: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await db().rpc('close_financial_month', {
    p_organization_id: organizationId,
    p_month: `${month}-01`,
    p_snapshot: snapshot,
  });
  throwIfError(error);
  return String(data);
}

export async function reopenFinancialMonth(closingId: string): Promise<void> {
  const { error } = await db().rpc('reopen_financial_month', { p_closing_id: closingId });
  throwIfError(error);
}

export async function createCashTransaction(
  organizationId: string,
  values: CashTransactionFormData,
): Promise<CashTransaction> {
  const { data, error } = await db().from('cash_transactions').insert({
    organization_id: organizationId,
    kind: values.kind,
    direction: values.direction,
    amount: values.amount,
    occurred_on: values.occurred_on,
    description: values.description,
    status: 'confirmed',
  }).select('*').single();
  throwIfError(error);
  const row = data as unknown as CashTransaction;
  return { ...row, amount: toMoney(row.amount) };
}

export type CashLedgerConsolidationResult = {
  reversedContributions: number;
  contributionCreated: boolean;
  freightCreated: boolean;
};

const consolidatedContributionDescription = 'Aporte unico para compras e operacoes';
const wendelFreightDescription = 'Frete Wendel';

export async function consolidateCashLedger(
  organizationId: string,
  occurredOn: string,
): Promise<CashLedgerConsolidationResult> {
  const client = db();
  const { data: contributionData, error: contributionError } = await client
    .from('cash_transactions')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('kind', 'capital_contribution')
    .eq('direction', 'in');
  throwIfError(contributionError);

  const contributions = ((contributionData ?? []) as unknown as CashTransaction[])
    .filter((transaction) => transaction.status === 'confirmed');
  let canonicalContribution = contributions.find((transaction) => (
    toMoney(transaction.amount) === 24000
    && transaction.description.trim().toLowerCase() === consolidatedContributionDescription.toLowerCase()
  ));
  let contributionCreated = false;

  if (!canonicalContribution) {
    const { data, error } = await client.from('cash_transactions').insert({
      organization_id: organizationId,
      kind: 'capital_contribution',
      direction: 'in',
      amount: 24000,
      occurred_on: occurredOn,
      description: consolidatedContributionDescription,
      status: 'confirmed',
    }).select('*').single();
    throwIfError(error);
    canonicalContribution = data as unknown as CashTransaction;
    contributionCreated = true;
  }

  const contributionIdsToReverse = contributions
    .filter((transaction) => transaction.id !== canonicalContribution?.id)
    .map((transaction) => transaction.id);
  if (contributionIdsToReverse.length > 0) {
    const { error } = await client.from('cash_transactions')
      .update({ status: 'reversed' })
      .in('id', contributionIdsToReverse);
    throwIfError(error);
  }

  const { data: freightData, error: freightQueryError } = await client
    .from('cash_transactions')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('direction', 'out')
    .eq('amount', 1200)
    .eq('status', 'confirmed');
  throwIfError(freightQueryError);

  const freightRows = (freightData ?? []) as unknown as CashTransaction[];
  const describedFreightRows = freightRows.filter((transaction) => {
    const description = transaction.description.trim().toLowerCase();
    return description.includes('frete') || description.includes('wendel');
  });
  const supplierRows = freightRows.filter((transaction) => transaction.kind === 'supplier');
  const freightCandidates = [...new Map([
    ...describedFreightRows,
    ...(supplierRows.length === 1 ? supplierRows : []),
  ].map((transaction) => [transaction.id, transaction])).values()];
  let canonicalFreight = freightCandidates.find((transaction) => transaction.kind === 'operating_expense')
    ?? freightCandidates[0];
  let freightCreated = false;

  if (!canonicalFreight) {
    const { error } = await client.from('cash_transactions').insert({
      organization_id: organizationId,
      kind: 'operating_expense',
      direction: 'out',
      amount: 1200,
      occurred_on: occurredOn,
      description: wendelFreightDescription,
      status: 'confirmed',
    });
    throwIfError(error);
    freightCreated = true;
  } else if (canonicalFreight.kind !== 'operating_expense'
    || canonicalFreight.description !== wendelFreightDescription) {
    const { data, error } = await client.from('cash_transactions')
      .update({ kind: 'operating_expense', description: wendelFreightDescription })
      .eq('id', canonicalFreight.id)
      .select('*')
      .single();
    throwIfError(error);
    canonicalFreight = data as unknown as CashTransaction;
  }

  const duplicateFreightIds = freightCandidates
    .filter((transaction) => transaction.id !== canonicalFreight?.id)
    .map((transaction) => transaction.id);
  if (duplicateFreightIds.length > 0) {
    const { error } = await client.from('cash_transactions')
      .update({ status: 'reversed' })
      .in('id', duplicateFreightIds);
    throwIfError(error);
  }

  return {
    reversedContributions: contributionIdsToReverse.length,
    contributionCreated,
    freightCreated,
  };
}

export async function recordPayment(input: {
  installmentId: string;
  amount: number;
  method: string;
  paidAt: string;
  notes?: string;
}): Promise<string> {
  const { data, error } = await db().rpc('record_installment_payment', {
    p_installment_id: input.installmentId,
    p_amount: input.amount,
    p_method: input.method,
    p_paid_at: input.paidAt,
    p_notes: input.notes ?? null,
  });
  throwIfError(error);
  return String(data);
}

export async function recordClientPayment(input: {
  clientId: string;
  amount: number;
  method: string;
  paidAt: string;
  notes?: string;
}): Promise<string> {
  const { data, error } = await db().rpc('record_client_payment', {
    p_client_id: input.clientId,
    p_amount: input.amount,
    p_method: input.method,
    p_paid_at: input.paidAt,
    p_notes: input.notes ?? null,
  });
  throwIfError(error);
  return String(data);
}

export async function reversePayment(paymentId: string, reason: string): Promise<void> {
  const { error } = await db().rpc('reverse_payment', {
    p_payment_id: paymentId,
    p_reason: reason,
  });
  throwIfError(error);
}

export async function listMdmDevices(): Promise<MdmDevice[]> {
  const { data, error } = await db()
    .from('mdm_devices')
    .select('*,device:devices(id,model,serial_number,apple_business_registered,mdm_enrolled)')
    .order('created_at', { ascending: false });
  throwIfError(error);
  return (data ?? []) as unknown as MdmDevice[];
}

export async function listMdmCommands(): Promise<MdmCommand[]> {
  const { data, error } = await db().from('mdm_commands').select('*').order('requested_at', { ascending: false }).limit(50);
  throwIfError(error);
  return (data ?? []) as unknown as MdmCommand[];
}

export async function invokeMdmCommand(payload: Record<string, unknown>): Promise<void> {
  const { error } = await db().functions.invoke('mdm-command', { body: payload });
  throwIfError(error);
}

export async function runBilling(): Promise<{ simulated: number; message: string }> {
  const { data, error } = await db().functions.invoke('billing-run', { body: { mode: 'manual' } });
  throwIfError(error);
  return data as { simulated: number; message: string };
}

export async function listAuditLogs(): Promise<AuditLog[]> {
  const { data, error } = await db().from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100);
  throwIfError(error);
  return (data ?? []) as unknown as AuditLog[];
}
