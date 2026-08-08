import { describe, expect, it } from 'vitest';
import type { CashTransaction } from '../types';
import { selectCashBookRows } from './cashBook';

const transaction = (
  id: string,
  description: string,
  kind: string,
  status: CashTransaction['status'] = 'confirmed',
  occurredOn = '2026-08-08',
): CashTransaction => ({
  id,
  organization_id: 'organization-1',
  device_id: null,
  contract_id: null,
  kind,
  direction: 'out',
  amount: 1200,
  occurred_on: occurredOn,
  description,
  status,
});

describe('selectCashBookRows', () => {
  it('mantem somente o frete operacional quando existe o mesmo frete como fornecedor', () => {
    const rows = selectCashBookRows([
      transaction('supplier-freight', 'Frete Wendel', 'supplier'),
      transaction('operating-freight', 'Frete Wendel', 'operating_expense'),
    ], '2026-08', 'out');

    expect(rows.map((row) => row.id)).toEqual(['operating-freight']);
  });

  it('nao exibe movimentacoes estornadas', () => {
    const rows = selectCashBookRows([
      transaction('reversed-freight', 'Frete Wendel', 'supplier', 'reversed'),
      transaction('operating-freight', 'Frete Wendel', 'operating_expense'),
    ], '2026-08', 'all');

    expect(rows.map((row) => row.id)).toEqual(['operating-freight']);
  });

  it('preserva outras saidas e fretes registrados em datas diferentes', () => {
    const rows = selectCashBookRows([
      transaction('stock-payment', 'Compra de aparelho', 'supplier'),
      transaction('first-freight', 'Frete Wendel', 'operating_expense'),
      transaction('second-freight', 'Frete Wendel', 'operating_expense', 'confirmed', '2026-08-09'),
    ], '2026-08', 'out');

    expect(rows.map((row) => row.id)).toEqual(['stock-payment', 'first-freight', 'second-freight']);
  });
});
