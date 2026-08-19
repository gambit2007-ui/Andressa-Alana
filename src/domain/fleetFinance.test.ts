import { describe, expect, it } from 'vitest';
import { formatCurrency, formatMonths, formatPercentage } from '../utils/formatters';
import {
  calculateAssetMetrics,
  calculateFleetMetrics,
  calculateProjectedResidualValue,
  isOperationalIncome,
  isOperationalExpense,
  isPurchaseEntryReversal,
  isReceivedPurchaseEntry,
  toFiniteNumber,
} from './fleetFinance';

describe('metricas financeiras da frota', () => {
  it('separa compra de ativo das despesas operacionais no exemplo obrigatorio', () => {
    expect(calculateFleetMetrics({
      capitalInvested: 5100,
      rentalRevenue: 1330,
      salesRevenue: 0,
      salesCost: 0,
      operationalExpenses: 0,
      currentFleetValue: 5700,
    })).toEqual({
      capitalInvested: 5100,
      rentalRevenue: 1330,
      salesRevenue: 0,
      salesCost: 0,
      salesMargin: 0,
      otherRevenue: 0,
      operationalRevenue: 1330,
      purchaseEntryRevenue: 0,
      operationalExpenses: 0,
      operationalProfit: 1330,
      currentFleetValue: 5700,
      assetVariation: 600,
      economicResult: 1930,
      capitalRecovered: 1330,
      capitalToRecover: 3770,
      operationalRoi: 26.08,
      economicRoi: 37.84,
    });
  });

  it('usa a margem da venda no lucro sem repetir o custo do aparelho', () => {
    expect(calculateFleetMetrics({
      capitalInvested: 19580,
      rentalRevenue: 1330,
      salesRevenue: 3700,
      salesCost: 3200,
      purchaseEntryRevenue: 3865,
      operationalExpenses: 1200,
      currentFleetValue: 20571.8,
    })).toEqual({
      capitalInvested: 19580,
      rentalRevenue: 1330,
      salesRevenue: 3700,
      salesCost: 3200,
      salesMargin: 500,
      otherRevenue: 0,
      operationalRevenue: 8895,
      purchaseEntryRevenue: 3865,
      operationalExpenses: 1200,
      operationalProfit: 4495,
      currentFleetValue: 20571.8,
      assetVariation: 991.8,
      economicResult: 8686.8,
      capitalRecovered: 7695,
      capitalToRecover: 11885,
      operationalRoi: 22.96,
      economicRoi: 44.37,
    });
  });

  it('calcula lucro, depreciacao e tempo restante por aparelho', () => {
    expect(calculateAssetMetrics({
      rentalRevenue: 1500,
      purchaseEntryRevenue: 900,
      operationalExpenses: 200,
      purchaseValue: 3200,
      currentMarketValue: 2800,
      averageMonthlyRevenue: 500,
    })).toEqual({
      rentalRevenue: 1500,
      saleRevenue: 0,
      saleMargin: 0,
      otherRevenue: 0,
      operationalRevenue: 2400,
      purchaseEntryRevenue: 900,
      operationalExpenses: 200,
      operationalProfit: 2200,
      operationalRoi: 68.75,
      purchaseValue: 3200,
      currentMarketValue: 2800,
      accumulatedDepreciation: 400,
      economicResult: 1800,
      remainingToRecover: 1000,
      remainingPaybackMonths: 2,
    });
  });

  it('calcula a venda pelo lucro real e nao pelo valor bruto recebido', () => {
    expect(calculateAssetMetrics({
      rentalRevenue: 480,
      saleRevenue: 3700,
      operationalExpenses: 100,
      purchaseValue: 3200,
      currentMarketValue: 0,
      averageMonthlyRevenue: 480,
    })).toMatchObject({
      saleMargin: 500,
      operationalRevenue: 4180,
      operationalProfit: 880,
      operationalRoi: 27.5,
      economicResult: 880,
      remainingToRecover: 0,
    });
  });

  it('exclui compra, retirada e estorno das despesas operacionais', () => {
    const transaction = (kind: string) => ({ direction: 'out' as const, status: 'confirmed' as const, kind });
    expect(isOperationalExpense(transaction('maintenance'))).toBe(true);
    expect(isOperationalExpense(transaction('operating_expense'))).toBe(true);
    expect(isOperationalExpense(transaction('device_purchase'))).toBe(false);
    expect(isOperationalExpense(transaction('supplier'))).toBe(false);
    expect(isOperationalExpense(transaction('withdrawal'))).toBe(false);
    expect(isOperationalExpense(transaction('payment_reversal'))).toBe(false);
  });

  it('reconhece a entrada de compra sem duplicar pagamentos antigos', () => {
    const transaction = (kind: string, direction: 'in' | 'out' = 'in', status: 'confirmed' | 'reversed' = 'confirmed') => ({
      direction,
      status,
      kind,
    });
    expect(isReceivedPurchaseEntry(transaction('deposit_received'))).toBe(true);
    expect(isReceivedPurchaseEntry(transaction('rental_payment'))).toBe(false);
    expect(isReceivedPurchaseEntry(transaction('deposit_received', 'in', 'reversed'))).toBe(false);
    expect(isReceivedPurchaseEntry(transaction('deposit_received', 'out'))).toBe(false);
    expect(isPurchaseEntryReversal(transaction('deposit_refund', 'out'))).toBe(true);
    expect(isPurchaseEntryReversal(transaction('deposit_received'))).toBe(false);
    expect(isOperationalIncome(transaction('other_income'))).toBe(true);
    expect(isOperationalIncome(transaction('capital_contribution'))).toBe(false);
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
