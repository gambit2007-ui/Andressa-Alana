export type AppRole = 'admin' | 'manager' | 'finance' | 'operator' | 'viewer';

export type Organization = {
  id: string;
  name: string;
  slug: string;
};

export type Profile = {
  id: string;
  organization_id: string;
  full_name: string;
  role: AppRole;
  active: boolean;
  organization?: Organization;
};

export type Client = {
  id: string;
  organization_id: string;
  full_name: string;
  cpf: string;
  rg: string | null;
  phone: string;
  email: string | null;
  profession: string | null;
  monthly_income: number;
  address_line: string | null;
  address_number: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  internal_risk_score: number;
  risk_label: string;
  notes: string | null;
  created_at: string;
};

export type ClientDocumentKind = 'selfie' | 'identity' | 'income' | 'residence';

export type ClientDocument = {
  id: string;
  client_id: string;
  kind: ClientDocumentKind;
  storage_path: string;
  file_name: string;
  created_at: string;
};

export type DeviceStatus = 'available' | 'rented' | 'maintenance' | 'sold' | 'retired';

export type Device = {
  id: string;
  organization_id: string;
  model: string;
  color: string;
  capacity_gb: number;
  imei_1: string;
  imei_2: string | null;
  serial_number: string;
  battery_health: number;
  purchase_date: string;
  purchase_amount: number;
  supplier: string | null;
  invoice_number: string | null;
  warranty_until: string | null;
  condition: string;
  accessories: string[];
  market_value: number;
  status: DeviceStatus;
  apple_business_registered: boolean;
  mdm_enrolled: boolean;
  created_at: string;
};

export type ContractStatus =
  | 'draft'
  | 'active'
  | 'overdue'
  | 'completed'
  | 'cancelled'
  | 'renegotiated';

export type Contract = {
  id: string;
  organization_id: string;
  client_id: string;
  device_id: string;
  contract_number: string;
  start_date: string;
  end_date: string;
  due_day: number;
  term_months: number;
  monthly_amount: number;
  deposit_amount: number;
  deposit_as_first_installment: boolean;
  late_fee_percent: number;
  daily_interest_percent: number;
  purchase_option: boolean;
  purchase_option_amount: number | null;
  status: ContractStatus;
  created_at: string;
  client?: Pick<Client, 'id' | 'full_name' | 'cpf'>;
  device?: Pick<Device, 'id' | 'model' | 'serial_number' | 'status'>;
};

export type InstallmentStatus =
  | 'pending'
  | 'partial'
  | 'overdue'
  | 'paid'
  | 'cancelled'
  | 'renegotiated';

export type Installment = {
  id: string;
  organization_id: string;
  contract_id: string;
  installment_number: number;
  due_date: string;
  original_amount: number;
  discount_amount: number;
  late_fee_amount: number;
  interest_amount: number;
  paid_amount: number;
  status: InstallmentStatus;
  created_at: string;
  contract?: Contract;
};

export type Payment = {
  id: string;
  organization_id: string;
  installment_id: string;
  amount: number;
  method: string;
  paid_at: string;
  status: 'confirmed' | 'reversed';
  external_reference: string | null;
  notes: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  installment?: Installment;
};

export type CashTransaction = {
  id: string;
  organization_id: string;
  device_id: string | null;
  contract_id: string | null;
  kind: string;
  direction: 'in' | 'out';
  amount: number;
  occurred_on: string;
  description: string;
  status: 'confirmed' | 'reversed';
};

export type MdmDevice = {
  id: string;
  organization_id: string;
  device_id: string;
  provider: 'mock' | 'mosyle';
  provider_device_id: string | null;
  status: string;
  supervised: boolean;
  activation_lock_managed: boolean;
  last_sync_at: string | null;
  device?: Pick<Device, 'id' | 'model' | 'serial_number' | 'apple_business_registered' | 'mdm_enrolled'>;
};

export type MdmCommandStatus =
  | 'requested'
  | 'awaiting_approval'
  | 'sent'
  | 'acknowledged'
  | 'executed'
  | 'failed';

export type MdmCommand = {
  id: string;
  organization_id: string;
  mdm_device_id: string;
  command: string;
  status: MdmCommandStatus;
  reason: string;
  is_destructive: boolean;
  requested_at: string;
};

export type AuditLog = {
  id: string;
  organization_id: string;
  actor_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
};

export type MonthlyMetrics = {
  expectedRevenue: number;
  receivedRevenue: number;
  openAmount: number;
  overdueAmount: number;
  expenses: number;
  investedCapital: number;
  fleetMarketValue: number;
  occupancyRate: number;
  mrr: number;
};
