import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  History,
  Landmark,
  Plus,
  ReceiptText,
  RotateCcw,
  Scale,
  Search,
  Smartphone,
  UserRound,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useAuth } from '../../AuthGate';
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader } from '../../components/ui';
import {
  createCashTransaction,
  listCashTransactions,
  listDevices,
  listInstallments,
  listPayments,
  recordClientPayment,
  reversePayment,
} from '../../repositories/rentalRepository';
import { buildMonthlyCashClosings } from '../../domain/monthlyClosing';
import { cashTransactionSchema, type CashTransactionFormData } from '../../schemas/forms';
import type { Installment, InstallmentStatus, Payment } from '../../types';
import { formatCurrency, formatDate, formatMonthLabel } from '../../utils/formatters';

const statusLabel: Record<InstallmentStatus, string> = {
  pending: 'Pendente',
  partial: 'Parcial',
  overdue: 'Vencida',
  paid: 'Paga',
  cancelled: 'Cancelada',
  renegotiated: 'Renegociada',
};

const statusTone: Record<InstallmentStatus, string> = {
  pending: 'bg-cyan-50 text-cyan-700',
  partial: 'bg-amber-50 text-amber-700',
  overdue: 'bg-red-50 text-red-700',
  paid: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
  renegotiated: 'bg-violet-50 text-violet-700',
};

const paymentMethodLabel: Record<string, string> = {
  pix: 'Pix',
  card: 'Cartao',
  transfer: 'Transferencia',
  cash: 'Dinheiro',
  other: 'Outros',
};

const entryCategories = [
  { value: 'other_income', label: 'Receita diversa' },
  { value: 'capital_contribution', label: 'Aporte' },
  { value: 'device_sale', label: 'Venda de aparelho' },
  { value: 'deposit_received', label: 'Caucao recebida' },
];

const withdrawalCategories = [
  { value: 'operating_expense', label: 'Despesa operacional' },
  { value: 'maintenance', label: 'Manutencao' },
  { value: 'supplier', label: 'Fornecedor' },
  { value: 'tax', label: 'Imposto ou taxa' },
  { value: 'withdrawal', label: 'Retirada' },
];

const defaultCategory: Record<'in' | 'out', string> = {
  in: 'other_income',
  out: 'operating_expense',
};

const categoryLabel = Object.fromEntries([
  ...entryCategories,
  ...withdrawalCategories,
  { value: 'rental_payment', label: 'Recebimento de locacao' },
  { value: 'payment_reversal', label: 'Estorno de recebimento' },
].map((item) => [item.value, item.label]));

const dueTotal = (item: Installment) => item.original_amount + item.late_fee_amount + item.interest_amount - item.discount_amount;
const installmentBalance = (item: Installment) => Math.max(0, dueTotal(item) - item.paid_amount);

const today = () => {
  const date = new Date();
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
};

const cashDefaults = (): CashTransactionFormData => ({
  direction: 'in',
  kind: defaultCategory.in,
  amount: 0,
  occurred_on: today(),
  description: '',
});

type ClientFinanceGroup = {
  clientId: string;
  name: string;
  cpf: string;
  installments: Installment[];
  contractNumbers: string[];
  devices: string[];
  totalDue: number;
  paid: number;
  balance: number;
  overdue: number;
  nextDue: Installment | null;
};

type PaymentReceipt = {
  key: string;
  clientId: string;
  paymentId: string;
  amount: number;
  method: string;
  paidAt: string;
  status: 'confirmed' | 'reversed';
  externalReference: string | null;
  notes: string | null;
  reversalReason: string | null;
};

