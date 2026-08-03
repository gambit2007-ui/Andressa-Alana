import { isBefore, parseISO, startOfDay } from 'date-fns';
import type { Installment, Payment } from '../../types';

const openStatuses = new Set<Installment['status']>(['pending', 'partial', 'overdue']);

export type AgendaInstallment = {
  installment: Installment;
  balance: number;
};

export type AgendaReceipt = {
  key: string;
  clientId: string;
  clientName: string;
  devices: string[];
  amount: number;
  method: string;
  paidAt: string;
};

export type AgendaDay = {
  due: AgendaInstallment[];
  overdue: AgendaInstallment[];
  receipts: AgendaReceipt[];
  dueAmount: number;
  overdueAmount: number;
  receivedAmount: number;
  clientsToContact: number;
};

export type AgendaMarker = {
  dueCount: number;
  overdueCount: number;
  receiptCount: number;
};

export const installmentBalance = (installment: Installment): number => Math.max(
  0,
  installment.original_amount
    + installment.late_fee_amount
    + installment.interest_amount
    - installment.discount_amount
    - installment.paid_amount,
);

const isOpenInstallment = (installment: Installment): boolean => (
  openStatuses.has(installment.status) && installmentBalance(installment) > 0.009
);

const buildReceipts = (payments: Payment[], dateKey: string): AgendaReceipt[] => {
  const receipts = new Map<string, AgendaReceipt>();

  payments
    .filter((payment) => payment.status === 'confirmed' && payment.paid_at.startsWith(dateKey))
    .forEach((payment) => {
      const client = payment.installment?.contract?.client;
      if (!client) return;
      const groupedReference = payment.external_reference?.startsWith('client_payment:')
        ? payment.external_reference
        : null;
      const key = groupedReference ?? payment.id;
      const device = payment.installment?.contract?.device?.model;
      const current = receipts.get(key);

      if (current) {
        current.amount += payment.amount;
        if (device && !current.devices.includes(device)) current.devices.push(device);
        return;
      }

      receipts.set(key, {
        key,
        clientId: client.id,
        clientName: client.full_name,
        devices: device ? [device] : [],
        amount: payment.amount,
        method: payment.method,
        paidAt: payment.paid_at,
      });
    });

  return Array.from(receipts.values()).sort((left, right) => left.clientName.localeCompare(right.clientName));
};

export function buildAgendaDay(installments: Installment[], payments: Payment[], dateKey: string): AgendaDay {
  const selectedDate = startOfDay(parseISO(dateKey));
  const due: AgendaInstallment[] = [];
  const overdue: AgendaInstallment[] = [];

  installments.filter(isOpenInstallment).forEach((installment) => {
    const item = { installment, balance: installmentBalance(installment) };
    if (installment.due_date === dateKey) due.push(item);
    else if (isBefore(parseISO(installment.due_date), selectedDate)) overdue.push(item);
  });

  overdue.sort((left, right) => left.installment.due_date.localeCompare(right.installment.due_date));
  due.sort((left, right) => (
    left.installment.contract?.client?.full_name ?? ''
  ).localeCompare(right.installment.contract?.client?.full_name ?? ''));

  const receipts = buildReceipts(payments, dateKey);
  const clientIds = new Set(
    [...due, ...overdue]
      .map((item) => item.installment.contract?.client_id)
      .filter((clientId): clientId is string => Boolean(clientId)),
  );

  return {
    due,
    overdue,
    receipts,
    dueAmount: due.reduce((sum, item) => sum + item.balance, 0),
    overdueAmount: overdue.reduce((sum, item) => sum + item.balance, 0),
    receivedAmount: receipts.reduce((sum, receipt) => sum + receipt.amount, 0),
    clientsToContact: clientIds.size,
  };
}

export function buildAgendaMarkers(
  installments: Installment[],
  payments: Payment[],
  todayKey: string,
): Map<string, AgendaMarker> {
  const markers = new Map<string, AgendaMarker>();
  const getMarker = (dateKey: string) => markers.get(dateKey) ?? { dueCount: 0, overdueCount: 0, receiptCount: 0 };

  installments.filter(isOpenInstallment).forEach((installment) => {
    const marker = getMarker(installment.due_date);
    marker.dueCount += 1;
    if (installment.due_date < todayKey) marker.overdueCount += 1;
    markers.set(installment.due_date, marker);
  });

  const receiptKeysByDate = new Map<string, Set<string>>();
  payments.filter((payment) => payment.status === 'confirmed').forEach((payment) => {
    const dateKey = payment.paid_at.slice(0, 10);
    const receiptKey = payment.external_reference?.startsWith('client_payment:')
      ? payment.external_reference
      : payment.id;
    const receiptKeys = receiptKeysByDate.get(dateKey) ?? new Set<string>();
    receiptKeys.add(receiptKey);
    receiptKeysByDate.set(dateKey, receiptKeys);
  });

  receiptKeysByDate.forEach((receiptKeys, dateKey) => {
    const marker = getMarker(dateKey);
    marker.receiptCount = receiptKeys.size;
    markers.set(dateKey, marker);
  });

  return markers;
}
