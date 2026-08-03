import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  Boxes,
  CircleDollarSign,
  Clock3,
  Percent,
  Smartphone,
  TrendingUp,
} from 'lucide-react';
import { PageHeader, ErrorState, LoadingState } from '../../components/ui';
import { listCashTransactions, listContracts, listDevices, listInstallments, listPayments } from '../../repositories/rentalRepository';
import { formatCurrency, monthKey } from '../../utils/formatters';

export default function DashboardPage() {
  const [selectedMonth, setSelectedMonth] = useState(monthKey());
  const query = useQuery({
    queryKey: ['rental-overview'],
    queryFn: async () => {
      const [devices, contracts, installments, payments, transactions] = await Promise.all([
        listDevices(), listContracts(), listInstallments(), listPayments(), listCashTransactions(),
      ]);
      return { devices, contracts, installments, payments, transactions };
    },
  });

  const metrics = useMemo(() => {
    const data = query.data;
    if (!data) return null;
    const monthInstallments = data.installments.filter((item) => item.due_date.startsWith(selectedMonth));
    const received = data.payments
      .filter((item) => item.status === 'confirmed' && item.paid_at.startsWith(selectedMonth))
      .reduce((sum, item) => sum + item.amount, 0);
    const expenses = data.transactions
      .filter((item) => item.status === 'confirmed' && item.direction === 'out' && item.kind !== 'payment_reversal' && item.occurred_on.startsWith(selectedMonth))
      .reduce((sum, item) => sum + item.amount, 0);
    const expected = monthInstallments.reduce((sum, item) => sum + item.original_amount - item.discount_amount, 0);
    const open = monthInstallments
      .filter((item) => ['pending', 'partial', 'overdue'].includes(item.status))
      .reduce((sum, item) => sum + Math.max(0, item.original_amount + item.late_fee_amount + item.interest_amount - item.discount_amount - item.paid_amount), 0);
    const overdue = monthInstallments
      .filter((item) => item.status === 'overdue')
      .reduce((sum, item) => sum + Math.max(0, item.original_amount + item.late_fee_amount + item.interest_amount - item.discount_amount - item.paid_amount), 0);
    const activeFleet = data.devices.filter((item) => !['sold', 'retired'].includes(item.status));
    const rented = activeFleet.filter((item) => item.status === 'rented').length;
    const invested = activeFleet.reduce((sum, item) => sum + item.purchase_amount, 0);
    const fleetValue = activeFleet.reduce((sum, item) => sum + item.market_value, 0);
    const mrr = data.contracts.filter((item) => ['active', 'overdue'].includes(item.status)).reduce((sum, item) => sum + item.monthly_amount, 0);
    const profit = received - expenses;
    return {
      expected,
      received,
      expenses,
      open,
      overdue,
      invested,
      fleetValue,
      mrr,
      profit,
      roi: invested > 0 ? (profit / invested) * 100 : 0,
      payback: mrr > 0 ? invested / mrr : null,
      occupancy: activeFleet.length ? (rented / activeFleet.length) * 100 : 0,
      rented,
      fleetCount: activeFleet.length,
      overdueCount: monthInstallments.filter((item) => item.status === 'overdue').length,
      maintenanceCount: data.devices.filter((item) => item.status === 'maintenance').length,
    };
  }, [query.data, selectedMonth]);

  if (query.isLoading) return <LoadingState label="Consolidando a operacao..." />;
  if (query.error || !metrics) return <ErrorState error={query.error} />;

  const cards = [
    { label: 'MRR contratado', value: formatCurrency(metrics.mrr), icon: TrendingUp, tone: 'bg-cyan-50 text-cyan-700' },
    { label: 'Receita recebida', value: formatCurrency(metrics.received), icon: Banknote, tone: 'bg-emerald-50 text-emerald-700' },
    { label: 'Saldo em aberto', value: formatCurrency(metrics.open), icon: Clock3, tone: 'bg-amber-50 text-amber-700' },
    { label: 'Valor em atraso', value: formatCurrency(metrics.overdue), icon: AlertTriangle, tone: 'bg-red-50 text-red-700' },
  ];

  const maxRevenue = Math.max(metrics.expected, metrics.received, 1);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Comando executivo"
        title="Visao geral da operacao"
        action={<label className="form-field w-full sm:w-auto"><span>Competencia</span><input className="input" type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} /></label>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card, index) => (
          <motion.article key={card.label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.06 }} className="metric-card">
            <div className={`grid h-10 w-10 place-items-center rounded-xl ${card.tone}`}><card.icon className="h-5 w-5" /></div>
            <p className="mt-5 text-xs font-bold uppercase tracking-wider text-slate-500">{card.label}</p>
            <p className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">{card.value}</p>
          </motion.article>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_.65fr]">
        <section className="panel p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Desempenho mensal</p><h2 className="mt-1 font-display text-2xl text-slate-950">Previsto, recebido e resultado</h2></div>
            <CircleDollarSign className="h-6 w-6 text-cyan-700" />
          </div>
          <div className="mt-7 space-y-5">
            {[
              ['Receita prevista', metrics.expected, 'bg-slate-900'],
              ['Receita recebida', metrics.received, 'bg-cyan-500'],
              ['Despesas confirmadas', metrics.expenses, 'bg-amber-500'],
            ].map(([label, amount, color]) => (
              <div key={String(label)}>
                <div className="mb-2 flex justify-between text-sm"><span className="font-semibold text-slate-600">{label}</span><span className="font-extrabold text-slate-950">{formatCurrency(Number(amount))}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, (Number(amount) / maxRevenue) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="mt-7 grid gap-3 border-t border-slate-200 pt-5 sm:grid-cols-3">
            <div><p className="text-xs text-slate-500">Lucro operacional</p><p className={`mt-1 font-extrabold ${metrics.profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(metrics.profit)}</p></div>
            <div><p className="text-xs text-slate-500">ROI real no mes</p><p className="mt-1 font-extrabold text-slate-950">{metrics.roi.toFixed(2)}%</p></div>
            <div><p className="text-xs text-slate-500">Payback estimado</p><p className="mt-1 font-extrabold text-slate-950">{metrics.payback ? `${metrics.payback.toFixed(1)} meses` : 'Sem MRR'}</p></div>
          </div>
        </section>

        <section className="panel-dark relative overflow-hidden p-6 sm:p-7">
          <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-cyan-400/10 blur-2xl" />
          <p className="text-xs font-extrabold uppercase tracking-wider text-cyan-300">Frota ativa</p>
          <div className="mt-4 flex items-end justify-between"><p className="font-display text-5xl">{metrics.occupancy.toFixed(0)}%</p><Smartphone className="h-8 w-8 text-cyan-300" /></div>
          <p className="mt-2 text-sm text-slate-400">{metrics.rented} de {metrics.fleetCount} aparelhos em locacao</p>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-cyan-400" style={{ width: `${metrics.occupancy}%` }} /></div>
          <div className="mt-7 space-y-3 border-t border-white/10 pt-5 text-sm">
            <div className="flex justify-between text-slate-400"><span>Capital investido</span><strong className="text-white">{formatCurrency(metrics.invested)}</strong></div>
            <div className="flex justify-between text-slate-400"><span>Valor de mercado</span><strong className="text-white">{formatCurrency(metrics.fleetValue)}</strong></div>
          </div>
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { icon: AlertTriangle, label: 'Parcelas vencidas', value: metrics.overdueCount, detail: 'Exigem cobranca ou renegociacao', color: 'text-red-600' },
          { icon: Boxes, label: 'Em manutencao', value: metrics.maintenanceCount, detail: 'Fora da capacidade de locacao', color: 'text-amber-600' },
          { icon: Percent, label: 'Ocupacao', value: `${metrics.occupancy.toFixed(0)}%`, detail: 'Uso da frota operacional', color: 'text-cyan-700' },
        ].map((item) => (
          <article key={item.label} className="panel flex items-center gap-4 p-5">
            <item.icon className={`h-6 w-6 ${item.color}`} />
            <div className="flex-1"><p className="text-sm font-bold text-slate-800">{item.label}</p><p className="text-xs text-slate-500">{item.detail}</p></div>
            <span className="text-xl font-extrabold text-slate-950">{item.value}</span>
            <ArrowUpRight className="h-4 w-4 text-slate-300" />
          </article>
        ))}
      </div>
    </div>
  );
}
