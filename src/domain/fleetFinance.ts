import type { CashTransaction } from '../types';

type NumericValue = number | string | null | undefined;

export type FleetMetrics = {
  capitalInvested: number;
  rentalRevenue: number;
  salesRevenue: number;
  salesCost: number;
  salesMargin: number;
  otherRevenue: number;
  operationalRevenue: number;
  purchaseEntryRevenue: number;
  operationalExpenses: number;
  operationalProfit: number;
  currentFleetValue: number;
  assetVariation: number;
  economicResult: number;
  capitalRecovered: number;
  capitalToRecover: number;
  operationalRoi: number;
  economicRoi: number;
};

export type AssetMetrics = {
  rentalRevenue: number;
  saleRevenue: number;
  saleMargin: number;
  otherRevenue: number;
  operationalRevenue: number;
  purchaseEntryRevenue: number;
  operationalExpenses: number;
  operationalProfit: number;
  operationalRoi: number;
  purchaseValue: number;
  currentMarketValue: number;
  accumulatedDepreciation: number;
  economicResult: number;
  remainingToRecover: number;
  remainingPaybackMonths: number | null;
};

export const toFiniteNumber = (value: NumericValue): number => {
  const parsed = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const round = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const nonOperationalOutflowKinds = new Set([
  'asset_purchase',
  'capital_investment',
  'deposit_refund',
  'deposit_return',
  'device_purchase',
  'payment_reversal',
  'security_deposit_refund',
  'supplier',
  'withdrawal',
]);

const purchaseEntryReversalKinds = new Set([
  'deposit_refund',
  'deposit_return',
  'security_deposit_refund',
]);

export const isOperationalExpense = (
  transaction: Pick<CashTransaction, 'direction' | 'kind' | 'status'>,
): boolean => transaction.status === 'confirmed'
  && transaction.direction === 'out'
  && !nonOperationalOutflowKinds.has(transaction.kind);

export const isReceivedPurchaseEntry = (
  transaction: Pick<CashTransaction, 'direction' | 'kind' | 'status'>,
): boolean => transaction.status === 'confirmed'
  && transaction.direction === 'in'
  && transaction.kind === 'deposit_received';

export const isPurchaseEntryReversal = (
  transaction: Pick<CashTransaction, 'direction' | 'kind' | 'status'>,
): boolean => transaction.status === 'confirmed'
  && transaction.direction === 'out'
  && purchaseEntryReversalKinds.has(transaction.kind);

export const isOperationalIncome = (
  transaction: Pick<CashTransaction, 'direction' | 'kind' | 'status'>,
): boolean => transaction.status === 'confirmed'
  && transaction.direction === 'in'
  && transaction.kind === 'other_income';

export function calculateFleetMetrics(input: {
  capitalInvested: NumericValue;
  rentalRevenue: NumericValue;
  salesRevenue: NumericValue;
  salesCost: NumericValue;
  otherRevenue?: NumericValue;
  purchaseEntryRevenue?: NumericValue;
  operationalExpenses: NumericValue;
  currentFleetValue: NumericValue;
}): FleetMetrics {
  const capitalInvested = toFiniteNumber(input.capitalInvested);
  const rentalRevenue = toFiniteNumber(input.rentalRevenue);
  const salesRevenue = toFiniteNumber(input.salesRevenue);
  const salesCost = toFiniteNumber(input.salesCost);
  const salesMargin = salesRevenue - salesCost;
  const otherRevenue = toFiniteNumber(input.otherRevenue);
  const purchaseEntryRevenue = toFiniteNumber(input.purchaseEntryRevenue);
  const operationalRevenue = rentalRevenue + purchaseEntryRevenue + salesRevenue + otherRevenue;
  const operationalExpenses = toFiniteNumber(input.operationalExpenses);
  const currentFleetValue = toFiniteNumber(input.currentFleetValue);
  const operationalProfit = round(
    rentalRevenue + purchaseEntryRevenue + salesMargin + otherRevenue - operationalExpenses,
  );
  const assetVariation = round(currentFleetValue - capitalInvested);
  const economicResult = round(
    operationalRevenue + currentFleetValue - capitalInvested - operationalExpenses,
  );
  const cashGenerated = operationalRevenue - operationalExpenses;
  const capitalRecovered = round(Math.min(capitalInvested, Math.max(0, cashGenerated)));
  const capitalToRecover = round(Math.max(0, capitalInvested - cashGenerated));

  return {
    capitalInvested: round(capitalInvested),
    rentalRevenue: round(rentalRevenue),
    salesRevenue: round(salesRevenue),
    salesCost: round(salesCost),
    salesMargin: round(salesMargin),
    otherRevenue: round(otherRevenue),
    operationalRevenue: round(operationalRevenue),
    purchaseEntryRevenue: round(purchaseEntryRevenue),
    operationalExpenses: round(operationalExpenses),
    operationalProfit,
    currentFleetValue: round(currentFleetValue),
    assetVariation,
    economicResult,
    capitalRecovered,
    capitalToRecover,
    operationalRoi: capitalInvested > 0 ? round((operationalProfit / capitalInvested) * 100) : 0,
    economicRoi: capitalInvested > 0 ? round((economicResult / capitalInvested) * 100) : 0,
  };
}

export function calculateAssetMetrics(input: {
  rentalRevenue: NumericValue;
  saleRevenue?: NumericValue;
  otherRevenue?: NumericValue;
  purchaseEntryRevenue?: NumericValue;
  operationalExpenses: NumericValue;
  purchaseValue: NumericValue;
  currentMarketValue: NumericValue;
  averageMonthlyRevenue: NumericValue;
}): AssetMetrics {
  const rentalRevenue = toFiniteNumber(input.rentalRevenue);
  const saleRevenue = toFiniteNumber(input.saleRevenue);
  const otherRevenue = toFiniteNumber(input.otherRevenue);
  const purchaseEntryRevenue = toFiniteNumber(input.purchaseEntryRevenue);
  const operationalExpenses = toFiniteNumber(input.operationalExpenses);
  const purchaseValue = toFiniteNumber(input.purchaseValue);
  const currentMarketValue = toFiniteNumber(input.currentMarketValue);
  const averageMonthlyRevenue = toFiniteNumber(input.averageMonthlyRevenue);
  const saleMargin = saleRevenue > 0 ? saleRevenue - purchaseValue : 0;
  const operationalRevenue = rentalRevenue + purchaseEntryRevenue + saleRevenue + otherRevenue;
  const operationalProfit = round(
    rentalRevenue + purchaseEntryRevenue + saleMargin + otherRevenue - operationalExpenses,
  );
  const cashGenerated = operationalRevenue - operationalExpenses;
  const remainingToRecover = round(Math.max(0, purchaseValue - cashGenerated));

  return {
    rentalRevenue: round(rentalRevenue),
    saleRevenue: round(saleRevenue),
    saleMargin: round(saleMargin),
    otherRevenue: round(otherRevenue),
    operationalRevenue: round(operationalRevenue),
    purchaseEntryRevenue: round(purchaseEntryRevenue),
    operationalExpenses: round(operationalExpenses),
    operationalProfit,
    operationalRoi: purchaseValue > 0 ? round((operationalProfit / purchaseValue) * 100) : 0,
    purchaseValue: round(purchaseValue),
    currentMarketValue: round(currentMarketValue),
    accumulatedDepreciation: round(Math.max(0, purchaseValue - currentMarketValue)),
    economicResult: round(operationalRevenue + currentMarketValue - purchaseValue - operationalExpenses),
    remainingToRecover,
    remainingPaybackMonths: averageMonthlyRevenue > 0
      ? round(remainingToRecover / averageMonthlyRevenue)
      : null,
  };
}

export function calculateProjectedResidualValue(
  purchaseValueInput: NumericValue,
  annualDepreciationRateInput: NumericValue,
  monthsInOperationInput: NumericValue,
): number {
  const purchaseValue = toFiniteNumber(purchaseValueInput);
  const annualRate = Math.max(0, toFiniteNumber(annualDepreciationRateInput)) / 100;
  const monthsInOperation = Math.max(0, toFiniteNumber(monthsInOperationInput));
  const accumulatedProjection = purchaseValue * annualRate * (monthsInOperation / 12);
  return round(Math.max(purchaseValue * 0.3, purchaseValue - accumulatedProjection));
}
