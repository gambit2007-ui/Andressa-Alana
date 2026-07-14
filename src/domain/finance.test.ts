import { describe, expect, it } from 'vitest';
import {
  applyPayment,
  calculateCashSummary,
  calculateCharges,
  calculateProfitability,
  canExecuteMdmCommand,
  canTransitionContract,
  dueDateForMonth,
  generateInstallmentSchedule,
} from './finance';

describe('cronograma de parcelas', () => {
  it('ajusta dias 29, 30 e 31 para o ultimo dia valido', () => {
    expect(dueDateForMonth('2025-01-15', 1, 31)).toBe('2025-02-28');
    expect(dueDateForMonth('2025-03-15', 1, 31)).toBe('2025-04-30');
    expect(dueDateForMonth('2025-01-15', 1, 29)).toBe('2025-02-28');
  });

  it('respeita fevereiro em ano bissexto', () => {
    const schedule = generateInstallmentSchedule({ startDate: '2024-01-10', dueDay: 31, termMonths: 2, monthlyAmount: 699.9 });
    expect(schedule[0]).toEqual({ installmentNumber: 1, dueDate: '2024-02-29', amount: 699.9 });
    expect(schedule[1]?.dueDate).toBe('2024-03-31');
  });
});

describe('encargos e pagamentos', () => {
  it('calcula multa unica e juros diarios sobre saldo principal', () => {
    expect(calculateCharges({ originalAmount: 1000, paidAmount: 0, dueDate: '2026-07-01', asOfDate: '2026-07-06', lateFeePercent: 2, dailyInterestPercent: 0.1 }))
      .toEqual({ daysOverdue: 5, lateFee: 20, interest: 5, outstanding: 1025 });
  });

  it('mantem status parcial e liquida no pagamento integral', () => {
    expect(applyPayment({ totalDue: 1000, alreadyPaid: 0, paymentAmount: 400 })).toEqual({ paidAmount: 400, outstanding: 600, status: 'partial' });
    expect(applyPayment({ totalDue: 1000, alreadyPaid: 400, paymentAmount: 600 })).toEqual({ paidAmount: 1000, outstanding: 0, status: 'paid' });
  });
});

describe('resultado, caucao, venda, ROI e payback', () => {
  it('nao reconhece caucao como receita operacional', () => {
    expect(calculateCashSummary({ confirmedPayments: [700, 700], heldDeposits: [900], expenses: [200] }))
      .toEqual({ receivedRevenue: 1400, depositsHeld: 900, expenses: 200, cashBalance: 2100, operationalResult: 1200 });
  });

  it('inclui venda e custos vinculados na rentabilidade', () => {
    expect(calculateProfitability({ rentalRevenue: 6000, saleRevenue: 3500, purchaseCost: 7000, maintenanceCost: 500, mdmCost: 120, insuranceCost: 180, fees: 100, taxes: 200, otherExpenses: 100, averageMonthlyNet: 500 }))
      .toEqual({ revenue: 9500, expenses: 8200, netProfit: 1300, roi: 18.57, paybackMonths: 14 });
  });
});

describe('transicoes e permissoes', () => {
  it('bloqueia transicoes contratuais invalidas', () => {
    expect(canTransitionContract('active', 'completed')).toBe(true);
    expect(canTransitionContract('completed', 'active')).toBe(false);
  });

  it('exige admin, reautenticacao, motivo e serial para MDM destrutivo', () => {
    expect(canExecuteMdmCommand({ role: 'manager', command: 'sync', typedSerial: '', deviceSerial: 'ABC', reason: 'sync', recentlyReauthenticated: false })).toBe(true);
    expect(canExecuteMdmCommand({ role: 'manager', command: 'erase', typedSerial: 'ABC', deviceSerial: 'ABC', reason: 'Venda quitada e confirmada', recentlyReauthenticated: true })).toBe(false);
    expect(canExecuteMdmCommand({ role: 'admin', command: 'erase', typedSerial: 'ABC', deviceSerial: 'ABC', reason: 'Venda quitada e confirmada', recentlyReauthenticated: true })).toBe(true);
  });
});

describe('fluxo essencial de locacao', () => {
  it('gera contrato, recebe parcelas e calcula a venda final', () => {
    const installments = generateInstallmentSchedule({ startDate: '2026-01-20', dueDay: 31, termMonths: 3, monthlyAmount: 500 });
    const firstPayment = applyPayment({ totalDue: installments[0]!.amount, alreadyPaid: 0, paymentAmount: 500 });
    const result = calculateProfitability({ rentalRevenue: firstPayment.paidAmount + 1000, saleRevenue: 3000, purchaseCost: 4000, maintenanceCost: 100, mdmCost: 0, insuranceCost: 0, fees: 0, taxes: 0, otherExpenses: 0, averageMonthlyNet: 500 });
    expect(installments).toHaveLength(3);
    expect(firstPayment.status).toBe('paid');
    expect(result.netProfit).toBe(400);
    expect(canTransitionContract('active', 'completed')).toBe(true);
  });
});
