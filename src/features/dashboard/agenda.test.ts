import { describe, expect, it } from 'vitest';
import type { Contract, Installment, Payment } from '../../types';
import { buildAgendaDay, buildAgendaMarkers } from './agenda';

const contract = (id: string, clientId: string, clientName: string): Contract => ({
  id,
  organization_id: 'org-1',
  client_id: clientId,
  device_id: `device-${id}`,
  contract_number: `GR-${id}`,
  start_date: '2026-08-01',
  end_date: '2027-01-01',
  payment_frequency: 'monthly',
  due_day: 10,
  term_months: 5,
  monthly_amount: 850,
  deposit_amount: 0,
  deposit_as_first_installment: false,
  late_fee_percent: 2,
  daily_interest_percent: 0.1,
  purchase_option: false,
  purchase_option_amount: null,
  status: 'active',
  created_at: '2026-08-01T12:00:00Z',
  client: { id: clientId, full_name: clientName, cpf: '00000000000' },
  device: { id: `device-${id}`, model: `iPhone ${id}`, serial_number: `SERIAL-${id}`, status: 'rented' },
});

const installment = (
  id: string,
  dueDate: string,
  itemContract: Contract,
  status: Installment['status'] = 'pending',
  paidAmount = 0,
): Installment => ({
  id,
  organization_id: 'org-1',
  contract_id: itemContract.id,
  installment_number: 2,
  due_date: dueDate,
  original_amount: 850,
  discount_amount: 0,
  late_fee_amount: 20,
  interest_amount: 5,
  paid_amount: paidAmount,
  status,
  created_at: '2026-08-01T12:00:00Z',
  contract: itemContract,
});

const payment = (
  id: string,
  itemInstallment: Installment,
  amount: number,
  externalReference: string | null,
  status: Payment['status'] = 'confirmed',
): Payment => ({
  id,
  organization_id: 'org-1',
  installment_id: itemInstallment.id,
  amount,
  method: 'pix',
  paid_at: '2026-08-03T12:00:00Z',
  status,
  external_reference: externalReference,
  notes: null,
  reversed_at: null,
  reversal_reason: null,
  installment: itemInstallment,
});

describe('agenda de recebimentos', () => {
  it('separa vencimentos da data, atrasados e clientes unicos', () => {
    const wendel = contract('1', 'client-1', 'Wendel');
    const luana = contract('2', 'client-2', 'Luana');
    const result = buildAgendaDay([
      installment('due', '2026-08-03', wendel, 'partial', 400),
      installment('late', '2026-08-01', luana, 'overdue'),
      installment('future', '2026-08-10', wendel),
      installment('paid', '2026-08-02', wendel, 'paid', 875),
    ], [], '2026-08-03');

    expect(result.due.map((item) => item.installment.id)).toEqual(['due']);
    expect(result.dueAmount).toBe(475);
    expect(result.overdue.map((item) => item.installment.id)).toEqual(['late']);
    expect(result.overdueAmount).toBe(875);
    expect(result.clientsToContact).toBe(2);
  });

  it('agrupa um pagamento consolidado e ignora pagamentos estornados', () => {
    const wendel = contract('1', 'client-1', 'Wendel');
    const first = installment('first', '2026-08-03', wendel);
    const second = installment('second', '2026-09-03', wendel);
    const result = buildAgendaDay([first, second], [
      payment('payment-1', first, 500, 'client_payment:batch-1'),
      payment('payment-2', second, 350, 'client_payment:batch-1'),
      payment('payment-3', first, 100, null, 'reversed'),
    ], '2026-08-03');

    expect(result.receipts).toHaveLength(1);
    expect(result.receipts[0]?.amount).toBe(850);
    expect(result.receivedAmount).toBe(850);
  });

  it('marca dias com vencimentos atrasados e recibos consolidados', () => {
    const wendel = contract('1', 'client-1', 'Wendel');
    const first = installment('first', '2026-08-01', wendel, 'overdue');
    const second = installment('second', '2026-08-10', wendel);
    const markers = buildAgendaMarkers([first, second], [
      payment('payment-1', first, 500, 'client_payment:batch-1'),
      payment('payment-2', second, 350, 'client_payment:batch-1'),
    ], '2026-08-03');

    expect(markers.get('2026-08-01')).toMatchObject({ dueCount: 1, overdueCount: 1 });
    expect(markers.get('2026-08-03')?.receiptCount).toBe(1);
    expect(markers.get('2026-08-10')).toMatchObject({ dueCount: 1, overdueCount: 0 });
  });
});
