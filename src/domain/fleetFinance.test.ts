import { describe, expect, it } from 'vitest';
import { formatCurrency, formatMonths, formatPercentage } from '../utils/formatters';
import {
  calculateAssetMetrics,
  calculateFleetMetrics,
  calculateProjectedResidualValue,
  isOperationalExpense,
  toFiniteNumber,
} from './fleetFinance';

describe('metricas financeiras da frota', () => {
  it('separa compra de ativo das despesas operacionais no exemplo obrigatorio', () => {
    expect(calculateFleetMetrics({
      capitalInvested: 5100,
      revenuesReceived: 1330,
      operationalExpenses: 0,
      currentFleetValue: 5700,
    })).toEqual({
      capitalInvested: 5100,
      revenuesReceived: 1330,
      operationalExpenses: 0,
      operationalProfit: 1330,
      currentFleetValue: 5700,
      assetVariation: 600,
      consolidatedResult: 1930,
      operationalRoi: 26.08,
      consolidatedRoi: 37.84,
    });
  });

  it('calcula lucro, depreciacao e tempo restante por aparelho', () => {
    expect(calculateAssetMetrics({
      revenueReceived: 1500,
      operationalExpenses: 200,
      purchaseValue: 3200,
      currentMarketValue: 2800,
      averageMonthlyRevenue: 500,
    })).toEqual({
      revenueReceived: 1500,
      operationalExpenses: 200,
      operationalProfit: 1300,
      operationalRoi: 40.63,
      purchaseValue: 3200,
      currentMarketValue: 2800,
      accumulatedDepreciation: 400,
      economicResult: 900,
      remainingToRecover: 1900,
      remainingPaybackMonths: 3.8,
    });
  });

  it('exclui compra, retirada e estorno das despesas operacionais', () => {
    const transaction = (kind: string) => ({ direction: 'out' as const, status: 'confirmed' as const, kind });
    expect(isOperationalExpense(transaction('maintenance'))).toBe(true);
    expect(isOperationalExpense(transaction('operating_expense'))).toBe(true);
    expect(isOperationalExpense(transaction('device_purchase'))).toBe(false);
    expect(isOperationalExpense(transaction('withdrawal'))).toBe(false);
    expect(isOperationalExpense(transaction('payment_reversal'))).toBe(false);
  });

  it('mantem a depreciacao anual apenas como projecao patrimonial', () => {
    expect(calculateProjectedResidualValue(5000, 15, 24)).toBe(3500);
    expect(calculateProjectedResidualValue(5000, 50, 60)).toBe(1500);
  });

  it('protege calculos e formatadores contra dados invalidos', () => {
    expect(toFiniteNumber('1330,50')).toBe(1330.5);
    expect(toFiniteNumber(Number.NaN)).toBe(0);
    expect(formatCurrency(Number.NaN)).toBe('R$ 0,00');
    expect(formatPercentage(undefined)).toBe('0,00%');
    expect(formatMonths(null)).toBe('—');
  });
});
