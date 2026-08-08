import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addMonths, eachDayOfInterval, endOfMonth, format, isSameDay, parseISO, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Percent,
  ReceiptText,
  Smartphone,
  TrendingUp,
  UsersRound,
} from 'lucide-react';
import { PageHeader, ErrorState, LoadingState } from '../../components/ui';
import { canonicalizeCashTransactions } from '../../domain/cashTransactions';
import { isOperationalExpense } from '../../domain/fleetFinance';
import { listCashTransactions, listContracts, listDevices, listInstallments, listPayments } from '../../repositories/rentalRepository';
import { formatCurrency, formatDate, monthKey } from '../../utils/formatters';
import { buildAgendaDay, buildAgendaMarkers, type AgendaInstallment, type AgendaReceipt } from './agenda';

const paymentMethodLabel: Record<string, string> = {
  pix: 'Pix',
  card: 'Cartao',
  transfer: 'Transferencia',
  cash: 'Dinheiro',
  other: 'Outros',
};

const currentDateKey = (): string => format(new Date(), 'yyyy-MM-dd');

function AgendaInstallmentList({
  title,
  items,
  overdue,
}: {
  title: string;
  items: AgendaInstallment[];
  overdue?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-extrabold uppercase tracking-[0.16em] text-slate-500">{title}</h3>
        <span className={`status-pill ${overdue ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.map(({ installment, balance }) => (
          <article key={installment.id} className="grid gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <p className="truncate font-extrabold text-slate-900">{installment.contract?.client?.full_name ?? 'Cliente nao identificado'}</p>
              <p className="mt-1 text-xs text-slate-500">
                {installment.contract?.device?.model ?? 'Aparelho'} - {installment.contract?.contract_number ?? 'Contrato'}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-400">Vencimento {formatDate(installment.due_date)} - parcela {installment.installment_number}</p>
            </div>
            <div className="flex items-center justify-between gap-3 sm:block sm:text-right">
              <p className={`text-sm font-extrabold ${overdue ? 'text-red-700' : 'text-slate-950'}`}>{formatCurrency(balance)}</p>
              <span className={`mt-1 inline-flex text-[10px] font-extrabold uppercase tracking-wider ${overdue ? 'text-red-600' : 'text-amber-600'}`}>
                {overdue ? 'Cobrar pendencia' : 'Vence na data'}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AgendaReceiptList({ receipts }: { receipts: AgendaReceipt[] }) {
  if (receipts.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-extrabold uppercase tracking-[0.16em] text-slate-500">Recebimentos realizados</h3>
        <span className="status-pill bg-emerald-50 text-emerald-700">{receipts.length}</span>
      </div>
      <div className="space-y-2">
        {receipts.map((receipt) => (
          <article key={receipt.key} className="flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 sm:flex-row sm:items-center">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-emerald-700 shadow-sm"><CheckCircle2 className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-extrabold text-slate-900">{receipt.clientName}</p>
              <p className="mt-1 text-xs text-slate-500">{receipt.devices.join(', ') || 'Recebimento de locacao'} - {paymentMethodLabel[receipt.method] ?? receipt.method}</p>
            </div>
            <p className="font-extrabold text-emerald-700">{formatCurrency(receipt.amount)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const [selectedMonth, setSelectedMonth] = useState(monthKey());
  const [selectedAgendaDate, setSelectedAgendaDate] = useState(currentDateKey);
  const agendaScrollerRef = useRef<HTMLDivElement | null>(null);
  const selectedDayRef = useRef<HTMLButtonElement | null>(null);
  const query = useQuery({
    queryKey: ['rental-overview'],
    queryFn: async () => {
      const [devices, contracts, installments, payments, transactions] = await Promise.all([
        listDevices(), listContracts(), listInstallments(), listPayments(), listCashTransactions(),
      ]);
      return { devices, contracts, installments, payments, transactions };
    },
  });

  const todayDateKey = currentDateKey();
  const agendaDays = useMemo(() => {
    const selectedDate = parseISO(selectedAgendaDate);
    return eachDayOfInterval({ start: startOfMonth(selectedDate), end: endOfMonth(selectedDate) });
  }, [selectedAgendaDate]);
  const agenda = useMemo(() => buildAgendaDay(
    query.data?.installments ?? [],
    query.data?.payments ?? [],
    selectedAgendaDate,
  ), [query.data, selectedAgendaDate]);
  const agendaMarkers = useMemo(() => buildAgendaMarkers(
    query.data?.installments ?? [],
    query.data?.payments ?? [],
    todayDateKey,
  ), [query.data, todayDateKey]);

  useEffect(() => {
    const scroller = agendaScrollerRef.current;
    const selectedDay = selectedDayRef.current;
    if (!scroller || !selectedDay) return;
    scroller.scrollTo({
      left: selectedDay.offsetLeft - (scroller.clientWidth - selectedDay.clientWidth) / 2,
      behavior: 'smooth',
    });
  }, [selectedAgendaDate]);

  const changeAgendaMonth = (offset: number) => {
    setSelectedAgendaDate(format(addMonths(parseISO(selectedAgendaDate), offset), 'yyyy-MM-dd'));
  };

  const metrics = useMemo(() => {
    const data = query.data;
    if (!data) return null;
    const monthInstallments = data.installments.filter((item) => item.due_date.startsWith(selectedMonth));
    const received = data.payments
      .filter((item) => item.status === 'confirmed' && item.paid_at.startsWith(selectedMonth))
      .reduce((sum, item) => sum + item.amount, 0);
    const expenses = canonicalizeCashTransactions(data.transactions)
      .filter((item) => isOperationalExpense(item) && item.occurred_on.startsWith(selectedMonth))
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
  const selectedDate = parseISO(selectedAgendaDate);
  const selectedDateLabel = format(selectedDate, "EEEE, d 'de' MMMM", { locale: ptBR });
  const agendaTaskCount = agenda.due.length + agenda.overdue.length;

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

      <section className="panel overflow-hidden p-0">
        <div className="flex flex-col gap-4 border-b border-slate-200/80 px-5 py-5 sm:px-7 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gold-200/60 text-gold-500"><CalendarDays className="h-5 w-5" /></div>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-gold-500">Agenda de recebimentos</p>
              <h2 className="mt-1 font-display text-2xl text-slate-950">Calendario operacional</h2>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-secondary min-h-10 w-10 p-0" type="button" aria-label="Mes anterior" onClick={() => changeAgendaMonth(-1)}><ChevronLeft className="h-4 w-4" /></button>
            <button className="btn-secondary min-h-10 px-4 py-2" type="button" onClick={() => setSelectedAgendaDate(todayDateKey)}>Hoje</button>
            <label className="min-w-0 flex-1 sm:flex-none">
              <span className="sr-only">Selecionar data da agenda</span>
              <input className="input min-h-10 min-w-0 sm:w-44" type="date" value={selectedAgendaDate} onChange={(event) => event.target.value && setSelectedAgendaDate(event.target.value)} />
            </label>
            <button className="btn-secondary min-h-10 w-10 p-0" type="button" aria-label="Proximo mes" onClick={() => changeAgendaMonth(1)}><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="border-b border-slate-200/80 bg-stone-50/70 px-4 py-4 sm:px-6">
          <div ref={agendaScrollerRef} className="overflow-x-auto pb-2 [scrollbar-color:rgba(173,130,64,0.35)_transparent] [scrollbar-width:thin]">
            <div className="flex min-w-max gap-2">
              {agendaDays.map((day) => {
                const dateKey = format(day, 'yyyy-MM-dd');
                const marker = agendaMarkers.get(dateKey);
                const selected = isSameDay(day, selectedDate);
                const today = dateKey === todayDateKey;
                const hasOverdue = Boolean(marker?.overdueCount);
                return (
                  <button
                    key={dateKey}
                    ref={selected ? selectedDayRef : undefined}
                    className={`relative flex h-[76px] w-[58px] shrink-0 flex-col items-center justify-center rounded-2xl border text-center transition focus:outline-none focus:ring-2 focus:ring-gold-300 focus:ring-offset-2 ${selected ? 'border-slate-950 bg-slate-950 text-white shadow-lg shadow-slate-950/20' : hasOverdue ? 'border-red-200 bg-red-50 text-red-900 hover:border-red-300' : 'border-slate-200 bg-white text-slate-800 hover:border-gold-300 hover:bg-gold-200/20'}`}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`${format(day, "d 'de' MMMM", { locale: ptBR })}. ${marker?.dueCount ?? 0} vencimentos e ${marker?.receiptCount ?? 0} recebimentos`}
                    onClick={() => setSelectedAgendaDate(dateKey)}
                  >
                    <span className={`text-[9px] font-extrabold uppercase tracking-wider ${selected ? 'text-cyan-300' : 'text-slate-400'}`}>{format(day, 'EEE', { locale: ptBR }).replace('.', '')}</span>
                    <span className="mt-1 text-lg font-extrabold leading-none">{format(day, 'dd')}</span>
                    <span className="mt-2 flex h-1.5 items-center gap-1">
                      {Boolean(marker?.dueCount) && <span className={`h-1.5 w-1.5 rounded-full ${hasOverdue ? 'bg-red-500' : selected ? 'bg-amber-300' : 'bg-amber-500'}`} />}
                      {Boolean(marker?.receiptCount) && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                    </span>
                    {today && <span className={`absolute -bottom-1 h-0.5 w-5 rounded-full ${selected ? 'bg-cyan-300' : 'bg-slate-900'}`} />}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" />Vencimento</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" />Parcela atrasada</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />Recebimento</span>
          </div>
        </div>

        <div className="grid lg:grid-cols-[320px_1fr]">
          <aside className="relative overflow-hidden bg-slate-950 p-6 text-white sm:p-7">
            <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-gold-400/15 blur-3xl" />
            <div className="relative">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-cyan-300">Agenda da data</p>
              <div className="mt-3 flex items-end gap-3">
                <span className="font-display text-6xl leading-none">{format(selectedDate, 'dd')}</span>
                <div className="pb-1"><p className="capitalize text-sm font-bold text-white">{format(selectedDate, 'EEEE', { locale: ptBR })}</p><p className="mt-0.5 capitalize text-xs text-slate-400">{format(selectedDate, "MMMM 'de' yyyy", { locale: ptBR })}</p></div>
              </div>

              <div className="mt-7 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3"><UsersRound className="h-4 w-4 text-cyan-300" /><p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Clientes a cobrar</p><p className="mt-1 text-xl font-extrabold">{agenda.clientsToContact}</p></div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3"><ReceiptText className="h-4 w-4 text-gold-300" /><p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Previsto na data</p><p className="mt-1 text-sm font-extrabold">{formatCurrency(agenda.dueAmount)}</p></div>
                <div className="rounded-2xl border border-red-400/15 bg-red-400/10 p-3"><AlertTriangle className="h-4 w-4 text-red-300" /><p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-red-200/70">Saldo atrasado</p><p className="mt-1 text-sm font-extrabold text-red-100">{formatCurrency(agenda.overdueAmount)}</p></div>
                <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/10 p-3"><CheckCircle2 className="h-4 w-4 text-emerald-300" /><p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-emerald-200/70">Recebido</p><p className="mt-1 text-sm font-extrabold text-emerald-100">{formatCurrency(agenda.receivedAmount)}</p></div>
              </div>
              <Link className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-gold-300" to="/finance"><Banknote className="h-4 w-4" />Abrir Financeiro</Link>
            </div>
          </aside>

          <div className="min-w-0 p-5 sm:p-7">
            <div className="flex flex-col gap-2 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-gold-500">Prioridades do dia</p><h2 className="mt-1 font-display text-2xl capitalize text-slate-950">{selectedDateLabel}</h2></div>
              <p className="text-sm font-semibold text-slate-500">{agendaTaskCount} tarefa{agendaTaskCount === 1 ? '' : 's'} de cobranca</p>
            </div>

            {agendaTaskCount === 0 && agenda.receipts.length === 0 ? (
              <div className="grid min-h-64 place-items-center py-10 text-center">
                <div><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-6 w-6" /></div><h3 className="mt-4 font-bold text-slate-800">Nenhuma pendencia para esta data</h3><p className="mt-1 text-sm text-slate-500">Selecione outro dia para consultar vencimentos e cobrancas.</p></div>
              </div>
            ) : (
              <div className="mt-5 max-h-[34rem] space-y-6 overflow-y-auto pr-1 [scrollbar-color:rgba(173,130,64,0.35)_transparent] [scrollbar-width:thin]">
                <AgendaInstallmentList title="Vencem nesta data" items={agenda.due} />
                <AgendaInstallmentList title="Cobrancas atrasadas" items={agenda.overdue} overdue />
                <AgendaReceiptList receipts={agenda.receipts} />
              </div>
            )}
          </div>
        </div>
      </section>

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
