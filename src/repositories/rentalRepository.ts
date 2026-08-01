import { supabase } from '../lib/supabase';
import type {
  AuditLog,
  CashTransaction,
  Client,
  ClientDocumentKind,
  Contract,
  Device,
  Installment,
  MdmCommand,
  MdmDevice,
  Payment,
} from '../types';
import type { ClientFormData, ContractFormData, DeviceFormData } from '../schemas/forms';

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
  accessories: Array.isArray(row.accessories) ? row.accessories : [],
});

const normalizeContract = (row: Contract): Contract => ({
  ...row,
  due_day: Number(row.due_day),
  term_months: Number(row.term_months),
  monthly_amount: toMoney(row.monthly_amount),
  deposit_amount: toMoney(row.deposit_amount),
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

export async function createClient(organizationId: string, values: ClientFormData): Promise<Client> {
  const riskScore = Number(values.internal_risk_score);
  const riskLabel = riskScore >= 800 ? 'baixo' : riskScore >= 600 ? 'moderado' : riskScore >= 400 ? 'atencao' : 'alto';
  const { data, error } = await db().from('rental_clients').insert({
    organization_id: organizationId,
    full_name: values.full_name,
    cpf: values.cpf.replace(/\D/g, ''),
    rg: values.rg || null,
    phone: values.phone,
    email: values.email || null,
    profession: values.profession || null,
    monthly_income: values.monthly_income,
    address_line: values.address_line || null,
    address_number: values.address_number || null,
    neighborhood: values.neighborhood || null,
    city: values.city || null,
    state: values.state?.toUpperCase() || null,
    postal_code: values.postal_code || null,
    internal_risk_score: riskScore,
    risk_label: riskLabel,
    notes: values.notes || null,
  }).select('*').single();
  throwIfError(error);
  const client = normalizeClient(data as unknown as Client);

  const { error: riskError } = await db().from('client_risk_assessments').insert({
    organization_id: organizationId,
    client_id: client.id,
    score: riskScore,
    classification: riskLabel,
    source: 'internal',
    notes: 'Classificacao interna da GR Solution; nao representa score de bureau.',
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
  market_value: values.market_value,
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

export async function listContracts(): Promise<Contract[]> {
  const { data, error } = await db()
    .from('contracts')
    .select('*,client:rental_clients(id,full_name,cpf),device:devices(id,model,serial_number,status)')
    .order('created_at', { ascending: false });
  throwIfError(error);
  return ((data ?? []) as unknown as Contract[]).map(normalizeContract);
}

export async function createContract(organizationId: string, values: ContractFormData): Promise<string> {
  const { data, error } = await db().rpc('create_contract_with_installments', {
    p_organization_id: organizationId,
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
  });
  throwIfError(error);
  return String(data);
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
  const { data, error } = await db().from('payments').select('*').order('paid_at', { ascending: false });
  throwIfError(error);
  return ((data ?? []) as unknown as Payment[]).map((row) => ({ ...row, amount: toMoney(row.amount) }));
}

export async function listCashTransactions(): Promise<CashTransaction[]> {
  const { data, error } = await db().from('cash_transactions').select('*').order('occurred_on', { ascending: false });
  throwIfError(error);
  return ((data ?? []) as unknown as CashTransaction[]).map((row) => ({ ...row, amount: toMoney(row.amount) }));
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

export async function listMdmDevices(): Promise<MdmDevice[]> {
  const { data, error } = await db()
    .from('mdm_devices')
    .select('*,device:devices(id,model,serial_number)')
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
