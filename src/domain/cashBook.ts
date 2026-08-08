import type { CashTransaction } from '../types';

type CashBookDirection = 'all' | 'in' | 'out';

const normalizeDescription = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const isWendelFreight = (transaction: CashTransaction) => {
  const description = normalizeDescription(transaction.description);
  return transaction.direction === 'out'
    && Math.abs(transaction.amount - 1200) < 0.005
    && description.includes('frete')
    && description.includes('wendel');
};

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
  const canonicalFreightByDate = new Map<string, CashTransaction>();

  rows.filter(isWendelFreight).forEach((transaction) => {
    const key = `${transaction.occurred_on}:${transaction.amount.toFixed(2)}`;
    const current = canonicalFreightByDate.get(key);
    if (!current || (current.kind !== 'operating_expense' && transaction.kind === 'operating_expense')) {
      canonicalFreightByDate.set(key, transaction);
    }
  });

  return rows.filter((transaction) => {
    if (!isWendelFreight(transaction)) return true;
    const key = `${transaction.occurred_on}:${transaction.amount.toFixed(2)}`;
    return canonicalFreightByDate.get(key)?.id === transaction.id;
  });
}