const buildClientGroups = (installments: Installment[]): ClientFinanceGroup[] => {
  const grouped = new Map<string, { name: string; cpf: string; installments: Installment[] }>();

  installments.forEach((installment) => {
    const client = installment.contract?.client;
    if (!client) return;
    const current = grouped.get(client.id) ?? { name: client.full_name, cpf: client.cpf, installments: [] };
    current.installments.push(installment);
    grouped.set(client.id, current);
  });

  return Array.from(grouped.entries()).map(([clientId, group]) => {
    const ordered = [...group.installments].sort((left, right) => left.due_date.localeCompare(right.due_date));
    const openInstallments = ordered.filter((item) => installmentBalance(item) > 0 && ['pending', 'partial', 'overdue'].includes(item.status));
    return {
      clientId,
      name: group.name,
      cpf: group.cpf,
      installments: ordered,
      contractNumbers: Array.from(new Set(ordered.map((item) => item.contract?.contract_number).filter(Boolean) as string[])),
      devices: Array.from(new Set(ordered.map((item) => item.contract?.device?.model).filter(Boolean) as string[])),
      totalDue: ordered.reduce((sum, item) => sum + dueTotal(item), 0),
      paid: ordered.reduce((sum, item) => sum + item.paid_amount, 0),
      balance: openInstallments.reduce((sum, item) => sum + installmentBalance(item), 0),
      overdue: openInstallments.filter((item) => item.status === 'overdue').reduce((sum, item) => sum + installmentBalance(item), 0),
      nextDue: openInstallments[0] ?? null,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
};

const buildReceipts = (payments: Payment[]): PaymentReceipt[] => {
  const receipts = new Map<string, PaymentReceipt>();

  payments.forEach((payment) => {
    const clientId = payment.installment?.contract?.client_id;
    if (!clientId) return;
    const groupedReference = payment.external_reference?.startsWith('client_payment:') ? payment.external_reference : null;
    const key = groupedReference ?? payment.id;
    const current = receipts.get(key);

    if (current) {
      current.amount += payment.amount;
      if (payment.status === 'confirmed') current.status = 'confirmed';
      return;
    }

    receipts.set(key, {
      key,
      clientId,
      paymentId: payment.id,
      amount: payment.amount,
      method: payment.method,
      paidAt: payment.paid_at,
      status: payment.status,
      externalReference: payment.external_reference,
      notes: payment.notes,
      reversalReason: payment.reversal_reason,
    });
  });

  return Array.from(receipts.values()).sort((left, right) => right.paidAt.localeCompare(left.paidAt));
};

export default function FinancePage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | InstallmentStatus>('all');
  const [cashFilter, setCashFilter] = useState<'all' | 'in' | 'out'>('all');
  const [selectedMonth, setSelectedMonth] = useState(today().slice(0, 7));
  const [cashModalOpen, setCashModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientFinanceGroup | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<PaymentReceipt | null>(null);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('pix');
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentNotes, setPaymentNotes] = useState('');
  const [reversalReason, setReversalReason] = useState('');
  const installmentsQuery = useQuery({ queryKey: ['installments'], queryFn: listInstallments, refetchOnMount: 'always' });
  const paymentsQuery = useQuery({ queryKey: ['payments'], queryFn: listPayments, refetchOnMount: 'always' });
  const cashQuery = useQuery({ queryKey: ['cash-transactions'], queryFn: listCashTransactions, refetchOnMount: 'always' });
  const devicesQuery = useQuery({ queryKey: ['devices'], queryFn: listDevices, refetchOnMount: 'always' });
  const cashForm = useForm<CashTransactionFormData>({
    resolver: zodResolver(cashTransactionSchema),
    defaultValues: cashDefaults(),
  });
  const cashDirection = cashForm.watch('direction');

  const refreshFinance = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['installments'] }),
      queryClient.invalidateQueries({ queryKey: ['payments'] }),
      queryClient.invalidateQueries({ queryKey: ['cash-transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['rental-overview'] }),
      queryClient.invalidateQueries({ queryKey: ['profitability'] }),
    ]);
  };

  const paymentMutation = useMutation({
    mutationFn: () => recordClientPayment({
      clientId: selectedClient!.clientId,
      amount,
      method,
      paidAt: new Date(`${paymentDate}T12:00:00`).toISOString(),
      notes: paymentNotes,
    }),
    onSuccess: async () => {
      await refreshFinance();
      setSelectedClient(null);
    },
  });

  const reversalMutation = useMutation({
    mutationFn: () => reversePayment(selectedReceipt!.paymentId, reversalReason),
    onSuccess: async () => {
      await refreshFinance();
      setSelectedReceipt(null);
      setReversalReason('');
    },
  });

  const cashMutation = useMutation({
    mutationFn: (values: CashTransactionFormData) => createCashTransaction(profile.organization_id, values),
    onSuccess: async () => {
      await refreshFinance();
      cashForm.reset(cashDefaults());
      setCashModalOpen(false);
    },
  });

  const clientGroups = useMemo(() => buildClientGroups(installmentsQuery.data ?? []), [installmentsQuery.data]);
  const receipts = useMemo(() => buildReceipts(paymentsQuery.data ?? []), [paymentsQuery.data]);
  const receiptsByClient = useMemo(() => {
    const grouped = new Map<string, PaymentReceipt[]>();
    receipts.forEach((receipt) => grouped.set(receipt.clientId, [...(grouped.get(receipt.clientId) ?? []), receipt]));
    return grouped;
  }, [receipts]);

  const filteredClients = useMemo(() => clientGroups.filter((group) => {
    const searchable = `${group.name} ${group.cpf} ${group.contractNumbers.join(' ')} ${group.devices.join(' ')}`.toLowerCase();
    const matchesStatus = status === 'all' || group.installments.some((item) => item.status === status);
    return matchesStatus && searchable.includes(search.toLowerCase());
  }), [clientGroups, search, status]);

  const stats = useMemo(() => ({
    received: clientGroups.reduce((sum, group) => sum + group.paid, 0),
    open: clientGroups.reduce((sum, group) => sum + group.balance - group.overdue, 0),
    overdue: clientGroups.reduce((sum, group) => sum + group.overdue, 0),
  }), [clientGroups]);

  const monthlyClosings = useMemo(() => buildMonthlyCashClosings(
    cashQuery.data ?? [],
    devicesQuery.data ?? [],
    today().slice(0, 7),
  ), [cashQuery.data, devicesQuery.data]);
  const selectedClosing = monthlyClosings.find((closing) => closing.month === selectedMonth)
    ?? monthlyClosings[monthlyClosings.length - 1];
  const currentClosing = monthlyClosings[monthlyClosings.length - 1];
  const professionalStats = useMemo(() => ({
    currentCash: currentClosing?.closingBalance ?? 0,
    capitalAdded: monthlyClosings.reduce((sum, closing) => sum + closing.capitalAdded, 0),
    directSales: monthlyClosings.reduce((sum, closing) => sum + closing.salesIncome, 0),
    depositsReceived: monthlyClosings.reduce((sum, closing) => sum + closing.depositIncome, 0),
    inventoryInvestment: (devicesQuery.data ?? []).reduce((sum, device) => sum + device.purchase_amount, 0),
  }), [currentClosing?.closingBalance, devicesQuery.data, monthlyClosings]);
  const cashRows = useMemo(() => (cashQuery.data ?? []).filter((item) => (
    item.occurred_on.slice(0, 7) === selectedClosing?.month
    && (cashFilter === 'all' || item.direction === cashFilter)
  )), [cashFilter, cashQuery.data, selectedClosing?.month]);

  if (installmentsQuery.isLoading || paymentsQuery.isLoading || cashQuery.isLoading || devicesQuery.isLoading) return <LoadingState />;
  const canManageFinance = ['admin', 'manager', 'finance'].includes(profile.role);
  const categories = cashDirection === 'in' ? entryCategories : withdrawalCategories;

  const chooseDirection = (direction: 'in' | 'out') => {
    cashForm.setValue('direction', direction, { shouldValidate: true });
    cashForm.setValue('kind', defaultCategory[direction], { shouldValidate: true });
  };

  const closeCashModal = () => {
    cashForm.reset(cashDefaults());
    cashMutation.reset();
    setCashModalOpen(false);
  };

  const openClientPayment = (group: ClientFinanceGroup) => {
    paymentMutation.reset();
    setSelectedClient(group);
    setAmount(group.nextDue ? installmentBalance(group.nextDue) : group.balance);
    setMethod('pix');
    setPaymentDate(today());
    setPaymentNotes('');
  };

  const closeClientPayment = () => {
    if (paymentMutation.isPending) return;
    paymentMutation.reset();
    setSelectedClient(null);
  };

  const openReversal = (receipt: PaymentReceipt) => {
    reversalMutation.reset();
    setSelectedReceipt(receipt);
    setReversalReason('');
  };

  const closeReversal = () => {
    if (reversalMutation.isPending) return;
    reversalMutation.reset();
    setSelectedReceipt(null);
    setReversalReason('');
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Caixa, clientes e cobranca"
        title="Financeiro"
        action={canManageFinance && (
          <button className="btn-primary" type="button" onClick={() => setCashModalOpen(true)}>
            <Plus className="h-4 w-4" />
            Nova movimentacao
          </button>
        )}
      />

      {installmentsQuery.error && <ErrorState error={installmentsQuery.error} />}
      {paymentsQuery.error && <ErrorState error={paymentsQuery.error} />}
      {cashQuery.error && <ErrorState error={cashQuery.error} />}
      {devicesQuery.error && <ErrorState error={devicesQuery.error} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: 'Caixa total', value: professionalStats.currentCash, icon: Landmark, tone: professionalStats.currentCash >= 0 ? 'text-cyan-700 bg-cyan-50' : 'text-red-700 bg-red-50', detail: 'Entradas confirmadas menos todas as saidas' },
          { label: 'Aportes', value: professionalStats.capitalAdded, icon: ArrowDownToLine, tone: 'text-emerald-700 bg-emerald-50', detail: 'Capital adicionado ao caixa' },
          { label: 'Venda direta', value: professionalStats.directSales, icon: Banknote, tone: 'text-blue-700 bg-blue-50', detail: 'Recebimentos por aparelhos vendidos' },
          { label: 'Caucoes', value: professionalStats.depositsReceived, icon: Scale, tone: 'text-amber-700 bg-amber-50', detail: 'Garantias recebidas nos contratos' },
          { label: 'Compras de estoque', value: professionalStats.inventoryInvestment, icon: Smartphone, tone: 'text-red-700 bg-red-50', detail: 'Valor usado na aquisicao de aparelhos' },
        ].map((item) => (
          <article key={item.label} className="metric-card flex items-center gap-4">
            <div className={`grid h-11 w-11 place-items-center rounded-xl ${item.tone}`}><item.icon className="h-5 w-5" /></div>
            <div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">{item.label}</p><p className="mt-1 text-xl font-extrabold text-slate-950">{formatCurrency(item.value)}</p><p className="mt-1 text-[10px] text-slate-400">{item.detail}</p></div>
          </article>
        ))}
      </div>

      {selectedClosing && (
        <section className="panel overflow-hidden p-0">
          <div className="flex flex-col gap-4 border-b border-slate-200/80 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div><p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-700">Controle gerencial</p><h2 className="mt-1 font-display text-2xl text-slate-950">Fechamento mensal</h2></div>
            <label className="form-field sm:w-56"><span>Mes de referencia</span><select className="input" value={selectedClosing.month} onChange={(event) => setSelectedMonth(event.target.value)}>{[...monthlyClosings].reverse().map((closing) => <option key={closing.month} value={closing.month}>{formatMonthLabel(closing.month)}</option>)}</select></label>
          </div>

          <div className="grid gap-px bg-slate-200/80 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Saldo inicial', value: selectedClosing.openingBalance, tone: 'text-slate-700 bg-slate-50' },
              { label: 'Entradas do mes', value: selectedClosing.totalEntries, tone: 'text-emerald-700 bg-emerald-50' },
              { label: 'Saidas do mes', value: selectedClosing.totalOutflows, tone: 'text-red-700 bg-red-50' },
              { label: 'Saldo final', value: selectedClosing.closingBalance, tone: selectedClosing.closingBalance >= 0 ? 'text-cyan-700 bg-cyan-50' : 'text-red-700 bg-red-50' },
            ].map((item) => (
              <article key={item.label} className="bg-white p-5"><p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{item.label}</p><p className={`mt-2 text-xl font-extrabold ${item.tone.split(' ')[0]}`}>{formatCurrency(item.value)}</p></article>
            ))}
          </div>

          <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-2">
            <article className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-5">
              <h3 className="flex items-center gap-2 font-extrabold text-emerald-900"><ArrowDownToLine className="h-4 w-4" />Composicao das entradas</h3>
              <div className="mt-4 space-y-3 text-sm">
                {[['Recebimentos de locacao', selectedClosing.rentalIncome], ['Vendas de aparelhos', selectedClosing.salesIncome], ['Caucoes recebidas', selectedClosing.depositIncome], ['Aportes ao caixa', selectedClosing.capitalAdded], ['Outras entradas', selectedClosing.otherIncome]].map(([label, value]) => <div key={String(label)} className="flex items-center justify-between gap-4"><span className="text-slate-600">{label}</span><strong className="text-emerald-800">{formatCurrency(Number(value))}</strong></div>)}
              </div>
            </article>
            <article className="rounded-2xl border border-red-100 bg-red-50/40 p-5">
              <h3 className="flex items-center gap-2 font-extrabold text-red-900"><ArrowUpFromLine className="h-4 w-4" />Composicao das saidas</h3>
              <div className="mt-4 space-y-3 text-sm">
                {[['Compras de aparelhos', selectedClosing.purchaseOutflows], ['Despesas extras', selectedClosing.extraExpenses], ['Estornos', selectedClosing.reversals], ['Retiradas', selectedClosing.ownerWithdrawals]].map(([label, value]) => <div key={String(label)} className="flex items-center justify-between gap-4"><span className="text-slate-600">{label}</span><strong className="text-red-800">{formatCurrency(Number(value))}</strong></div>)}
              </div>
            </article>
          </div>

          <div className="mx-5 mb-5 grid gap-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 sm:mx-6 sm:mb-6 sm:grid-cols-3">
            <div><p className="text-[10px] font-extrabold uppercase tracking-wider text-blue-600">Compras de estoque no mes</p><p className="mt-1 font-extrabold text-blue-950">{formatCurrency(selectedClosing.inventoryPurchases)}</p></div>
            <div><p className="text-[10px] font-extrabold uppercase tracking-wider text-blue-600">Lancamentos manuais de compra</p><p className="mt-1 font-extrabold text-blue-950">{formatCurrency(selectedClosing.recordedPurchaseOutflows)}</p></div>
            <div><p className="text-[10px] font-extrabold uppercase tracking-wider text-blue-600">Saida considerada no fechamento</p><p className="mt-1 font-extrabold text-emerald-700">{formatCurrency(selectedClosing.purchaseOutflows)}</p></div>
          </div>

          <div className="border-t border-slate-200/80">
            <div className="flex items-center gap-2 px-5 py-4 sm:px-6"><CalendarDays className="h-4 w-4 text-cyan-700" /><h3 className="font-extrabold text-slate-900">Historico de fechamentos</h3></div>
            <div className="table-shell mx-5 mb-5 overflow-x-auto sm:mx-6 sm:mb-6">
              <table className="min-w-[760px] w-full text-left text-xs">
                <thead className="bg-slate-950 text-[10px] uppercase tracking-wider text-slate-300"><tr><th className="px-4 py-3">Mes</th><th className="px-4 py-3">Saldo inicial</th><th className="px-4 py-3">Entradas</th><th className="px-4 py-3">Saidas</th><th className="px-4 py-3">Resultado</th><th className="px-4 py-3">Saldo final</th><th className="px-4 py-3">Compras</th></tr></thead>
                <tbody className="divide-y divide-slate-100 bg-white">{[...monthlyClosings].reverse().map((closing) => <tr key={closing.month} className={closing.month === selectedClosing.month ? 'bg-cyan-50/50' : ''}><td className="px-4 py-3 font-bold text-slate-900">{formatMonthLabel(closing.month)}</td><td className="px-4 py-3">{formatCurrency(closing.openingBalance)}</td><td className="px-4 py-3 font-semibold text-emerald-700">{formatCurrency(closing.totalEntries)}</td><td className="px-4 py-3 font-semibold text-red-700">{formatCurrency(closing.totalOutflows)}</td><td className={`px-4 py-3 font-bold ${closing.netMovement >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(closing.netMovement)}</td><td className="px-4 py-3 font-extrabold text-slate-950">{formatCurrency(closing.closingBalance)}</td><td className="px-4 py-3">{formatCurrency(closing.purchaseOutflows)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <section className="panel overflow-hidden p-0">
        <div className="flex flex-col gap-4 border-b border-slate-200/80 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-700">{selectedClosing ? formatMonthLabel(selectedClosing.month) : 'Movimentacoes'}</p>
            <h2 className="mt-1 font-display text-2xl text-slate-950">Livro Caixa</h2>
          </div>
          <select className="input sm:w-48" value={cashFilter} onChange={(event) => setCashFilter(event.target.value as 'all' | 'in' | 'out')}>
            <option value="all">Todas as movimentacoes</option>
            <option value="in">Somente entradas</option>
            <option value="out">Somente retiradas</option>
          </select>
        </div>

        <div className="grid gap-px bg-slate-200/80 sm:grid-cols-3">
          {[
            { label: 'Entradas do mes', value: selectedClosing?.totalEntries ?? 0, icon: ArrowDownToLine, tone: 'text-emerald-700 bg-emerald-50' },
            { label: 'Saidas do mes', value: selectedClosing?.totalOutflows ?? 0, icon: ArrowUpFromLine, tone: 'text-red-700 bg-red-50' },
            { label: 'Saldo final', value: selectedClosing?.closingBalance ?? 0, icon: Scale, tone: (selectedClosing?.closingBalance ?? 0) >= 0 ? 'text-cyan-700 bg-cyan-50' : 'text-red-700 bg-red-50' },
          ].map((item) => (
            <article key={item.label} className="flex items-center gap-3 bg-white p-5">
              <div className={`grid h-10 w-10 place-items-center rounded-xl ${item.tone}`}><item.icon className="h-5 w-5" /></div>
              <div><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{item.label}</p><p className="mt-1 text-lg font-extrabold text-slate-950">{formatCurrency(item.value)}</p></div>
            </article>
          ))}
        </div>

        {cashRows.length === 0 ? (
          <div className="grid min-h-36 place-items-center p-6 text-sm font-semibold text-slate-500">Nenhuma movimentacao registrada.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {cashRows.map((item) => {
              const isEntry = item.direction === 'in';
              const Icon = isEntry ? ArrowDownToLine : ArrowUpFromLine;
              return (
                <article key={item.id} className="flex items-center gap-3 px-5 py-4 sm:px-6">
                  <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${isEntry ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}><Icon className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-slate-900">{item.description}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{categoryLabel[item.kind] ?? item.kind} - {formatDate(item.occurred_on)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`font-extrabold ${isEntry ? 'text-emerald-700' : 'text-red-700'}`}>{isEntry ? '+' : '-'} {formatCurrency(item.amount)}</p>
                    {item.status === 'reversed' && <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Estornada</span>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-700">Contas por pessoa</p><h2 className="mt-1 font-display text-2xl text-slate-950">Clientes e recebimentos</h2></div>
          <p className="text-sm font-semibold text-slate-500">{filteredClients.length} cliente{filteredClients.length === 1 ? '' : 's'}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Total recebido', value: stats.received, icon: CheckCircle2, tone: 'text-emerald-700 bg-emerald-50' },
            { label: 'Saldo em aberto', value: stats.open, icon: Clock3, tone: 'text-amber-700 bg-amber-50' },
            { label: 'Saldo em atraso', value: stats.overdue, icon: AlertCircle, tone: 'text-red-700 bg-red-50' },
          ].map((item) => (
            <article key={item.label} className="metric-card flex items-center gap-4">
              <div className={`grid h-11 w-11 place-items-center rounded-xl ${item.tone}`}><item.icon className="h-5 w-5" /></div>
              <div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">{item.label}</p><p className="mt-1 text-xl font-extrabold text-slate-950">{formatCurrency(item.value)}</p></div>
            </article>
          ))}
        </div>

        <div className="panel flex flex-col gap-3 p-3 md:flex-row">
          <div className="relative flex-1"><Search className="input-icon" /><input className="input border-0 bg-slate-50 pl-11" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cliente, CPF, contrato ou aparelho" /></div>
          <select className="input md:w-48" value={status} onChange={(event) => setStatus(event.target.value as 'all' | InstallmentStatus)}>
            <option value="all">Todos os status</option>
            {Object.entries(statusLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>

        {filteredClients.length === 0 ? <EmptyState title="Nenhum cliente encontrado" description="Os clientes com contratos aparecerao aqui." /> : (
          <div className="space-y-4">
            {filteredClients.map((group) => {
              const clientReceipts = receiptsByClient.get(group.clientId) ?? [];
              const groupStatus = group.overdue > 0 ? 'Em atraso' : group.balance > 0 ? 'Em aberto' : 'Em dia';
              const groupTone = group.overdue > 0 ? 'bg-red-50 text-red-700' : group.balance > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700';
              return (
                <article key={group.clientId} className="panel overflow-hidden p-0">
                  <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-950 text-cyan-300"><UserRound className="h-5 w-5" /></div>
                      <div className="min-w-0"><h3 className="truncate text-lg font-extrabold text-slate-950">{group.name}</h3><p className="mt-0.5 text-xs text-slate-500">CPF {group.cpf} - {group.contractNumbers.length} contrato{group.contractNumbers.length === 1 ? '' : 's'}</p></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[520px]">
                      <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Contratado</p><p className="mt-1 font-extrabold text-slate-900">{formatCurrency(group.totalDue)}</p></div>
                      <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Recebido</p><p className="mt-1 font-extrabold text-emerald-700">{formatCurrency(group.paid)}</p></div>
                      <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Saldo</p><p className="mt-1 font-extrabold text-slate-900">{formatCurrency(group.balance)}</p></div>
                      <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Proximo vencimento</p><p className="mt-1 font-bold text-slate-700">{group.nextDue ? formatDate(group.nextDue.due_date) : 'Quitado'}</p></div>
                    </div>
                    <div className="flex items-center gap-2 lg:flex-col lg:items-stretch">
                      <span className={`status-pill justify-center ${groupTone}`}>{groupStatus}</span>
                      {canManageFinance && group.balance > 0 && <button className="btn-primary flex-1 whitespace-nowrap lg:flex-none" type="button" onClick={() => openClientPayment(group)}><Banknote className="h-4 w-4" />Receber</button>}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3 sm:px-6">
                    {group.devices.map((device) => <span key={device} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-sm"><Smartphone className="h-3.5 w-3.5 text-cyan-700" />{device}</span>)}
                    {group.overdue > 0 && <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700">Atraso: {formatCurrency(group.overdue)}</span>}
                  </div>

                  <div className="grid border-t border-slate-100 xl:grid-cols-2">
                    <details className="group border-b border-slate-100 xl:border-b-0 xl:border-r">
                      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-bold text-slate-800 sm:px-6"><span>Ver parcelas ({group.installments.length})</span><ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" /></summary>
                      <div className="divide-y divide-slate-100 border-t border-slate-100">
                        {group.installments.map((item) => (
                          <div key={item.id} className="grid gap-2 px-5 py-3 text-xs sm:grid-cols-[1.2fr_.8fr_.8fr_auto] sm:items-center sm:px-6">
                            <div><p className="font-bold text-slate-800">{item.contract?.device?.model} - parcela {item.installment_number}/{(item.contract?.term_months ?? 0) + (item.contract?.deposit_as_first_installment ? 1 : 0)}</p><p className="mt-0.5 font-mono text-[10px] text-slate-400">{item.contract?.contract_number}</p></div>
                            <div><p className="text-slate-400">Vencimento</p><p className="mt-0.5 font-bold text-slate-700">{formatDate(item.due_date)}</p></div>
                            <div><p className="text-slate-400">Saldo</p><p className="mt-0.5 font-extrabold text-slate-900">{formatCurrency(installmentBalance(item))}</p></div>
                            <span className={`status-pill ${statusTone[item.status]}`}>{statusLabel[item.status]}</span>
                          </div>
                        ))}
                      </div>
                    </details>

                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-bold text-slate-800 sm:px-6"><span className="flex items-center gap-2"><History className="h-4 w-4 text-cyan-700" />Recebimentos ({clientReceipts.length})</span><ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" /></summary>
                      {clientReceipts.length === 0 ? <p className="border-t border-slate-100 px-5 py-4 text-sm text-slate-500 sm:px-6">Nenhum recebimento registrado.</p> : (
                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                          {clientReceipts.map((receipt) => (
                            <div key={receipt.key} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:px-6">
                              <div className="min-w-0 flex-1"><p className="font-bold text-slate-800">{receipt.externalReference === 'upfront_deposit' ? 'Caucao inicial' : 'Recebimento'} - {paymentMethodLabel[receipt.method] ?? receipt.method}</p><p className="mt-0.5 text-xs text-slate-500">{formatDate(receipt.paidAt)}{receipt.reversalReason ? ` - ${receipt.reversalReason}` : ''}</p></div>
                              <p className="font-extrabold text-slate-950">{formatCurrency(receipt.amount)}</p>
                              <span className={`status-pill ${receipt.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{receipt.status === 'confirmed' ? 'Confirmado' : 'Estornado'}</span>
                              {canManageFinance && receipt.status === 'confirmed' && <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs text-red-700" type="button" onClick={() => openReversal(receipt)}><RotateCcw className="h-3.5 w-3.5" />Estornar</button>}
                            </div>
                          ))}
                        </div>
                      )}
                    </details>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {cashModalOpen && (
        <Modal title="Nova movimentacao" onClose={closeCashModal}>
          <form className="space-y-5" onSubmit={cashForm.handleSubmit((values) => cashMutation.mutate(values))}>
            {cashMutation.error && <ErrorState error={cashMutation.error} />}
            <input type="hidden" {...cashForm.register('direction')} />
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1.5">
              <button className={`min-h-11 rounded-xl px-4 text-sm font-bold transition ${cashDirection === 'in' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`} type="button" onClick={() => chooseDirection('in')}>Entrada</button>
              <button className={`min-h-11 rounded-xl px-4 text-sm font-bold transition ${cashDirection === 'out' ? 'bg-white text-red-700 shadow-sm' : 'text-slate-500'}`} type="button" onClick={() => chooseDirection('out')}>Retirada</button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="form-field"><span>Valor *</span><input className="input" type="number" min="0.01" step="0.01" {...cashForm.register('amount', { valueAsNumber: true })} />{cashForm.formState.errors.amount && <small>{cashForm.formState.errors.amount.message}</small>}</label>
              <label className="form-field"><span>Data *</span><input className="input" type="date" {...cashForm.register('occurred_on')} />{cashForm.formState.errors.occurred_on && <small>{cashForm.formState.errors.occurred_on.message}</small>}</label>
            </div>
            <label className="form-field"><span>Categoria *</span><select className="input" {...cashForm.register('kind')}>{categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>{cashForm.formState.errors.kind && <small>{cashForm.formState.errors.kind.message}</small>}</label>
            <label className="form-field"><span>Descricao *</span><input className="input" placeholder="Identifique a movimentacao" {...cashForm.register('description')} />{cashForm.formState.errors.description && <small>{cashForm.formState.errors.description.message}</small>}</label>
            <div className="flex justify-end gap-3 border-t border-slate-200 pt-5"><button className="btn-secondary" type="button" onClick={closeCashModal}>Cancelar</button><button className="btn-primary" disabled={cashMutation.isPending} type="submit"><Banknote className="h-4 w-4" />{cashMutation.isPending ? 'Registrando...' : 'Registrar movimentacao'}</button></div>
          </form>
        </Modal>
      )}

      {selectedClient && (
        <Modal title={`Receber de ${selectedClient.name}`} description="O valor sera aplicado automaticamente nas parcelas mais antigas." onClose={closeClientPayment}>
          <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); paymentMutation.mutate(); }}>
            {paymentMutation.error && <ErrorState error={paymentMutation.error} />}
            <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-100 p-4 text-sm"><div><p className="text-xs text-slate-500">Saldo total</p><p className="mt-1 font-extrabold text-slate-950">{formatCurrency(selectedClient.balance)}</p></div><div><p className="text-xs text-slate-500">Proximo vencimento</p><p className="mt-1 font-bold text-slate-800">{selectedClient.nextDue ? formatDate(selectedClient.nextDue.due_date) : 'Quitado'}</p></div></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="form-field"><span>Valor recebido *</span><input className="input" type="number" min="0.01" max={selectedClient.balance} step="0.01" required value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label>
              <label className="form-field"><span>Data do pagamento *</span><input className="input" type="date" required value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
            </div>
            <label className="form-field"><span>Forma de pagamento *</span><select className="input" value={method} onChange={(event) => setMethod(event.target.value)}><option value="pix">Pix</option><option value="card">Cartao</option><option value="transfer">Transferencia</option><option value="cash">Dinheiro</option><option value="other">Outro</option></select></label>
            <label className="form-field"><span>Observacao</span><input className="input" value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} placeholder="Opcional" /></label>
            <div className="flex justify-end gap-3 border-t border-slate-200 pt-5"><button className="btn-secondary" type="button" onClick={closeClientPayment}>Cancelar</button><button className="btn-primary" disabled={paymentMutation.isPending || amount <= 0 || amount > selectedClient.balance || !paymentDate} type="submit"><Banknote className="h-4 w-4" />{paymentMutation.isPending ? 'Registrando...' : 'Confirmar recebimento'}</button></div>
          </form>
        </Modal>
      )}

      {selectedReceipt && (
        <Modal title="Estornar recebimento" description={`${formatCurrency(selectedReceipt.amount)} - ${paymentMethodLabel[selectedReceipt.method] ?? selectedReceipt.method}`} onClose={closeReversal}>
          <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); reversalMutation.mutate(); }}>
            {reversalMutation.error && <ErrorState error={reversalMutation.error} />}
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">O saldo do cliente e o Livro Caixa serao atualizados automaticamente.</div>
            <label className="form-field"><span>Motivo do estorno *</span><textarea className="input min-h-24 resize-y py-3" minLength={3} required value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} placeholder="Explique o motivo" /></label>
            <div className="flex justify-end gap-3 border-t border-slate-200 pt-5"><button className="btn-secondary" type="button" onClick={closeReversal}>Cancelar</button><button className="btn-primary bg-red-700 hover:bg-red-800" disabled={reversalMutation.isPending || reversalReason.trim().length < 3} type="submit"><RotateCcw className="h-4 w-4" />{reversalMutation.isPending ? 'Estornando...' : 'Confirmar estorno'}</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
