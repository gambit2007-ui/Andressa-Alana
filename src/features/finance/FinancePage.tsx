import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Banknote, CheckCircle2, Clock3, Play, Search, WalletCards } from 'lucide-react';
import { useAuth } from '../../AuthGate';
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader } from '../../components/ui';
import { listInstallments, recordPayment, runBilling } from '../../repositories/rentalRepository';
import type { Installment, InstallmentStatus } from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';

const statusLabel: Record<InstallmentStatus, string> = { pending: 'Pendente', partial: 'Parcial', overdue: 'Vencida', paid: 'Paga', cancelled: 'Cancelada', renegotiated: 'Renegociada' };
const statusTone: Record<InstallmentStatus, string> = { pending: 'bg-cyan-50 text-cyan-700', partial: 'bg-amber-50 text-amber-700', overdue: 'bg-red-50 text-red-700', paid: 'bg-emerald-50 text-emerald-700', cancelled: 'bg-slate-100 text-slate-500', renegotiated: 'bg-violet-50 text-violet-700' };

const dueTotal = (item: Installment) => item.original_amount + item.late_fee_amount + item.interest_amount - item.discount_amount;
const balance = (item: Installment) => Math.max(0, dueTotal(item) - item.paid_amount);

export default function FinancePage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | InstallmentStatus>('all');
  const [selected, setSelected] = useState<Installment | null>(null);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('pix');
  const [billingMessage, setBillingMessage] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['installments'], queryFn: listInstallments });

  const paymentMutation = useMutation({
    mutationFn: () => recordPayment({ installmentId: selected!.id, amount, method, paidAt: new Date().toISOString(), notes: 'Baixa manual pelo painel' }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['installments'] }),
        queryClient.invalidateQueries({ queryKey: ['rental-overview'] }),
      ]);
      setSelected(null);
    },
  });
  const billingMutation = useMutation({
    mutationFn: runBilling,
    onSuccess: (result) => { setBillingMessage(`${result.message} ${result.simulated} notificacoes registradas como simuladas.`); },
  });

  const filtered = useMemo(() => (query.data ?? []).filter((item) => {
    const term = search.toLowerCase();
    return (status === 'all' || item.status === status) && `${item.contract?.client?.full_name ?? ''} ${item.contract?.contract_number ?? ''} ${item.contract?.device?.model ?? ''}`.toLowerCase().includes(term);
  }), [query.data, search, status]);

  const stats = useMemo(() => {
    const rows = query.data ?? [];
    return {
      received: rows.reduce((sum, item) => sum + item.paid_amount, 0),
      open: rows.filter((item) => ['pending', 'partial'].includes(item.status)).reduce((sum, item) => sum + balance(item), 0),
      overdue: rows.filter((item) => item.status === 'overdue').reduce((sum, item) => sum + balance(item), 0),
    };
  }, [query.data]);

  if (query.isLoading) return <LoadingState />;
  const canReceive = ['admin', 'manager', 'finance'].includes(profile.role);

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Caixa, parcelas e cobranca" title="Financeiro" action={<button className="btn-primary" type="button" disabled={billingMutation.isPending || !canReceive} onClick={() => billingMutation.mutate()}><Play className="h-4 w-4" />Executar regua mock</button>} />
      {(query.error || billingMutation.error) && <ErrorState error={query.error ?? billingMutation.error} />}
      {billingMessage && <div className="alert border-cyan-200 bg-cyan-50 text-cyan-800">{billingMessage}</div>}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Total recebido', value: stats.received, icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50' },
          { label: 'Saldo em aberto', value: stats.open, icon: Clock3, tone: 'text-amber-600 bg-amber-50' },
          { label: 'Saldo em atraso', value: stats.overdue, icon: AlertCircle, tone: 'text-red-600 bg-red-50' },
        ].map((item) => <article key={item.label} className="metric-card flex items-center gap-4"><div className={`grid h-11 w-11 place-items-center rounded-xl ${item.tone}`}><item.icon className="h-5 w-5" /></div><div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">{item.label}</p><p className="mt-1 text-xl font-extrabold text-slate-950">{formatCurrency(item.value)}</p></div></article>)}
      </div>

      <section className="panel-dark p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="text-xs font-extrabold uppercase tracking-[0.2em] text-cyan-300">Provider de cobranca: mock</p><h2 className="mt-1 font-display text-2xl">WhatsApp, email e Pix simulados</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400">A execucao registra notificacoes para auditoria, mas nao envia mensagens nem gera Pix real ate que um gateway seja configurado.</p></div><WalletCards className="h-8 w-8 shrink-0 text-cyan-300" /></div>
      </section>

      <div className="panel flex flex-col gap-3 p-3 md:flex-row"><div className="relative flex-1"><Search className="input-icon" /><input className="input border-0 bg-slate-50 pl-11" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cliente, contrato ou aparelho" /></div><select className="input md:w-48" value={status} onChange={(event) => setStatus(event.target.value as 'all' | InstallmentStatus)}><option value="all">Todos os status</option>{Object.entries(statusLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>

      {filtered.length === 0 ? <EmptyState title="Nenhuma parcela encontrada" description="As parcelas sao geradas automaticamente com os novos contratos." /> : (
        <div className="table-shell overflow-x-auto">
          <table className="min-w-[980px]"><thead><tr><th>Contrato / Cliente</th><th>Aparelho</th><th>Parcela</th><th>Vencimento</th><th>Total devido</th><th>Pago</th><th>Saldo</th><th>Status</th><th /></tr></thead>
            <tbody>{filtered.map((item) => <tr key={item.id}><td><p className="font-bold text-slate-900">{item.contract?.client?.full_name}</p><p className="mt-0.5 font-mono text-[10px] text-slate-400">{item.contract?.contract_number}</p></td><td>{item.contract?.device?.model}<p className="font-mono text-[10px] text-slate-400">{item.contract?.device?.serial_number}</p></td><td className="font-bold">{item.installment_number}/{item.contract?.term_months}</td><td>{formatDate(item.due_date)}</td><td className="font-bold">{formatCurrency(dueTotal(item))}</td><td className="text-emerald-700">{formatCurrency(item.paid_amount)}</td><td className="font-extrabold text-slate-950">{formatCurrency(balance(item))}</td><td><span className={`status-pill ${statusTone[item.status]}`}>{statusLabel[item.status]}</span></td><td className="text-right">{canReceive && !['paid', 'cancelled', 'renegotiated'].includes(item.status) && <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" type="button" onClick={() => { setSelected(item); setAmount(balance(item)); }}>Baixar</button>}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      {selected && <Modal title="Registrar pagamento" description={`${selected.contract?.client?.full_name} · parcela ${selected.installment_number}`} onClose={() => setSelected(null)}><form className="space-y-5" onSubmit={(event) => { event.preventDefault(); paymentMutation.mutate(); }}>
        {paymentMutation.error && <ErrorState error={paymentMutation.error} />}
        <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-100 p-4 text-sm"><div><p className="text-xs text-slate-500">Saldo devido</p><p className="mt-1 font-extrabold text-slate-950">{formatCurrency(balance(selected))}</p></div><div><p className="text-xs text-slate-500">Vencimento</p><p className="mt-1 font-bold text-slate-800">{formatDate(selected.due_date)}</p></div></div>
        <label className="form-field"><span>Valor recebido *</span><input className="input" type="number" min="0.01" max={balance(selected)} step="0.01" required value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label>
        <label className="form-field"><span>Meio de pagamento</span><select className="input" value={method} onChange={(event) => setMethod(event.target.value)}><option value="pix">Pix</option><option value="card">Cartao</option><option value="transfer">Transferencia</option><option value="cash">Dinheiro</option></select></label>
        <div className="flex justify-end gap-3 border-t border-slate-200 pt-5"><button className="btn-secondary" type="button" onClick={() => setSelected(null)}>Cancelar</button><button className="btn-primary" disabled={paymentMutation.isPending || amount <= 0 || amount > balance(selected)} type="submit"><Banknote className="h-4 w-4" />{paymentMutation.isPending ? 'Registrando...' : 'Confirmar recebimento'}</button></div>
      </form></Modal>}
    </div>
  );
}
