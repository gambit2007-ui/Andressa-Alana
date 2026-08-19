import { addDays, addMonths, differenceInCalendarDays, format, getDaysInMonth, parseISO } from 'date-fns';
import type { AppRole, ContractStatus, InstallmentStatus, PaymentFrequency } from '../types';
import { calculateContractPlan, roundMoney } from './contractPlan';

export { calculateContractPlan } from './contractPlan';

export type InstallmentDraft = {
  installmentNumber: number;
  dueDate: string;
  amount: number;
};

export const paymentFrequencyLabel: Record<PaymentFrequency, string> = {
  daily: 'Diário',
  weekly: 'Semanal',
  biweekly: 'Quinzenal',
  monthly: 'Mensal',
};

export const paymentAmountLabel: Record<PaymentFrequency, string> = {
  daily: 'Valor da diária',
  weekly: 'Valor semanal',
  biweekly: 'Valor quinzenal',
  monthly: 'Valor mensal',
};

export function dueDateForMonth(startDate: string, monthOffset: number, dueDay: number): string {
  const start = parseISO(startDate);
  const targetMonth = addMonths(new Date(start.getFullYear(), start.getMonth(), 1), monthOffset);
  const safeDay = Math.min(Math.max(dueDay, 1), getDaysInMonth(targetMonth));
  const year = targetMonth.getFullYear();
  const month = String(targetMonth.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-${String(safeDay).padStart(2, '0')}`;
}

export function generateInstallmentSchedule(input: {
  startDate?: string;
  firstInstallmentDate?: string;
  paymentFrequency?: PaymentFrequency;
  dueDay: number;
  termMonths: number;
  monthlyAmount: number;
}): InstallmentDraft[] {
  const firstDueDate = input.firstInstallmentDate
    ?? dueDateForMonth(input.startDate ?? new Date().toISOString().slice(0, 10), 1, input.dueDay);
  const frequency = input.paymentFrequency ?? 'monthly';

  const dueDateForInstallment = (index: number): string => {
    if (index === 0) return firstDueDate;
    if (frequency === 'daily') return format(addDays(parseISO(firstDueDate), index), 'yyyy-MM-dd');
    if (frequency === 'weekly') return format(addDays(parseISO(firstDueDate), index * 7), 'yyyy-MM-dd');
    if (frequency === 'biweekly') return format(addDays(parseISO(firstDueDate), index * 14), 'yyyy-MM-dd');
    return dueDateForMonth(firstDueDate, index, input.dueDay);
  };

  return Array.from({ length: input.termMonths }, (_, index) => ({
    installmentNumber: index + 1,
    dueDate: dueDateForInstallment(index),
    amount: roundMoney(input.monthlyAmount),
  }));
}

export function monthlyEquivalentRevenue(amount: number, frequency: PaymentFrequency): number {
  const multiplier: Record<PaymentFrequency, number> = {
    daily: 365 / 12,
    weekly: 52 / 12,
    biweekly: 26 / 12,
    monthly: 1,
  };
  return roundMoney(amount * multiplier[frequency]);
}

export function calculateCharges(input: {
  originalAmount: number;
  paidAmount: number;
  discountAmount?: number;
  dueDate: string;
  asOfDate: string;
  lateFeePercent: number;
  dailyInterestPercent: number;
}) {
  const principal = Math.max(0, input.originalAmount - (input.discountAmount ?? 0) - input.paidAmount);
  const daysOverdue = Math.max(0, differenceInCalendarDays(parseISO(input.asOfDate), parseISO(input.dueDate)));
  const lateFee = daysOverdue > 0 ? roundMoney(principal * (input.lateFeePercent / 100)) : 0;
  const interest = daysOverdue > 0
    ? roundMoney(principal * (input.dailyInterestPercent / 100) * daysOverdue)
    : 0;

  return {
    daysOverdue,
    lateFee,
    interest,
    outstanding: roundMoney(principal + lateFee + interest),
  };
}

export function applyPayment(input: {
  totalDue: number;
  alreadyPaid: number;
  paymentAmount: number;
}): { paidAmount: number; outstanding: number; status: InstallmentStatus } {
  const paidAmount = roundMoney(input.alreadyPaid + input.paymentAmount);
  const outstanding = roundMoney(Math.max(0, input.totalDue - paidAmount));
  const status: InstallmentStatus = outstanding === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'pending';
  return { paidAmount, outstanding, status };
}

export function calculateProfitability(input: {
  rentalRevenue: number;
  saleRevenue: number;
  purchaseCost: number;
  maintenanceCost: number;
  mdmCost: number;
  insuranceCost: number;
  fees: number;
  taxes: number;
  otherExpenses: number;
  averageMonthlyNet?: number;
}) {
  const revenue = input.rentalRevenue + input.saleRevenue;
  const expenses = input.purchaseCost
    + input.maintenanceCost
    + input.mdmCost
    + input.insuranceCost
    + input.fees
    + input.taxes
    + input.otherExpenses;
  const netProfit = roundMoney(revenue - expenses);
  const roi = input.purchaseCost > 0 ? roundMoney((netProfit / input.purchaseCost) * 100) : 0;
  const paybackMonths = (input.averageMonthlyNet ?? 0) > 0
    ? roundMoney(input.purchaseCost / (input.averageMonthlyNet ?? 1))
    : null;

  return { revenue: roundMoney(revenue), expenses: roundMoney(expenses), netProfit, roi, paybackMonths };
}

export function calculateCashSummary(input: {
  confirmedPayments: number[];
  purchaseEntries: number[];
  expenses: number[];
}) {
  const receivedRevenue = roundMoney(input.confirmedPayments.reduce((sum, value) => sum + value, 0));
  const purchaseEntryRevenue = roundMoney(input.purchaseEntries.reduce((sum, value) => sum + value, 0));
  const expenses = roundMoney(input.expenses.reduce((sum, value) => sum + value, 0));
  return {
    receivedRevenue,
    purchaseEntryRevenue,
    expenses,
    cashBalance: roundMoney(receivedRevenue + purchaseEntryRevenue - expenses),
    operationalResult: roundMoney(receivedRevenue + purchaseEntryRevenue - expenses),
  };
}

const contractTransitions: Record<ContractStatus, ContractStatus[]> = {
  draft: ['active', 'cancelled'],
  active: ['overdue', 'completed', 'cancelled', 'renegotiated'],
  overdue: ['active', 'completed', 'cancelled', 'renegotiated'],
  completed: [],
  cancelled: [],
  renegotiated: ['active', 'completed'],
};

export const canTransitionContract = (from: ContractStatus, to: ContractStatus): boolean =>
  contractTransitions[from].includes(to);

const destructiveMdmCommands = new Set(['erase', 'clear_activation_lock', 'remove_management']);

export function canExecuteMdmCommand(input: {
  role: AppRole;
  command: string;
  typedSerial: string;
  deviceSerial: string;
  reason: string;
  recentlyReauthenticated: boolean;
}): boolean {
  const destructive = destructiveMdmCommands.has(input.command);
  if (!destructive) return ['admin', 'manager'].includes(input.role);
  return input.role === 'admin'
    && input.recentlyReauthenticated
    && input.typedSerial.trim().toUpperCase() === input.deviceSerial.trim().toUpperCase()
    && input.reason.trim().length >= 10;
}
