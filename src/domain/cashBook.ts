import type { CashTransaction } from '../types';
import { canonicalizeCashTransactions } from './cashTransactions';

type CashBookDirection = 'all' | 'in' | 'out';

export function selectCashBookRows(
  transactions: CashTransaction[],
  month: string | undefined,
  direction: CashBookDirection,
): CashTransaction[] {
  const rows = transactions.filter((transaction) => (
    transaction.status === 'confirmed'
    && transaction.occurred_on.slice(0, 7) === month
    && (direction === 'all' || transaction.direction === direction)
  ));
  return canonicalizeCashTransactions(rows);
}
