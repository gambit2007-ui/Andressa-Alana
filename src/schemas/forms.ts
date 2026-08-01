import { z } from 'zod';

const requiredText = (label: string) => z.string().trim().min(1, `${label} e obrigatorio.`);
const money = z.number().min(0, 'Informe um valor valido.');

export const clientSchema = z.object({
  full_name: requiredText('Nome'),
  cpf: z.string().trim().min(11, 'CPF invalido.'),
  rg: z.string().trim().optional(),
  phone: z.string().trim().min(10, 'Telefone invalido.'),
  email: z.string().trim().email('Email invalido.').or(z.literal('')),
  profession: z.string().trim().optional(),
  monthly_income: money,
  address_line: z.string().trim().optional(),
  address_number: z.string().trim().optional(),
  neighborhood: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().max(2, 'Use a sigla do estado.').optional(),
  postal_code: z.string().trim().optional(),
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
  market_value: money,
});

export const contractSchema = z.object({
  client_id: requiredText('Cliente'),
  device_id: requiredText('Aparelho'),
  start_date: requiredText('Data inicial'),
  due_day: z.number().int().min(1).max(31),
  term_months: z.number().int().min(1).max(60),
  monthly_amount: z.number().positive('A mensalidade deve ser maior que zero.'),
  deposit_amount: money,
  late_fee_percent: z.number().min(0).max(100),
  daily_interest_percent: z.number().min(0).max(10),
  purchase_option: z.boolean(),
  purchase_option_amount: money,
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
export type CashTransactionFormData = z.infer<typeof cashTransactionSchema>;
