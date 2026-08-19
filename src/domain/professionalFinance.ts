import type {
  CashTransaction,
  Device,
  DeviceSale,
  FinancialMonthClosing,
  Installment,
} from '../types';
import { buildMonthlyCashClosings } from './monthlyClosing';

export type ProfessionalMonthMetrics = {
  month: string;
  openingBalance: number;
  closingBalance: number;
  cashEntries: number;
  cashOutflows: number;
  netCashFlow: number;
  rentalIncome: number;
  depositIncome: number;
  depositRefunds: number;
  salesIncome: number;
  otherIncome: number;
  operationalRevenue: number;
  salesCost: number;
  salesMargin: number;
  operatingExpenses: number;
  operationalResult: number;
  inventoryPurchases: number;
  capitalAdded: number;
  reversals: number;
  ownerWithdrawals: number;
  forecastReceivables: number;
  overdueReceivables: number;
  closingStatus: 'open' | 'closed' | 'reopened';
  closingId: string | null;
  closedAt: string | null;
};

export type ProfessionalFinanceSummary = {
  selectedYear: number;
  currentCash: number;
  annualRevenue: number;
  annualOperatingResult: number;
  accountsReceivable: number;
  overdueReceivables: number;
  capitalInRentedFleet: number;
  activeFleetMarketValue: number;
  annualInventoryPurchases: number;
  annualSalesRevenue: number;
  annualSalesMargin: number;
  annualPurchaseEntries: number;
  annualPurchaseEntryReversals: number;
  annualOperatingExpenses: number;
  annualContributions: number;
  annualWithdrawals: number;
  averageMonthlyOperatingResult: number;
  recordMonth: string | null;
  recordOperatingResult: number;
  annualRoi: number;
  months: ProfessionalMonthMetrics[];
};

type BuildProfessionalFinanceInput = {
  transactions: CashTransaction[];
  devices: Device[];
  installments: Installment[];
  sales: DeviceSale[];
  closings?: FinancialMonthClosing[];
  selectedYear: number;
  referenceDate?: string;
};

const openStatuses = new Set(['pending', 'partial', 'overdue']);
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const monthKey = (value: string) => value.slice(0, 7);
const installmentTotal = (installment: Installment) => installment.original_amount
  + installment.late_fee_amount
  + installment.interest_amount
  - installment.discount_amount;
const installmentBalance = (installment: Installment) => openStatuses.has(installment.status)
  ? Math.max(0, installmentTotal(installment) - installment.paid_amount)
  : 0;

const numericSnapshotFields: Array<keyof ProfessionalMonthMetrics> = [
  'openingBalance',
  'closingBalance',
  'cashEntries',
  'cashOutflows',
  'netCashFlow',
  'rentalIncome',
  'depositIncome',
  'depositRefunds',
  'salesIncome',
  'otherIncome',
  'salesCost',
  'salesMargin',
  'operatingExpenses',
  'inventoryPurchases',
  'capitalAdded',
  'reversals',
  'ownerWithdrawals',
  'forecastReceivables',
  'overdueReceivables',
];

const applyClosingSnapshot = (
  live: ProfessionalMonthMetrics,
  closing: FinancialMonthClosing | undefined,
): ProfessionalMonthMetrics => {
  if (!closing) return live;
  if (closing.status !== 'closed') {
    return { ...live, closingStatus: 'reopened', closingId: closing.id, closedAt: closing.closed_at };
  }

  const snapshot = closing.snapshot ?? {};
  const result = { ...live, closingStatus: 'closed' as const, closingId: closing.id, closedAt: closing.closed_at };
  numericSnapshotFields.forEach((field) => {
    const value = Number(snapshot[field]);
    if (Number.isFinite(value)) (result[field] as number) = value;
  });
  return result;
};

export function serializeMonthSnapshot(month: ProfessionalMonthMetrics): Record<string, unknown> {
  return { ...month, closingStatus: 'closed', closingId: null, closedAt: null };
}

