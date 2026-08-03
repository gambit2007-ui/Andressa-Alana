import { addMonths, differenceInCalendarDays, getDaysInMonth, parseISO } from 'date-fns';
import type { AppRole, ContractStatus, InstallmentStatus } from '../types';

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export type InstallmentDraft = {
  installmentNumber: number;
  dueDate: string;
  amount: number;
};

export function calculateContractPlan(input: {
  remainingInstallments: number;
  monthlyAmount: number;
  depositAmount: number;
}) {
  const remainingAmount = roundMoney(input.remainingInstallments * input.monthlyAmount);
  const upfrontInstallments = input.depositAmount > 0 ? 1 : 0;

  return {
    remainingInstallments: input.remainingInstallments,
    upfrontInstallments,
    totalInstallments: input.remainingInstallments + upfrontInstallments,
    remainingAmount,
    totalReceivable: roundMoney(input.depositAmount + remainingAmount),
  };
}

export function dueDateForMonth(startDate: string, monthOffset: number, dueDay: number): string {
  const start = parseISO(startDate);
  const targetMonth = addMonths(new Date(start.getFullYear(), start.getMonth(), 1), monthOffset);
  const safeDay = Math.min(Math.max(dueDay, 1), getDaysInMonth(targetMonth));
  const year = targetMonth.getFullYear();
  const month = String(targetMonth.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-${String(safeDay).padStart(2, '0')}`;
}

export function generateInstallmentSchedule(input: {
  startDate: string;
  dueDay: number;
  termMonths: number;
  monthlyAmount: number;
}): InstallmentDraft[] {
  return Array.from({ length: input.termMonths }, (_, index) => ({
    installmentNumber: index + 1,
    dueDate: dueDateForMonth(input.startDate, index + 1, input.dueDay),
    amount: roundMoney(input.monthlyAmount),
  }));
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
  heldDeposits: number[];
  expenses: number[];
}) {
  const receivedRevenue = roundMoney(input.confirmedPayments.reduce((sum, value) => sum + value, 0));
  const depositsHeld = roundMoney(input.heldDeposits.reduce((sum, value) => sum + value, 0));
  const expenses = roundMoney(input.expenses.reduce((sum, value) => sum + value, 0));
  return {
    receivedRevenue,
    depositsHeld,
    expenses,
    cashBalance: roundMoney(receivedRevenue + depositsHeld - expenses),
    operationalResult: roundMoney(receivedRevenue - expenses),
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
