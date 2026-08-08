import type { CashTransaction } from '../types';

type CanonicalCashTransaction = Pick<
  CashTransaction,
  'amount' | 'direction' | 'kind' | 'occurred_on' | 'status'
> & Partial<Pick<CashTransaction, 'description'>>;

const normalizeDescription = (value: string | undefined) => (value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

export const isWendelFreightTransaction = (transaction: CanonicalCashTransaction): boolean => {
  const description = normalizeDescription(transaction.description);
  return transaction.direction === 'out'
    && Math.abs(transaction.amount - 1200) < 0.005
    && description.includes('frete')
    && description.includes('wendel');
};

const freightPriority = (transaction: CanonicalCashTransaction): number => {
  if (transaction.kind === 'operating_expense') return 2;
  if (transaction.kind === 'supplier') return 1;
  return 0;
};

export function canonicalizeCashTransactions<T extends CanonicalCashTransaction>(transactions: T[]): T[] {
  const canonicalByKey = new Map<string, T>();

  transactions.filter(isWendelFreightTransaction).forEach((transaction) => {
    const key = `${transaction.status}:${transaction.occurred_on}:${transaction.amount.toFixed(2)}`;
    const current = canonicalByKey.get(key);
    if (!current || freightPriority(transaction) > freightPriority(current)) {
      canonicalByKey.set(key, transaction);
    }
  });

  return transactions.filter((transaction) => {
    if (!isWendelFreightTransaction(transaction)) return true;
    const key = `${transaction.status}:${transaction.occurred_on}:${transaction.amount.toFixed(2)}`;
    return canonicalByKey.get(key) === transaction;
  });
}
