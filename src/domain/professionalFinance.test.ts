import { describe, expect, it } from 'vitest';
import type { CashTransaction, Device, DeviceSale, FinancialMonthClosing, Installment } from '../types';
import { buildProfessionalFinance, serializeMonthSnapshot } from './professionalFinance';

const cash = (id: string, direction: 'in' | 'out', kind: string, amount: number): CashTransaction => ({
  id,
  organization_id: 'org-1',
  device_id: null,
  contract_id: null,
  direction,
  kind,
  amount,
  occurred_on: '2026-08-08',
  description: kind,
  status: 'confirmed',
});

const device = (id: string, amount: number, status: Device['status']): Device => ({
  id,
  organization_id: 'org-1',
  model: id,
  color: 'Preto',
  capacity_gb: 128,
  imei_1: '123456789012345',
  imei_2: null,
  serial_number: id,
  battery_health: 90,
  purchase_date: '2026-08-01',
  purchase_amount: amount,
  supplier: null,
  invoice_number: null,
  warranty_until: null,
  condition: 'Bom',
  accessories: [],
  market_value: amount + 500,
  status,
  apple_business_registered: false,
  mdm_enrolled: false,
  created_at: '2026-08-01T00:00:00Z',
});

const installment = (id: string, dueDate: string, status: Installment['status'], original: number, paid = 0): Installment => ({
  id,
  organization_id: 'org-1',
  contract_id: 'contract-1',
  installment_number: 1,
  due_date: dueDate,
  original_amount: original,
  discount_amount: 0,
  late_fee_amount: 0,
  interest_amount: 0,
  paid_amount: paid,
  status,
  created_at: '2026-08-01T00:00:00Z',
});

describe('buildProfessionalFinance', () => {
  it('separa caixa, investimento em estoque e resultado operacional', () => {
    const soldDevice = device('sold-device', 3200, 'sold');
    const result = buildProfessionalFinance({
      transactions: [
        cash('contribution', 'in', 'capital_contribution', 24000),
        cash('sale', 'in', 'device_sale', 3700),
        cash('deposit', 'in', 'deposit_received', 3865),
        cash('freight', 'out', 'operating_expense', 1200),
      ],
      devices: [soldDevice, device('rented-device', 16380, 'rented')],
      installments: [
        installment('august-overdue', '2026-08-10', 'overdue', 480, 100),
        installment('september-open', '2026-09-10', 'pending', 850),
      ],
      sales: [{
        id: 'sale-1', organization_id: 'org-1', device_id: soldDevice.id, contract_id: null, client_id: null,
        buyer_name: 'Comprador', sale_amount: 3700, sold_at: '2026-08-08T12:00:00Z', payment_method: 'pix',
        paid_in_full: true, apple_release_confirmed: true, notes: null, created_at: '2026-08-08T12:00:00Z',
        device: soldDevice,
      } as DeviceSale],
      selectedYear: 2026,
      referenceDate: '2026-08-08',
    });

    const august = result.months[7]!;
    expect(result.currentCash).toBe(10785);
    expect(august.cashEntries).toBe(31565);
    expect(august.cashOutflows).toBe(20780);
    expect(august.inventoryPurchases).toBe(19580);
    expect(august.operationalRevenue).toBe(7565);
    expect(august.salesMargin).toBe(500);
    expect(august.operationalResult).toBe(3165);
    expect(result.accountsReceivable).toBe(1230);
    expect(result.overdueReceivables).toBe(380);
    expect(result.capitalInRentedFleet).toBe(16380);
    expect(result.annualContributions).toBe(24000);
  });

  it('usa o snapshot quando o mes esta fechado', () => {
    const live = buildProfessionalFinance({
      transactions: [cash('income', 'in', 'other_income', 1000)],
      devices: [], installments: [], sales: [], selectedYear: 2026, referenceDate: '2026-08-08',
    });
    const snapshot = serializeMonthSnapshot({ ...live.months[7]!, closingBalance: 900, operationalResult: 700 });
    const closing: FinancialMonthClosing = {
      id: 'closing-1', organization_id: 'org-1', month: '2026-08-01', status: 'closed', snapshot,
      closed_at: '2026-09-01T00:00:00Z', closed_by: 'user-1', reopened_at: null, reopened_by: null,
      created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    };
    const closed = buildProfessionalFinance({
      transactions: [cash('income', 'in', 'other_income', 1000)],
      devices: [], installments: [], sales: [], closings: [closing], selectedYear: 2026, referenceDate: '2026-08-08',
    });

    expect(closed.months[7]!.closingStatus).toBe('closed');
    expect(closed.months[7]!.closingBalance).toBe(900);
    expect(closed.months[7]!.operationalResult).toBe(700);
  });

  it('nao inclui lancamentos futuros no caixa atual', () => {
    const futureCash = { ...cash('future', 'in', 'other_income', 5000), occurred_on: '2026-09-01' };
    const result = buildProfessionalFinance({
      transactions: [cash('current', 'in', 'other_income', 1000), futureCash],
      devices: [], installments: [], sales: [], selectedYear: 2026, referenceDate: '2026-08-08',
    });

    expect(result.currentCash).toBe(1000);
    expect(result.months[8]!.cashEntries).toBe(5000);
  });
});