export function buildProfessionalFinance({
  transactions,
  devices,
  installments,
  sales,
  closings = [],
  selectedYear,
  referenceDate = new Date().toISOString().slice(0, 10),
}: BuildProfessionalFinanceInput): ProfessionalFinanceSummary {
  const referenceMonth = monthKey(referenceDate);
  const currentClosings = buildMonthlyCashClosings(transactions, devices, referenceMonth);
  const currentCash = currentClosings.find((closing) => closing.month === referenceMonth)?.closingBalance ?? 0;
  const yearClosings = buildMonthlyCashClosings(transactions, devices, `${selectedYear}-12`);
  const closingByMonth = new Map(closings.map((closing) => [monthKey(closing.month), closing]));
  const salesByMonth = new Map<string, DeviceSale[]>();
  sales.forEach((sale) => {
    const month = monthKey(sale.sold_at);
    salesByMonth.set(month, [...(salesByMonth.get(month) ?? []), sale]);
  });

  const months = Array.from({ length: 12 }, (_, index) => {
    const month = `${selectedYear}-${String(index + 1).padStart(2, '0')}`;
    const cash = yearClosings.find((closing) => closing.month === month);
    const monthInstallments = installments.filter((installment) => monthKey(installment.due_date) === month);
    const monthSales = salesByMonth.get(month) ?? [];
    const salesCost = monthSales.reduce((sum, sale) => sum + (sale.device?.purchase_amount ?? 0), 0);
    const salesIncome = cash?.salesIncome ?? monthSales.reduce((sum, sale) => sum + sale.sale_amount, 0);
    const salesMargin = salesIncome - salesCost;
    const rentalIncome = cash?.rentalIncome ?? 0;
    const depositIncome = cash?.depositIncome ?? 0;
    const otherIncome = cash?.otherIncome ?? 0;
    const depositRefunds = cash?.depositRefunds ?? 0;
    const operationalRevenue = rentalIncome + depositIncome + salesIncome + otherIncome;
    const operatingExpenses = cash?.extraExpenses ?? 0;
    const reversals = cash?.reversals ?? 0;
    const operationalResult = rentalIncome + depositIncome + salesMargin + otherIncome
      - operatingExpenses - depositRefunds - reversals;
    const live: ProfessionalMonthMetrics = {
      month,
      openingBalance: cash?.openingBalance ?? 0,
      closingBalance: cash?.closingBalance ?? 0,
      cashEntries: cash?.totalEntries ?? 0,
      cashOutflows: cash?.totalOutflows ?? 0,
      netCashFlow: cash?.netMovement ?? 0,
      rentalIncome,
      depositIncome,
      depositRefunds,
      salesIncome,
      otherIncome,
      operationalRevenue: roundMoney(operationalRevenue),
      salesCost: roundMoney(salesCost),
      salesMargin: roundMoney(salesMargin),
      operatingExpenses,
      operationalResult: roundMoney(operationalResult),
      inventoryPurchases: cash?.inventoryPurchases ?? 0,
      capitalAdded: cash?.capitalAdded ?? 0,
      reversals,
      ownerWithdrawals: cash?.ownerWithdrawals ?? 0,
      forecastReceivables: roundMoney(monthInstallments.reduce((sum, installment) => sum + installmentBalance(installment), 0)),
      overdueReceivables: roundMoney(monthInstallments
        .filter((installment) => installment.status === 'overdue')
        .reduce((sum, installment) => sum + installmentBalance(installment), 0)),
      closingStatus: 'open',
      closingId: null,
      closedAt: null,
    };
    return applyClosingSnapshot(live, closingByMonth.get(month));
  });

  const openInstallments = installments.filter((installment) => installmentBalance(installment) > 0);
  const accountsReceivable = openInstallments.reduce((sum, installment) => sum + installmentBalance(installment), 0);
  const overdueReceivables = openInstallments
    .filter((installment) => installment.status === 'overdue')
    .reduce((sum, installment) => sum + installmentBalance(installment), 0);
  const annualRevenue = months.reduce((sum, month) => sum + month.operationalRevenue, 0);
  const annualOperatingResult = months.reduce((sum, month) => sum + month.operationalResult, 0);
  const activeAssets = devices.filter((device) => !['sold', 'retired'].includes(device.status));
  const capitalInRentedFleet = devices
    .filter((device) => device.status === 'rented')
    .reduce((sum, device) => sum + device.purchase_amount, 0);
  const activeMonths = months.filter((month) => (
    month.operationalRevenue !== 0 || month.operatingExpenses !== 0 || month.reversals !== 0
  ));
  const record = activeMonths.reduce<ProfessionalMonthMetrics | null>((best, month) => (
    !best || month.operationalResult > best.operationalResult ? month : best
  ), null);

  return {
    selectedYear,
    currentCash: roundMoney(currentCash),
    annualRevenue: roundMoney(annualRevenue),
    annualOperatingResult: roundMoney(annualOperatingResult),
    accountsReceivable: roundMoney(accountsReceivable),
    overdueReceivables: roundMoney(overdueReceivables),
    capitalInRentedFleet: roundMoney(capitalInRentedFleet),
    activeFleetMarketValue: roundMoney(activeAssets.reduce((sum, device) => sum + device.market_value, 0)),
    annualInventoryPurchases: roundMoney(months.reduce((sum, month) => sum + month.inventoryPurchases, 0)),
    annualSalesRevenue: roundMoney(months.reduce((sum, month) => sum + month.salesIncome, 0)),
    annualSalesMargin: roundMoney(months.reduce((sum, month) => sum + month.salesMargin, 0)),
    annualPurchaseEntries: roundMoney(months.reduce((sum, month) => sum + month.depositIncome, 0)),
    annualPurchaseEntryReversals: roundMoney(months.reduce((sum, month) => sum + month.depositRefunds, 0)),
    annualOperatingExpenses: roundMoney(months.reduce((sum, month) => sum + month.operatingExpenses, 0)),
    annualContributions: roundMoney(months.reduce((sum, month) => sum + month.capitalAdded, 0)),
    annualWithdrawals: roundMoney(months.reduce((sum, month) => sum + month.ownerWithdrawals, 0)),
    averageMonthlyOperatingResult: roundMoney(activeMonths.length ? annualOperatingResult / activeMonths.length : 0),
    recordMonth: record?.month ?? null,
    recordOperatingResult: roundMoney(record?.operationalResult ?? 0),
    annualRoi: capitalInRentedFleet > 0 ? roundMoney((annualOperatingResult / capitalInRentedFleet) * 100) : 0,
    months,
  };
}

export function availableFinanceYears(
  transactions: CashTransaction[],
  devices: Device[],
  referenceYear: number,
): number[] {
  return Array.from(new Set([
    referenceYear,
    ...transactions.map((transaction) => Number(transaction.occurred_on.slice(0, 4))),
    ...devices.map((device) => Number(device.purchase_date.slice(0, 4))),
  ].filter(Number.isFinite))).sort((left, right) => right - left);
}
