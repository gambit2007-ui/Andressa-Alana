import { z } from 'zod';

const requiredText = (label: string) => z.string().trim().min(1, `${label} e obrigatorio.`);
const money = z.number().min(0, 'Informe um valor valido.');

const isValidCpf = (value: string): boolean => {
  const cpf = value.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length: number) => {
    const sum = cpf.slice(0, length).split('').reduce((total, number, index) => (
      total + Number(number) * (length + 1 - index)
    ), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
};

export const deliveryChecklistSchema = z.object({
  screen: z.boolean(), face_id: z.boolean(), cameras: z.boolean(), microphones: z.boolean(),
  speakers: z.boolean(), buttons: z.boolean(), connectors: z.boolean(), housing: z.boolean(),
  battery: z.boolean(), wifi: z.boolean(), bluetooth: z.boolean(), mobile_data: z.boolean(),
  cable: z.boolean(), charger: z.boolean(), box: z.boolean(), case: z.boolean(),
  screen_protector: z.boolean(), notes: z.string().trim(),
});

export const clientSchema = z.object({
  full_name: requiredText('Nome'),
  cpf: z.string().trim().refine(isValidCpf, 'CPF invalido.'),
  rg: z.string().trim().optional(),
  birth_date: z.string().optional(),
  phone: z.string().trim().min(10, 'Telefone invalido.'),
  secondary_phone: z.string().trim().optional(),
  email: z.string().trim().email('Email invalido.').or(z.literal('')),
  profession: z.string().trim().optional(),
  monthly_income: money,
  address_line: z.string().trim().optional(),
  address_number: z.string().trim().optional(),
  address_complement: z.string().trim().optional(),
  neighborhood: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().max(2, 'Use a sigla do estado.').optional(),
  postal_code: z.string().trim().optional(),
  work_address: z.string().trim().optional(),
  reference_name: z.string().trim().optional(),
  reference_phone: z.string().trim().optional(),
  internal_risk_score: z.number().int().min(0).max(1000),
  notes: z.string().trim().optional(),
});

export const deviceSchema = z.object({
  model: requiredText('Modelo'),
  color: requiredText('Cor'),
  capacity_gb: z.number().int().positive(),
  imei_1: z.string().regex(/^\d{15}$/, 'IMEI 1 deve conter 15 digitos.'),
  imei_2: z.string().refine((value) => value === '' || /^\d{15}$/.test(value), 'IMEI 2 invalido.'),
  serial_number: requiredText('Numero de serie'),
  battery_health: z.number().int().min(0).max(100),
  purchase_date: requiredText('Data de compra'),
  purchase_amount: money,
  supplier: z.string().trim().optional(),
  invoice_number: z.string().trim().optional(),
  warranty_until: z.string().optional(),
  condition: requiredText('Condicao'),
  accessories: z.string().trim(),
  market_value: money,
  indemnity_value: z.number().positive('O valor de indenizacao deve ser maior que zero.'),
  notes: z.string().trim().optional(),
  mdm_enrolled: z.boolean(),
});

export const contractSchema = z.object({
  client_id: requiredText('Cliente'),
  device_id: requiredText('Aparelho'),
  start_date: requiredText('Data inicial'),
  first_installment_date: requiredText('Data da primeira mensalidade'),
  due_day: z.number().int().min(1).max(31),
  term_months: z.number().int().min(1).max(60),
  monthly_amount: z.number().positive('A mensalidade deve ser maior que zero.'),
  deposit_amount: money,
  deposit_paid_at: z.string(),
  deposit_payment_method: z.enum(['', 'pix', 'card', 'transfer', 'cash', 'other']),
  indemnity_value: z.number().positive('O valor de indenizacao deve ser maior que zero.'),
  late_fee_percent: z.number().min(0).max(100),
  daily_interest_percent: z.number().min(0).max(10),
  purchase_option: z.boolean(),
  purchase_option_amount: money,
  delivery_checklist: deliveryChecklistSchema,
}).superRefine((values, context) => {
  if (values.first_installment_date < values.start_date) {
    context.addIssue({ code: 'custom', path: ['first_installment_date'], message: 'A primeira mensalidade nao pode vencer antes do inicio.' });
  }
  if (values.deposit_amount > 0 && !values.deposit_paid_at) {
    context.addIssue({ code: 'custom', path: ['deposit_paid_at'], message: 'Informe quando a caucao foi paga.' });
  }
  if (values.deposit_amount > 0 && !values.deposit_payment_method) {
    context.addIssue({ code: 'custom', path: ['deposit_payment_method'], message: 'Informe a forma de pagamento da caucao.' });
  }
  if (values.purchase_option && values.purchase_option_amount <= 0) {
    context.addIssue({ code: 'custom', path: ['purchase_option_amount'], message: 'Informe o valor da opcao de compra.' });
  }
});

export const organizationContractSettingsSchema = z.object({
  legal_name: requiredText('Nome ou razao social'),
  tax_id: z.string().trim().optional(),
  address: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email('Email invalido.').or(z.literal('')),
  city: z.string().trim().optional(),
  default_venue: z.string().trim().optional(),
});

export const cashTransactionSchema = z.object({
  direction: z.enum(['in', 'out']),
  kind: requiredText('Categoria'),
  amount: z.number().positive('O valor deve ser maior que zero.'),
  occurred_on: requiredText('Data'),
  description: requiredText('Descricao'),
});

export type ClientFormData = z.infer<typeof clientSchema>;
export type DeviceFormData = z.infer<typeof deviceSchema>;
export type ContractFormData = z.infer<typeof contractSchema>;
export type OrganizationContractSettingsFormData = z.infer<typeof organizationContractSettingsSchema>;
export type CashTransactionFormData = z.infer<typeof cashTransactionSchema>;
