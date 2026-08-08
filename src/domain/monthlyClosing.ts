import { addMonths, format, parseISO } from 'date-fns';
import type { CashTransaction, Device } from '../types';

type ClosingTransaction = Pick<CashTransaction, 'amount' | 'direction' | 'kind' | 'occurred_on' | 'status'>
  & Partial<Pick<CashTransaction, 'description'>>;
type ClosingDevice = Pick<Device, 'purchase_amount' | 'purchase_date'>;

export type MonthlyCashClosing = {
  month: string;
  openingBalance: number;
  rentalIncome: number;
  salesIncome: number;
  depositIncome: number;
  capitalAdded: number;
  otherIncome: number;
  totalEntries: number;
  recordedPurchaseOutflows: number;
  purchaseOutflows: number;
  extraExpenses: number;
  reversals: number;
  ownerWithdrawals: number;
  totalOutflows: number;
  inventoryPurchases: number;
  netMovement: number;
  closingBalance: number;
};

const purchaseKinds = new Set(['asset_purchase', 'device_purchase', 'supplier']);

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const monthKey = (value: string) => value.slice(0, 7);

const isLegacyDeposit = (transaction: ClosingTransaction) => transaction.kind === 'rental_payment'
  && (transaction.description ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .includes('caucao');

const monthRange = (start: string, end: string): string[] => {
  const result: string[] = [];
  let current = parseISO(`${start}-01`);
  const endDate = parseISO(`${end}-01`);
  while (current <= endDate) {
    result.push(format(current, 'yyyy-MM'));
    current = addMonths(current, 1);
  }
  return result;
};

export function buildMonthlyCashClosings(
  transactions: ClosingTransaction[],
  devices: ClosingDevice[],
  currentMonth = format(new Date(), 'yyyy-MM'),
): MonthlyCashClosing[] {
  const confirmed = transactions.filter((transaction) => transaction.status === 'confirmed');
  const representedMonths = [
    currentMonth,
    ...confirmed.map((transaction) => monthKey(transaction.occurred_on)),
    ...devices.map((device) => monthKey(device.purchase_date)),
  ].filter((month) => /^\d{4}-\d{2}$/.test(month));
  const startMonth = representedMonths.sort()[0] ?? currentMonth;
  const endMonth = representedMonths.reduce((latest, month) => month > latest ? month : latest, currentMonth);
  let runningBalance = 0;

  return monthRange(startMonth, endMonth).map((month) => {
    const monthTransactions = confirmed.filter((transaction) => monthKey(transaction.occurred_on) === month);
    const entries = monthTransactions.filter((transaction) => transaction.direction === 'in');
    const outflows = monthTransactions.filter((transaction) => transaction.direction === 'out');
    const sumEntries = (kind: string) => entries
      .filter((transaction) => transaction.kind === kind)
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const rentalIncome = entries
      .filter((transaction) => transaction.kind === 'rental_payment' && !isLegacyDeposit(transaction))
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const salesIncome = sumEntries('device_sale');
    const depositIncome = entries
      .filter((transaction) => transaction.kind === 'deposit_received' || isLegacyDeposit(transaction))
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const capitalAdded = sumEntries('capital_contribution');
    const otherIncome = entries
      .filter((transaction) => !['rental_payment', 'device_sale', 'deposit_received', 'capital_contribution'].includes(transaction.kind))
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    // The cash total must include every confirmed inflow, regardless of how it is categorized.
    const totalEntries = entries.reduce((sum, transaction) => sum + transaction.amount, 0);
    const recordedPurchaseOutflows = outflows
      .filter((transaction) => purchaseKinds.has(transaction.kind))
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const reversals = outflows
      .filter((transaction) => transaction.kind === 'payment_reversal')
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const ownerWithdrawals = outflows
      .filter((transaction) => transaction.kind === 'withdrawal')
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const extraExpenses = outflows
      .filter((transaction) => !purchaseKinds.has(transaction.kind)
        && transaction.kind !== 'payment_reversal'
        && transaction.kind !== 'withdrawal')
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const inventoryPurchases = devices
      .filter((device) => monthKey(device.purchase_date) === month)
      .reduce((sum, device) => sum + device.purchase_amount, 0);
    // Device records and manual purchase entries are separate stock acquisitions.
    const purchaseOutflows = inventoryPurchases + recordedPurchaseOutflows;
    const totalOutflows = purchaseOutflows + extraExpenses + reversals + ownerWithdrawals;
    const openingBalance = runningBalance;
    const netMovement = totalEntries - totalOutflows;
    runningBalance = roundMoney(openingBalance + netMovement);

    return {
      month,
      openingBalance: roundMoney(openingBalance),
      rentalIncome: roundMoney(rentalIncome),
      salesIncome: roundMoney(salesIncome),
      depositIncome: roundMoney(depositIncome),
      capitalAdded: roundMoney(capitalAdded),
      otherIncome: roundMoney(otherIncome),
      totalEntries: roundMoney(totalEntries),
      recordedPurchaseOutflows: roundMoney(recordedPurchaseOutflows),
      purchaseOutflows: roundMoney(purchaseOutflows),
      extraExpenses: roundMoney(extraExpenses),
      reversals: roundMoney(reversals),
      ownerWithdrawals: roundMoney(ownerWithdrawals),
      totalOutflows: roundMoney(totalOutflows),
      inventoryPurchases: roundMoney(inventoryPurchases),
      netMovement: roundMoney(netMovement),
      closingBalance: runningBalance,
    };
  });
}
