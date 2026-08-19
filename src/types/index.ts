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
  birth_date?: string | null;
  phone: string;
  secondary_phone?: string | null;
  email: string | null;
  profession: string | null;
  monthly_income: number;
  address_line: string | null;
  address_number: string | null;
  address_complement?: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  work_address?: string | null;
  reference_name?: string | null;
  reference_phone?: string | null;
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
  indemnity_value?: number | null;
  notes?: string | null;
  status: DeviceStatus;
  apple_business_registered: boolean;
  mdm_enrolled: boolean;
  created_at: string;
};

export type DevicePhoto = {
  id: string;
  organization_id: string;
  device_id: string;
  bucket_id: 'device-photos';
  storage_path: string;
  caption: string | null;
  created_at: string;
  signed_url?: string | null;
};

export type DeviceSale = {
  id: string;
  organization_id: string;
  device_id: string;
  contract_id: string | null;
  client_id: string | null;
  buyer_name: string;
  sale_amount: number;
  sold_at: string;
  payment_method: PaymentMethod;
  paid_in_full: boolean;
  apple_release_confirmed: boolean;
  notes: string | null;
  created_at: string;
  client?: Pick<Client, 'id' | 'full_name' | 'cpf'>;
  device?: Pick<Device, 'id' | 'model' | 'serial_number' | 'status' | 'purchase_amount' | 'mdm_enrolled'>;
};

export type ContractStatus =
  | 'draft'
  | 'active'
  | 'overdue'
  | 'completed'
  | 'cancelled'
  | 'renegotiated';

export type PaymentFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export type Contract = {
  id: string;
  organization_id: string;
  client_id: string;
  device_id: string;
  contract_number: string;
  start_date: string;
  end_date: string;
  first_installment_date?: string | null;
  payment_frequency: PaymentFrequency;
  due_day: number;
  term_months: number;
  monthly_amount: number;
  deposit_amount: number;
  deposit_as_first_installment: boolean;
  deposit_paid_at?: string | null;
  deposit_payment_method?: PaymentMethod | null;
  indemnity_value?: number | null;
  late_fee_percent: number;
  daily_interest_percent: number;
  purchase_option: boolean;
  purchase_option_amount: number | null;
  status: ContractStatus;
  created_at: string;
  client?: Pick<Client, 'id' | 'full_name' | 'cpf'>;
  device?: Pick<Device, 'id' | 'model' | 'serial_number' | 'status'>;
};

export type PaymentMethod = 'pix' | 'card' | 'transfer' | 'cash' | 'other';

export type ContractDocumentType = 'rental_contract' | 'delivery_term';
export type ContractDocumentStatus = 'generating' | 'ready' | 'failed';

export type ContractDocument = {
  id: string;
  organization_id: string;
  contract_id: string;
  document_type: ContractDocumentType;
  version: number;
  status: ContractDocumentStatus;
  bucket_id: 'contracts';
  storage_path: string;
  file_name: string;
  generated_at: string | null;
  generated_by: string | null;
  generation_reason: string | null;
  metadata: Record<string, unknown>;
  is_current: boolean;
  created_at: string;
};

export type OrganizationContractSettings = {
  organization_id: string;
  legal_name: string;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_storage_path: string | null;
  city: string | null;
  default_venue: string | null;
};

export const deliveryChecklistKeys = [
  'screen', 'face_id', 'cameras', 'microphones', 'speakers', 'buttons',
  'connectors', 'housing', 'battery', 'wifi', 'bluetooth', 'mobile_data',
  'cable', 'charger', 'box', 'case', 'screen_protector',
] as const;

export type DeliveryChecklistKey = (typeof deliveryChecklistKeys)[number];
export type DeliveryChecklist = Record<DeliveryChecklistKey, boolean> & { notes: string };

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
  device_sale_id?: string | null;
  kind: string;
  direction: 'in' | 'out';
  amount: number;
  occurred_on: string;
  description: string;
  status: 'confirmed' | 'reversed';
};

export type FinancialMonthClosing = {
  id: string;
  organization_id: string;
  month: string;
  status: 'closed' | 'reopened';
  snapshot: Record<string, unknown>;
  closed_at: string;
  closed_by: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  created_at: string;
  updated_at: string;
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
