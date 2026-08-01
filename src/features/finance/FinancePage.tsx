import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  CheckCircle2,
  Clock3,
  Plus,
  Scale,
  Search,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useAuth } from '../../AuthGate';
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader } from '../../components/ui';
import {
  createCashTransaction,
  listCashTransactions,
  listInstallments,
  recordPayment,
} from '../../repositories/rentalRepository';
import { cashTransactionSchema, type CashTransactionFormData } from '../../schemas/forms';
import type { Installment, InstallmentStatus } from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';

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
  { value: 'rental_payment', label: 'Recebimento de parcela' },
].map((item) => [item.value, item.label]));

const dueTotal = (item: Installment) => item.original_amount + item.late_fee_amount + item.interest_amount - item.discount_amount;
const balance = (item: Installment) => Math.max(0, dueTotal(item) - item.paid_amount);

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

export default function FinancePage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | InstallmentStatus>('all');
  const [cashFilter, setCashFilter] = useState<'all' | 'in' | 'out'>('all');
  const [cashModalOpen, setCashModalOpen] = useState(false);
  const [selected, setSelected] = useState<Installment | null>(null);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('pix');
  const installmentsQuery = useQuery({ queryKey: ['installments'], queryFn: listInstallments });
  const cashQuery = useQuery({ queryKey: ['cash-transactions'], queryFn: listCashTransactions });
  const cashForm = useForm<CashTransactionFormData>({
    resolver: zodResolver(cashTransactionSchema),
    defaultValues: cashDefaults(),
  });
  const cashDirection = cashForm.watch('direction');

  const paymentMutation = useMutation({
    mutationFn: () => recordPayment({
      installmentId: selected!.id,
      amount,
      method,
      paidAt: new Date().toISOString(),
      notes: 'Baixa manual pelo painel',
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['installments'] }),
        queryClient.invalidateQueries({ queryKey: ['cash-transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['rental-overview'] }),
      ]);
      setSelected(null);
    },
  });

  const cashMutation = useMutation({
    mutationFn: (values: CashTransactionFormData) => createCashTransaction(profile.organization_id, values),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cash-transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['rental-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['profitability'] }),
      ]);
      cashForm.reset(cashDefaults());
      setCashModalOpen(false);
    },
  });

  const filtered = useMemo(() => (installmentsQuery.data ?? []).filter((item) => {
    const term = search.toLowerCase();
    const searchable = `${item.contract?.client?.full_name ?? ''} ${item.contract?.contract_number ?? ''} ${item.contract?.device?.model ?? ''}`;
    return (status === 'all' || item.status === status) && searchable.toLowerCase().includes(term);
  }), [installmentsQuery.data, search, status]);

  const stats = useMemo(() => {
    const rows = installmentsQuery.data ?? [];
    return {
      received: rows.reduce((sum, item) => sum + item.paid_amount, 0),
      open: rows.filter((item) => ['pending', 'partial'].includes(item.status)).reduce((sum, item) => sum + balance(item), 0),
      overdue: rows.filter((item) => item.status === 'overdue').reduce((sum, item) => sum + balance(item), 0),
    };
  }, [installmentsQuery.data]);

  const cashStats = useMemo(() => {
    const rows = (cashQuery.data ?? []).filter((item) => item.status === 'confirmed');
    const entries = rows.filter((item) => item.direction === 'in').reduce((sum, item) => sum + item.amount, 0);
    const withdrawals = rows.filter((item) => item.direction === 'out').reduce((sum, item) => sum + item.amount, 0);
    return { entries, withdrawals, balance: entries - withdrawals };
  }, [cashQuery.data]);

  const cashRows = useMemo(() => (cashQuery.data ?? []).filter((item) => cashFilter === 'all' || item.direction === cashFilter), [cashFilter, cashQuery.data]);

  if (installmentsQuery.isLoading || cashQuery.isLoading) return <LoadingState />;
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

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Caixa, parcelas e cobranca"
        title="Financeiro"
        action={canManageFinance && (
          <button className="btn-primary" type="button" onClick={() => setCashModalOpen(true)}>
            <Plus className="h-4 w-4" />
            Nova movimentacao
          </button>
        )}
      />

      {installmentsQuery.error && <ErrorState error={installmentsQuery.error} />}
      {cashQuery.error && <ErrorState error={cashQuery.error} />}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Total recebido', value: stats.received, icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50' },
          { label: 'Saldo em aberto', value: stats.open, icon: Clock3, tone: 'text-amber-600 bg-amber-50' },
          { label: 'Saldo em atraso', value: stats.overdue, icon: AlertCircle, tone: 'text-red-600 bg-red-50' },
        ].map((item) => (
          <article key={item.label} className="metric-card flex items-center gap-4">
            <div className={`grid h-11 w-11 place-items-center rounded-xl ${item.tone}`}><item.icon className="h-5 w-5" /></div>
            <div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">{item.label}</p><p className="mt-1 text-xl font-extrabold text-slate-950">{formatCurrency(item.value)}</p></div>
          </article>
        ))}
      </div>

      <section className="panel overflow-hidden p-0">
        <div className="flex flex-col gap-4 border-b border-slate-200/80 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <h2 className="font-display text-2xl text-slate-950">Livro Caixa</h2>
          <select className="input sm:w-48" value={cashFilter} onChange={(event) => setCashFilter(event.target.value as 'all' | 'in' | 'out')}>
            <option value="all">Todas as movimentacoes</option>
            <option value="in">Somente entradas</option>
            <option value="out">Somente retiradas</option>
          </select>
        </div>

        <div className="grid gap-px bg-slate-200/80 sm:grid-cols-3">
          {[
            { label: 'Entradas', value: cashStats.entries, icon: ArrowDownToLine, tone: 'text-emerald-700 bg-emerald-50' },
            { label: 'Retiradas', value: cashStats.withdrawals, icon: ArrowUpFromLine, tone: 'text-red-700 bg-red-50' },
            { label: 'Saldo', value: cashStats.balance, icon: Scale, tone: cashStats.balance >= 0 ? 'text-cyan-700 bg-cyan-50' : 'text-red-700 bg-red-50' },
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
                  <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${isEntry ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-slate-900">{item.description}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{categoryLabel[item.kind] ?? item.kind} · {formatDate(item.occurred_on)}</p>
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
        <h2 className="font-display text-2xl text-slate-950">Parcelas dos contratos</h2>
        <div className="panel flex flex-col gap-3 p-3 md:flex-row">
          <div className="relative flex-1"><Search className="input-icon" /><input className="input border-0 bg-slate-50 pl-11" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cliente, contrato ou aparelho" /></div>
          <select className="input md:w-48" value={status} onChange={(event) => setStatus(event.target.value as 'all' | InstallmentStatus)}>
            <option value="all">Todos os status</option>
            {Object.entries(statusLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>

        {filtered.length === 0 ? <EmptyState title="Nenhuma parcela encontrada" description="As parcelas sao geradas automaticamente com os novos contratos." /> : (
          <div className="table-shell overflow-x-auto">
            <table className="min-w-[980px]">
              <thead><tr><th>Contrato / Cliente</th><th>Aparelho</th><th>Parcela</th><th>Vencimento</th><th>Total devido</th><th>Pago</th><th>Saldo</th><th>Status</th><th /></tr></thead>
              <tbody>{filtered.map((item) => (
                <tr key={item.id}>
                  <td><p className="font-bold text-slate-900">{item.contract?.client?.full_name}</p><p className="mt-0.5 font-mono text-[10px] text-slate-400">{item.contract?.contract_number}</p></td>
                  <td>{item.contract?.device?.model}<p className="font-mono text-[10px] text-slate-400">{item.contract?.device?.serial_number}</p></td>
                  <td className="font-bold">{item.installment_number}/{item.contract?.term_months}</td>
                  <td>{formatDate(item.due_date)}</td>
                  <td className="font-bold">{formatCurrency(dueTotal(item))}</td>
                  <td className="text-emerald-700">{formatCurrency(item.paid_amount)}</td>
                  <td className="font-extrabold text-slate-950">{formatCurrency(balance(item))}</td>
                  <td><span className={`status-pill ${statusTone[item.status]}`}>{statusLabel[item.status]}</span></td>
                  <td className="text-right">{canManageFinance && !['paid', 'cancelled', 'renegotiated'].includes(item.status) && <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" type="button" onClick={() => { setSelected(item); setAmount(balance(item)); }}>Baixar</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {cashModalOpen && (
        <Modal title="Nova movimentacao" onClose={closeCashModal}>
          <form className="space-y-5" onSubmit={cashForm.handleSubmit((values) => cashMutation.mutate(values))}>
            {cashMutation.error && <ErrorState error={cashMutation.error} />}
            <input type="hidden" {...cashForm.register('direction')} />
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1.5">
              <button className={`min-h-11 rounded-xl px-4 text-sm font-bold transition ${cashDirection === 'in' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`} type="button" onClick={() => chooseDirection('in')}>
                Entrada
              </button>
              <button className={`min-h-11 rounded-xl px-4 text-sm font-bold transition ${cashDirection === 'out' ? 'bg-white text-red-700 shadow-sm' : 'text-slate-500'}`} type="button" onClick={() => chooseDirection('out')}>
                Retirada
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="form-field"><span>Valor *</span><input className="input" type="number" min="0.01" step="0.01" {...cashForm.register('amount', { valueAsNumber: true })} />{cashForm.formState.errors.amount && <small>{cashForm.formState.errors.amount.message}</small>}</label>
              <label className="form-field"><span>Data *</span><input className="input" type="date" {...cashForm.register('occurred_on')} />{cashForm.formState.errors.occurred_on && <small>{cashForm.formState.errors.occurred_on.message}</small>}</label>
            </div>
            <label className="form-field"><span>Categoria *</span><select className="input" {...cashForm.register('kind')}>{categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>{cashForm.formState.errors.kind && <small>{cashForm.formState.errors.kind.message}</small>}</label>
            <label className="form-field"><span>Descricao *</span><input className="input" placeholder="Identifique a movimentacao" {...cashForm.register('description')} />{cashForm.formState.errors.description && <small>{cashForm.formState.errors.description.message}</small>}</label>
            <div className="flex justify-end gap-3 border-t border-slate-200 pt-5">
              <button className="btn-secondary" type="button" onClick={closeCashModal}>Cancelar</button>
              <button className="btn-primary" disabled={cashMutation.isPending} type="submit"><Banknote className="h-4 w-4" />{cashMutation.isPending ? 'Registrando...' : 'Registrar movimentacao'}</button>
            </div>
          </form>
        </Modal>
      )}

      {selected && (
        <Modal title="Registrar pagamento" description={`${selected.contract?.client?.full_name} · parcela ${selected.installment_number}`} onClose={() => setSelected(null)}>
          <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); paymentMutation.mutate(); }}>
            {paymentMutation.error && <ErrorState error={paymentMutation.error} />}
            <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-100 p-4 text-sm"><div><p className="text-xs text-slate-500">Saldo devido</p><p className="mt-1 font-extrabold text-slate-950">{formatCurrency(balance(selected))}</p></div><div><p className="text-xs text-slate-500">Vencimento</p><p className="mt-1 font-bold text-slate-800">{formatDate(selected.due_date)}</p></div></div>
            <label className="form-field"><span>Valor recebido *</span><input className="input" type="number" min="0.01" max={balance(selected)} step="0.01" required value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label>
            <label className="form-field"><span>Meio de pagamento</span><select className="input" value={method} onChange={(event) => setMethod(event.target.value)}><option value="pix">Pix</option><option value="card">Cartao</option><option value="transfer">Transferencia</option><option value="cash">Dinheiro</option></select></label>
            <div className="flex justify-end gap-3 border-t border-slate-200 pt-5"><button className="btn-secondary" type="button" onClick={() => setSelected(null)}>Cancelar</button><button className="btn-primary" disabled={paymentMutation.isPending || amount <= 0 || amount > balance(selected)} type="submit"><Banknote className="h-4 w-4" />{paymentMutation.isPending ? 'Registrando...' : 'Confirmar recebimento'}</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
