import { describe, expect, it } from 'vitest';
import type { CashTransaction } from '../types';
import { canonicalizeCashTransactions } from './cashTransactions';

const transaction = (
  id: string,
  description: string,
  kind: string,
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
  status: 'confirmed',
});

describe('canonicalizeCashTransactions', () => {
  it('mantem o frete operacional e remove o mesmo frete legado de fornecedor', () => {
    const result = canonicalizeCashTransactions([
      transaction('supplier-freight', 'Frete Wendel', 'supplier'),
      transaction('operating-freight', 'Frete Wendel', 'operating_expense'),
    ]);

    expect(result.map((item) => item.id)).toEqual(['operating-freight']);
  });

  it('preserva fretes de datas diferentes e outras compras de fornecedor', () => {
    const result = canonicalizeCashTransactions([
      transaction('stock-purchase', 'Compra de aparelho', 'supplier'),
      transaction('first-freight', 'Frete Wendel', 'operating_expense'),
      transaction('second-freight', 'Frete Wendel', 'operating_expense', '2026-08-09'),
    ]);

    expect(result.map((item) => item.id)).toEqual(['stock-purchase', 'first-freight', 'second-freight']);
  });
});
