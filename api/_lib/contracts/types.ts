export type ContractParty = {
  name: string;
  taxId: string | null;
  rg?: string | null;
  birthDate?: string | null;
  phone: string | null;
  secondaryPhone?: string | null;
  email: string | null;
  address: string | null;
  workAddress?: string | null;
  reference?: string | null;
};

export type ContractDevice = {
  model: string;
  capacityGb: number;
  color: string;
  batteryHealth: number;
  imei1: string;
  imei2: string | null;
  serialNumber: string;
  condition: string;
  indemnityValue: number;
  notes: string | null;
  mdmStatus: string;
  accessories: string[];
};

export type ContractInstallment = {
  number: number;
  dueDate: string;
  amount: number;
  status: string;
  paidAmount: number;
  paidAt: string | null;
};

export type ContractFinancialSummary = {
  depositAmount: number;
  depositPaidAt?: string | null;
  depositPaymentMethod?: string | null;
  monthlyAmount: number;
  installmentCount: number;
  monthlyTotal: number;
  totalContract: number;
  amountReceived: number;
  remainingBalance: number;
  lateFeePercent: number;
  dailyInterestPercent: number;
  purchaseOption: boolean;
  purchaseOptionAmount: number | null;
};

export type DeliveryChecklist = Record<string, boolean | string>;

export type ContractPhoto = {
  caption: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type PaymentFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export type ContractPdfData = {
  contractId: string;
  contractNumber: string;
  issuedAt: string;
  startDate: string;
  endDate: string;
  firstInstallmentDate: string;
  paymentFrequency: PaymentFrequency;
  venue: string | null;
  lessor: ContractParty;
  lessee: ContractParty;
  device: ContractDevice;
  financial: ContractFinancialSummary;
  installments: ContractInstallment[];
  checklist: DeliveryChecklist;
  photos: ContractPhoto[];
};

export type ContractDocumentRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  document_type: 'rental_contract' | 'delivery_term';
  version: number;
  status: 'generating' | 'ready' | 'failed';
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
