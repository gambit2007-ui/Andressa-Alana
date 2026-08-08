import { describe, expect, it } from 'vitest';
import { buildMonthlyCashClosings } from './monthlyClosing';

const transaction = (
  occurred_on: string,
  direction: 'in' | 'out',
  kind: string,
  amount: number,
  status: 'confirmed' | 'reversed' = 'confirmed',
  description?: string,
) => ({ occurred_on, direction, kind, amount, status, description });

describe('fechamento mensal de caixa', () => {
  it('separa aportes, receitas, compras e despesas extras', () => {
    const [closing] = buildMonthlyCashClosings([
      transaction('2026-08-01', 'in', 'capital_contribution', 10000),
      transaction('2026-08-05', 'in', 'rental_payment', 1200),
      transaction('2026-08-06', 'in', 'device_sale', 3500),
      transaction('2026-08-07', 'out', 'supplier', 3200),
      transaction('2026-08-08', 'out', 'maintenance', 250),
    ], [{ purchase_date: '2026-08-02', purchase_amount: 3200 }], '2026-08');

    expect(closing).toMatchObject({
      openingBalance: 0,
      capitalAdded: 10000,
      rentalIncome: 1200,
      salesIncome: 3500,
      recordedPurchaseOutflows: 3200,
      purchaseOutflows: 3200,
      extraExpenses: 250,
      inventoryPurchases: 3200,
      totalEntries: 14700,
      totalOutflows: 3450,
      closingBalance: 11250,
    });
  });

  it('transporta o saldo final como saldo inicial do mes seguinte', () => {
    const closings = buildMonthlyCashClosings([
      transaction('2026-07-10', 'in', 'capital_contribution', 5000),
      transaction('2026-07-15', 'out', 'operating_expense', 800),
      transaction('2026-08-03', 'in', 'rental_payment', 600),
      transaction('2026-08-04', 'out', 'withdrawal', 200),
    ], [], '2026-08');

    expect(closings[0]).toMatchObject({ month: '2026-07', closingBalance: 4200 });
    expect(closings[1]).toMatchObject({ month: '2026-08', openingBalance: 4200, netMovement: 400, closingBalance: 4600 });
  });

  it('desconta compras patrimoniais sem lancamento duplicado no caixa', () => {
    const [closing] = buildMonthlyCashClosings([
      transaction('2026-08-01', 'in', 'other_income', 1000, 'reversed'),
      transaction('2026-08-02', 'out', 'payment_reversal', 300),
    ], [{ purchase_date: '2026-08-03', purchase_amount: 2500 }], '2026-08');

    expect(closing).toMatchObject({
      totalEntries: 0,
      reversals: 300,
      recordedPurchaseOutflows: 0,
      purchaseOutflows: 2500,
      inventoryPurchases: 2500,
      totalOutflows: 2800,
      closingBalance: -2800,
    });
  });

  it('usa lancamentos de compra como fallback quando nao ha estoque cadastrado', () => {
    const [closing] = buildMonthlyCashClosings([
      transaction('2026-08-01', 'in', 'capital_contribution', 5000),
      transaction('2026-08-02', 'out', 'supplier', 3200),
    ], [], '2026-08');

    expect(closing).toMatchObject({
      totalEntries: 5000,
      recordedPurchaseOutflows: 3200,
      inventoryPurchases: 0,
      purchaseOutflows: 3200,
      closingBalance: 1800,
    });
  });

  it('fecha o caixa com todas as entradas confirmadas e as compras reais do estoque', () => {
    const [closing] = buildMonthlyCashClosings([
      transaction('2026-08-01', 'in', 'capital_contribution', 24000),
      transaction('2026-08-02', 'in', 'device_sale', 3700),
      transaction('2026-08-03', 'in', 'rental_payment', 850, 'confirmed', 'Caucao recebida como primeira parcela'),
      transaction('2026-08-03', 'in', 'rental_payment', 480, 'confirmed', 'Caucao recebida como primeira parcela'),
      transaction('2026-08-04', 'in', 'deposit_received', 1300),
      transaction('2026-08-04', 'in', 'deposit_received', 1235),
      transaction('2026-08-05', 'out', 'operating_expense', 1200, 'confirmed', 'Frete Wendel'),
    ], [
      { purchase_date: '2026-08-05', purchase_amount: 12800 },
      { purchase_date: '2026-08-06', purchase_amount: 7980 },
    ], '2026-08');

    expect(closing).toMatchObject({
      capitalAdded: 24000,
      otherIncome: 0,
      salesIncome: 3700,
      rentalIncome: 0,
      depositIncome: 3865,
      totalEntries: 31565,
      recordedPurchaseOutflows: 0,
      inventoryPurchases: 20780,
      purchaseOutflows: 20780,
      extraExpenses: 1200,
      totalOutflows: 21980,
      closingBalance: 9585,
    });
  });
});
