import type { CashTransaction } from '../types';

type NumericValue = number | string | null | undefined;

export type FleetMetrics = {
  capitalInvested: number;
  revenuesReceived: number;
  operationalExpenses: number;
  operationalProfit: number;
  currentFleetValue: number;
  assetVariation: number;
  consolidatedResult: number;
  operationalRoi: number;
  consolidatedRoi: number;
};

export type AssetMetrics = {
  revenueReceived: number;
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

export const isOperationalExpense = (
  transaction: Pick<CashTransaction, 'direction' | 'kind' | 'status'>,
): boolean => transaction.status === 'confirmed'
  && transaction.direction === 'out'
  && !nonOperationalOutflowKinds.has(transaction.kind);

export const isReceivedDeposit = (
  transaction: Pick<CashTransaction, 'direction' | 'kind' | 'status'>,
): boolean => transaction.status === 'confirmed'
  && transaction.direction === 'in'
  && transaction.kind === 'deposit_received';

export function calculateFleetMetrics(input: {
  capitalInvested: NumericValue;
  revenuesReceived: NumericValue;
  operationalExpenses: NumericValue;
  currentFleetValue: NumericValue;
}): FleetMetrics {
  const capitalInvested = toFiniteNumber(input.capitalInvested);
  const revenuesReceived = toFiniteNumber(input.revenuesReceived);
  const operationalExpenses = toFiniteNumber(input.operationalExpenses);
  const currentFleetValue = toFiniteNumber(input.currentFleetValue);
  const operationalProfit = round(revenuesReceived - operationalExpenses);
  const assetVariation = round(currentFleetValue - capitalInvested);
  const consolidatedResult = round(
    revenuesReceived + currentFleetValue - capitalInvested - operationalExpenses,
  );

  return {
    capitalInvested: round(capitalInvested),
    revenuesReceived: round(revenuesReceived),
    operationalExpenses: round(operationalExpenses),
    operationalProfit,
    currentFleetValue: round(currentFleetValue),
    assetVariation,
    consolidatedResult,
    operationalRoi: capitalInvested > 0 ? round((operationalProfit / capitalInvested) * 100) : 0,
    consolidatedRoi: capitalInvested > 0 ? round((consolidatedResult / capitalInvested) * 100) : 0,
  };
}

export function calculateAssetMetrics(input: {
  revenueReceived: NumericValue;
  operationalExpenses: NumericValue;
  purchaseValue: NumericValue;
  currentMarketValue: NumericValue;
  averageMonthlyRevenue: NumericValue;
}): AssetMetrics {
  const revenueReceived = toFiniteNumber(input.revenueReceived);
  const operationalExpenses = toFiniteNumber(input.operationalExpenses);
  const purchaseValue = toFiniteNumber(input.purchaseValue);
  const currentMarketValue = toFiniteNumber(input.currentMarketValue);
  const averageMonthlyRevenue = toFiniteNumber(input.averageMonthlyRevenue);
  const operationalProfit = round(revenueReceived - operationalExpenses);
  const remainingToRecover = round(Math.max(0, purchaseValue - operationalProfit));

  return {
    revenueReceived: round(revenueReceived),
    operationalExpenses: round(operationalExpenses),
    operationalProfit,
    operationalRoi: purchaseValue > 0 ? round((operationalProfit / purchaseValue) * 100) : 0,
    purchaseValue: round(purchaseValue),
    currentMarketValue: round(currentMarketValue),
    accumulatedDepreciation: round(Math.max(0, purchaseValue - currentMarketValue)),
    economicResult: round(revenueReceived + currentMarketValue - purchaseValue - operationalExpenses),
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
