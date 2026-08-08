import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  CalendarCheck2,
  ChevronDown,
  CircleDollarSign,
  Download,
  FileSpreadsheet,
  LockKeyhole,
  PackageCheck,
  ReceiptText,
  RotateCcw,
  Scale,
  Smartphone,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import type { ProfessionalFinanceSummary, ProfessionalMonthMetrics } from '../../domain/professionalFinance';
import { formatCurrency, formatMonthLabel, formatPercentage } from '../../utils/formatters';

type FinancialExecutivePanelProps = {
  summary: ProfessionalFinanceSummary;
  years: number[];
  selectedMonth: string;
  currentMonth: string;
  canClose: boolean;
  actionPending: boolean;
  onYearChange: (year: number) => void;
  onMonthChange: (month: string) => void;
  onCloseMonth: (month: ProfessionalMonthMetrics) => void;
  onReopenMonth: (month: ProfessionalMonthMetrics) => void;
  onAnnualReport: () => void;
  onMonthlyReport: (month: ProfessionalMonthMetrics) => void;
  onCsvExport: () => void;
};

const shortMonth = (month: string) => new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' })
  .format(new Date(`${month}-01T12:00:00`))
  .replace('.', '')
  .toUpperCase();

function CashFlowChart({ month }: { month: ProfessionalMonthMetrics }) {
  const values = [
    { label: 'Entradas', value: month.cashEntries, color: 'bg-emerald-500' },
    { label: 'Previsao', value: month.forecastReceivables, color: 'bg-blue-500' },
    { label: 'Saidas', value: month.cashOutflows, color: 'bg-red-500' },
    { label: 'Resultado', value: month.operationalResult, color: 'bg-gold-400' },
  ];
  const maximum = Math.max(...values.map((item) => Math.abs(item.value)), 1);

  return (
    <div className="finance-chart">
      <div className="finance-chart-grid">
        {values.map((item) => (
          <div key={item.label} className="flex min-w-0 flex-col items-center justify-end gap-2">
            <span className="max-w-full truncate text-[9px] font-extrabold text-slate-600">{formatCurrency(item.value)}</span>
            <div className={`w-full max-w-14 rounded-t-xl ${item.color}`} style={{ height: `${Math.max(8, (Math.abs(item.value) / maximum) * 100)}%` }} />
            <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FinancialExecutivePanel({
  summary,
  years,
  selectedMonth,
  currentMonth,
  canClose,
  actionPending,
  onYearChange,
  onMonthChange,
  onCloseMonth,
  onReopenMonth,
  onAnnualReport,
  onMonthlyReport,
  onCsvExport,
}: FinancialExecutivePanelProps) {
  const currentYear = Number(currentMonth.slice(0, 4));
  const currentMonthNumber = Number(currentMonth.slice(5, 7));
  const visibleMonths = summary.months.filter((month) => (
    summary.selectedYear < currentYear
    || (summary.selectedYear === currentYear && Number(month.month.slice(5, 7)) <= currentMonthNumber)
  ));
  const selected = summary.months.find((month) => month.month === selectedMonth) ?? visibleMonths[visibleMonths.length - 1];
  const monthRoi = summary.capitalInRentedFleet > 0 && selected
    ? (selected.operationalResult / summary.capitalInRentedFleet) * 100
    : 0;
  const canCloseSelected = Boolean(selected && selected.month <= currentMonth);

  return (
    <div className="space-y-6">
      <section className="finance-hero">
        <div className="relative z-10 max-w-2xl">
          <p className="finance-kicker">Saldo consolidado em caixa</p>
          <p className={`mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl ${summary.currentCash >= 0 ? 'text-gold-200' : 'text-red-300'}`}>{formatCurrency(summary.currentCash)}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] font-extrabold uppercase tracking-[0.16em]">
            <span className="inline-flex items-center gap-2 text-emerald-300"><Activity className="h-3.5 w-3.5" />Operacao ativa</span>
            <span className="h-1 w-1 rounded-full bg-white/30" />
            <span className="text-slate-300">Receita operacional {summary.selectedYear}: {formatCurrency(summary.annualRevenue)}</span>
          </div>
        </div>
        <div className="relative z-10 flex w-full flex-col gap-3 lg:w-auto lg:min-w-[350px]">
          <label className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-slate-400">Ano do relatorio
            <select className="finance-select mt-2" value={summary.selectedYear} onChange={(event) => onYearChange(Number(event.target.value))}>
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <button className="finance-action" type="button" onClick={onAnnualReport}><Download className="h-4 w-4" />Relatorio anual</button>
            <button className="finance-action finance-action-muted" type="button" onClick={onCsvExport}><FileSpreadsheet className="h-4 w-4" />Exportar CSV</button>
          </div>
        </div>
      </section>

      <div className="finance-metrics-scroll">
        {[
          { label: 'Contas a receber', value: summary.accountsReceivable, icon: WalletCards, tone: 'text-gold-600', detail: `${formatCurrency(summary.overdueReceivables)} em atraso` },
          { label: 'Capital em locacao', value: summary.capitalInRentedFleet, icon: Smartphone, tone: 'text-blue-700', detail: 'Custo da frota alugada' },
          { label: 'Compras no ano', value: summary.annualInventoryPurchases, icon: PackageCheck, tone: 'text-slate-700', detail: 'Investimento em estoque' },
          { label: 'Vendas diretas', value: summary.annualSalesRevenue, icon: CircleDollarSign, tone: 'text-emerald-700', detail: `Margem ${formatCurrency(summary.annualSalesMargin)}` },
          { label: 'Aportes', value: summary.annualContributions, icon: ArrowDownToLine, tone: 'text-cyan-700', detail: 'Fora do faturamento' },
          { label: 'Despesas operacionais', value: summary.annualOperatingExpenses, icon: ReceiptText, tone: 'text-red-700', detail: 'Fretes, taxas e operacao' },
          { label: 'Retiradas', value: summary.annualWithdrawals, icon: ArrowUpFromLine, tone: 'text-orange-700', detail: 'Fora do resultado operacional' },
        ].map((metric) => (
          <article key={metric.label} className="finance-metric-card">
            <metric.icon className={`h-4 w-4 ${metric.tone}`} />
            <p className="mt-5 text-[9px] font-extrabold uppercase tracking-[0.14em] text-slate-400">{metric.label}</p>
            <p className="mt-2 text-lg font-extrabold text-slate-950">{formatCurrency(metric.value)}</p>
            <p className="mt-1 text-[10px] text-slate-400">{metric.detail}</p>
          </article>
        ))}
      </div>

      <section className="finance-profit-strip">
        <div><p className="finance-kicker text-gold-500">Resumo de rentabilidade</p><p className="mt-1 text-xs text-slate-500">Indicadores operacionais sem misturar aportes ou compras de estoque</p></div>
        <div className="finance-profit-stat"><span>Media mensal</span><strong>{formatCurrency(summary.averageMonthlyOperatingResult)}</strong></div>
        <div className="finance-profit-stat border-emerald-200"><span>Melhor resultado</span><strong className="text-emerald-700">{formatCurrency(summary.recordOperatingResult)}</strong><small>{summary.recordMonth ? formatMonthLabel(summary.recordMonth) : '-'}</small></div>
        <div className="finance-profit-stat border-blue-200"><span>ROI anual</span><strong className={summary.annualRoi >= 0 ? 'text-blue-700' : 'text-red-700'}>{formatPercentage(summary.annualRoi)}</strong></div>
      </section>

      <section className="panel overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-slate-200/80 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div><p className="finance-kicker text-gold-600">Historico detalhado</p><h2 className="mt-1 font-display text-2xl text-slate-950">Desempenho mensal</h2></div>
          <BarChart3 className="h-5 w-5 text-gold-500" />
        </div>

        <div className="divide-y divide-slate-100">
          {visibleMonths.map((month) => {
            const isSelected = selected?.month === month.month;
            return (
              <div key={month.month}>
                <button className={`finance-month-row ${isSelected ? 'is-selected' : ''}`} type="button" onClick={() => onMonthChange(month.month)}>
                  <strong>{shortMonth(month.month)}</strong>
                  <span><small>Entradas</small><b className="text-emerald-700">{formatCurrency(month.cashEntries)}</b></span>
                  <span><small>Saidas</small><b className="text-red-700">{formatCurrency(month.cashOutflows)}</b></span>
                  <span><small>Resultado de caixa</small><b className={month.netCashFlow >= 0 ? 'text-emerald-700' : 'text-red-700'}>{formatCurrency(month.netCashFlow)}</b></span>
                  <span><small>Resultado operacional</small><b className={month.operationalResult >= 0 ? 'text-gold-600' : 'text-red-700'}>{formatCurrency(month.operationalResult)}</b></span>
                  <span className={`finance-month-status ${month.closingStatus === 'closed' ? 'is-closed' : ''}`}>{month.closingStatus === 'closed' ? 'Fechado' : month.closingStatus === 'reopened' ? 'Reaberto' : 'Em aberto'}</span>
                  <ChevronDown className={`h-4 w-4 text-slate-400 transition ${isSelected ? 'rotate-180' : ''}`} />
                </button>

                {isSelected && (
                  <div className="finance-month-detail">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2"><CalendarCheck2 className="h-4 w-4 text-gold-600" /><span className="text-xs font-extrabold uppercase tracking-wider text-slate-700">Competencia {month.month}</span></div>
                      <div className="flex flex-wrap gap-2">
                        <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" type="button" onClick={() => onMonthlyReport(month)}><Download className="h-3.5 w-3.5" />PDF do mes</button>
                        {canClose && canCloseSelected && month.closingStatus !== 'closed' && <button className="btn-primary min-h-9 px-3 py-1.5 text-xs" disabled={actionPending} type="button" onClick={() => onCloseMonth(month)}><LockKeyhole className="h-3.5 w-3.5" />Fechar mes</button>}
                        {canClose && month.closingStatus === 'closed' && <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" disabled={actionPending} type="button" onClick={() => onReopenMonth(month)}><RotateCcw className="h-3.5 w-3.5" />Reabrir</button>}
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        ['Entradas do mes', month.cashEntries, 'text-emerald-700'],
                        ['Saidas do mes', month.cashOutflows, 'text-red-700'],
                        ['Previsao de recebimentos', month.forecastReceivables, 'text-blue-700'],
                        ['Saldo final', month.closingBalance, month.closingBalance >= 0 ? 'text-slate-950' : 'text-red-700'],
                      ].map(([label, value, tone]) => <div key={String(label)} className="finance-detail-metric"><span>{label}</span><strong className={String(tone)}>{formatCurrency(Number(value))}</strong></div>)}
                    </div>

                    <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1fr_1.15fr]">
                      <article className="finance-breakdown finance-breakdown-in">
                        <h3><ArrowDownToLine className="h-4 w-4" />Composicao das entradas</h3>
                        {[['Locacoes', month.rentalIncome], ['Caucoes', month.depositIncome], ['Vendas diretas', month.salesIncome], ['Aportes', month.capitalAdded], ['Outras entradas', month.otherIncome]].map(([label, value]) => <p key={String(label)}><span>{label}</span><strong>{formatCurrency(Number(value))}</strong></p>)}
                      </article>
                      <article className="finance-breakdown finance-breakdown-out">
                        <h3><ArrowUpFromLine className="h-4 w-4" />Composicao das saidas</h3>
                        {[['Compras de estoque', month.inventoryPurchases], ['Despesas operacionais', month.operatingExpenses], ['Estornos', month.reversals], ['Retiradas', month.ownerWithdrawals]].map(([label, value]) => <p key={String(label)}><span>{label}</span><strong>{formatCurrency(Number(value))}</strong></p>)}
                      </article>
                      <CashFlowChart month={month} />
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      <div className="finance-result-card"><TrendingUp className="h-4 w-4 text-gold-600" /><span>Resultado operacional</span><strong className={month.operationalResult >= 0 ? 'text-emerald-700' : 'text-red-700'}>{formatCurrency(month.operationalResult)}</strong></div>
                      <div className="finance-result-card"><Scale className="h-4 w-4 text-blue-700" /><span>ROI da frota no mes</span><strong>{formatPercentage(monthRoi)}</strong></div>
                      <div className="finance-result-card"><CircleDollarSign className="h-4 w-4 text-slate-700" /><span>Margem nas vendas</span><strong>{formatCurrency(month.salesMargin)}</strong></div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
