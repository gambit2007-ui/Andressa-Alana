import { describe, expect, it } from 'vitest';
import type { CashTransaction } from '../types';
import { createCashTransactionsCsv, createMonthlyFinancialReport } from './financialReports';
import type { ProfessionalMonthMetrics } from './professionalFinance';

const month: ProfessionalMonthMetrics = {
  month: '2026-08',
  openingBalance: 0,
  closingBalance: 10785,
  cashEntries: 31565,
  cashOutflows: 20780,
  netCashFlow: 10785,
  rentalIncome: 0,
  depositIncome: 3865,
  salesIncome: 3700,
  otherIncome: 0,
  operationalRevenue: 7565,
  salesCost: 3200,
  salesMargin: 500,
  operatingExpenses: 1200,
  operationalResult: 3165,
  inventoryPurchases: 19580,
  capitalAdded: 24000,
  reversals: 0,
  ownerWithdrawals: 0,
  forecastReceivables: 850,
  overdueReceivables: 0,
  closingStatus: 'open',
  closingId: null,
  closedAt: null,
};

describe('financialReports', () => {
  it('gera um PDF mensal valido', async () => {
    const report = await createMonthlyFinancialReport(month);
    const bytes = new Uint8Array(await report.arrayBuffer());
    expect(report.type).toBe('application/pdf');
    expect(bytes.length).toBeGreaterThan(1000);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('%PDF');
  });

  it('exporta o Livro Caixa em CSV compativel com Excel', async () => {
    const transaction: CashTransaction = {
      id: 'cash-1', organization_id: 'org-1', device_id: null, contract_id: null,
      kind: 'operating_expense', direction: 'out', amount: 1200, occurred_on: '2026-08-08',
      description: 'Frete Wendel', status: 'confirmed',
    };
    const content = await createCashTransactionsCsv([transaction]).text();
    expect(content).toContain('"Data";');
    expect(content).toContain('Frete Wendel');
    expect(content).toContain('1200,00');
  });
});
