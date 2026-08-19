import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { differenceInMonths, parseISO } from 'date-fns';
import {
  Award,
  BatteryWarning,
  Gauge,
  Landmark,
  ReceiptText,
  Search,
  ShieldCheck,
  Smartphone,
  Target,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import { canonicalizeCashTransactions } from '../../domain/cashTransactions';
import {
  calculateAssetMetrics,
  calculateFleetMetrics,
  calculateProjectedResidualValue,
  isOperationalExpense,
  isOperationalIncome,
  isPurchaseEntryReversal,
  isReceivedPurchaseEntry,
} from '../../domain/fleetFinance';
import { listCashTransactions, listDevices, listDeviceSales, listInstallments } from '../../repositories/rentalRepository';
import type { CashTransaction } from '../../types';
import { formatCurrency, formatMonths, formatPercentage } from '../../utils/formatters';

type ProfitabilitySort = 'roi' | 'recovery' | 'result' | 'model';

const transactionBelongsToDevice = (
  transaction: CashTransaction,
  deviceId: string,
  contractIds: Set<string>,
) => transaction.device_id === deviceId
  || (transaction.contract_id !== null && contractIds.has(transaction.contract_id));

export default function ProfitabilityPage() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ProfitabilitySort>('recovery');
  const [depreciationRate, setDepreciationRate] = useState(15);
  const query = useQuery({
    queryKey: ['profitability'],
    queryFn: async () => {
      const [devices, installments, transactions, sales] = await Promise.all([
        listDevices(),
        listInstallments(),
        listCashTransactions(),
        listDeviceSales(),
      ]);
      return { devices, installments, transactions, sales };
    },
  });

  const canonicalTransactions = useMemo(
    () => canonicalizeCashTransactions(query.data?.transactions ?? []),
    [query.data?.transactions],
  );

  const rows = useMemo(() => {
    if (!query.data) return [];
    const now = new Date();
    const operationalExpenses = canonicalTransactions.filter(isOperationalExpense);
    const operationalIncome = canonicalTransactions.filter(isOperationalIncome);
    const receivedPurchaseEntries = canonicalTransactions.filter(isReceivedPurchaseEntry);
    const reversedPurchaseEntries = canonicalTransactions.filter(isPurchaseEntryReversal);

    return query.data.devices.map((device) => {
      const deviceInstallments = query.data.installments.filter((installment) => (
        installment.contract?.device_id === device.id
        && installment.contract.status !== 'cancelled'
      ));
      const contractIds = new Set(deviceInstallments.map((installment) => installment.contract_id));
      const belongsToDevice = (transaction: CashTransaction) => transactionBelongsToDevice(
        transaction,
        device.id,
        contractIds,
      );
      const rentalRevenue = deviceInstallments.reduce((sum, installment) => sum + installment.paid_amount, 0);
      const purchaseEntriesReceived = receivedPurchaseEntries.filter(belongsToDevice)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      const purchaseEntriesReversed = reversedPurchaseEntries.filter(belongsToDevice)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      const purchaseEntryRevenue = Math.max(0, purchaseEntriesReceived - purchaseEntriesReversed);
      const otherRevenue = operationalIncome.filter(belongsToDevice)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      const directSale = query.data.sales.find((sale) => sale.device_id === device.id && sale.paid_in_full);
      const saleRevenue = directSale?.sale_amount ?? 0;
      const deviceOperationalTransactions = operationalExpenses.filter(belongsToDevice);
      const deviceOperationalExpenses = deviceOperationalTransactions
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      const months = Math.max(1, differenceInMonths(now, parseISO(device.purchase_date)));
      const averageMonthlyRevenue = Math.max(
        0,
        (rentalRevenue + purchaseEntryRevenue + otherRevenue - deviceOperationalExpenses) / months,
      );
      const currentMarketValue = directSale || device.status === 'sold' ? 0 : device.market_value;
      const metrics = calculateAssetMetrics({
        rentalRevenue,
        saleRevenue,
        otherRevenue,
        purchaseEntryRevenue,
        operationalExpenses: deviceOperationalExpenses,
        purchaseValue: device.purchase_amount,
        currentMarketValue,
        averageMonthlyRevenue,
      });
      const capitalRecovered = Math.max(0, metrics.purchaseValue - metrics.remainingToRecover);
      const recoveryPercent = metrics.purchaseValue > 0
        ? Math.min(100, (capitalRecovered / metrics.purchaseValue) * 100)
        : 0;
      const projectedResidualValue = calculateProjectedResidualValue(
        device.purchase_amount,
        depreciationRate,
        months,
      );
      const maintenanceEvents = deviceOperationalTransactions
        .filter((transaction) => transaction.kind === 'maintenance').length;
      const depreciationRatio = metrics.purchaseValue > 0
        ? metrics.accumulatedDepreciation / metrics.purchaseValue
        : 0;

      let recommendation = 'Em maturacao';
      let recommendationTone = 'bg-slate-100 text-slate-600';
      if (device.status === 'sold') {
        recommendation = metrics.economicResult >= 0 ? 'Venda com ganho' : 'Venda com perda';
        recommendationTone = metrics.economicResult >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700';
      } else if (device.status === 'retired') {
        recommendation = 'Retirado da frota';
        recommendationTone = 'bg-red-50 text-red-700';
      } else if (device.status === 'maintenance') {
        recommendation = 'Em manutencao';
        recommendationTone = 'bg-amber-50 text-amber-700';
      } else if (
        device.battery_health < 85
        || maintenanceEvents >= 2
        || depreciationRatio >= 0.5
        || (months >= 6 && metrics.operationalProfit < 0)
      ) {
        recommendation = 'Revisar permanencia';
        recommendationTone = 'bg-amber-50 text-amber-700';
      } else if (metrics.remainingToRecover <= 0) {
        recommendation = 'Investimento recuperado';
        recommendationTone = 'bg-cyan-50 text-cyan-700';
      } else if (metrics.operationalRoi >= 40) {
        recommendation = 'Alta rentabilidade';
        recommendationTone = 'bg-emerald-50 text-emerald-700';
      } else if (months >= 3 && averageMonthlyRevenue <= 0) {
        recommendation = 'Baixa utilizacao';
        recommendationTone = 'bg-amber-50 text-amber-700';
      }

      return {
        device,
        months,
        metrics,
        projectedResidualValue,
        directSale,
        purchaseEntriesReceived,
        purchaseEntriesReversed,
        capitalRecovered,
        recoveryPercent,
        recommendation,
        recommendationTone,
      };
    });
  }, [canonicalTransactions, depreciationRate, query.data]);

  const totals = useMemo(() => {
    if (!query.data) return calculateFleetMetrics({
      capitalInvested: 0,
      rentalRevenue: 0,
      salesRevenue: 0,
      salesCost: 0,
      operationalExpenses: 0,
      currentFleetValue: 0,
    });

    const receivedPurchaseEntries = canonicalTransactions.filter(isReceivedPurchaseEntry)
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const reversedPurchaseEntries = canonicalTransactions.filter(isPurchaseEntryReversal)
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    return calculateFleetMetrics({
      capitalInvested: rows.reduce((sum, row) => sum + row.metrics.purchaseValue, 0),
      rentalRevenue: rows.reduce((sum, row) => sum + row.metrics.rentalRevenue, 0),
      salesRevenue: rows.reduce((sum, row) => sum + row.metrics.saleRevenue, 0),
      salesCost: rows.reduce((sum, row) => sum + (row.directSale ? row.metrics.purchaseValue : 0), 0),
      otherRevenue: rows.reduce((sum, row) => sum + row.metrics.otherRevenue, 0),
      purchaseEntryRevenue: Math.max(0, receivedPurchaseEntries - reversedPurchaseEntries),
      operationalExpenses: canonicalTransactions.filter(isOperationalExpense)
        .reduce((sum, transaction) => sum + transaction.amount, 0),
      currentFleetValue: query.data.devices
        .filter((device) => !['sold', 'retired'].includes(device.status))
        .reduce((sum, device) => sum + device.market_value, 0),
    });
  }, [canonicalTransactions, query.data, rows]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const result = rows.filter((row) => (
      `${row.device.model} ${row.device.serial_number} ${row.device.color}`
        .toLowerCase()
        .includes(normalizedSearch)
    ));
    return result.sort((left, right) => {
      if (sort === 'roi') return right.metrics.operationalRoi - left.metrics.operationalRoi;
      if (sort === 'result') return right.metrics.economicResult - left.metrics.economicResult;
      if (sort === 'model') return left.device.model.localeCompare(right.device.model);
      return right.metrics.remainingToRecover - left.metrics.remainingToRecover;
    });
  }, [rows, search, sort]);

  if (query.isLoading) return <LoadingState />;

  const recoveredAssets = rows.filter((row) => row.metrics.remainingToRecover <= 0).length;
  const bestAsset = rows.reduce<(typeof rows)[number] | null>((best, row) => (
    !best || row.metrics.operationalRoi > best.metrics.operationalRoi ? row : best
  ), null);
  const recoveryRate = totals.capitalInvested > 0
    ? (totals.capitalRecovered / totals.capitalInvested) * 100
    : 0;
  const allocatedOperationalExpenses = rows.reduce(
    (sum, row) => sum + row.metrics.operationalExpenses,
    0,
  );
  const unallocatedOperationalExpenses = Math.max(
    0,
    totals.operationalExpenses - allocatedOperationalExpenses,
  );

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Decisao por aparelho"
        title="Rentabilidade da frota"
        action={(
          <label className="form-field w-full sm:w-56">
            <span>Depreciacao projetada</span>
            <select className="input" value={depreciationRate} onChange={(event) => setDepreciationRate(Number(event.target.value))}>
              {[10, 15, 20, 25].map((rate) => <option key={rate} value={rate}>{rate}% ao ano</option>)}
            </select>
          </label>
        )}
      />
      {query.error && <ErrorState error={query.error} />}

      <section className="overflow-hidden rounded-[1.75rem] border border-cyan-300/15 bg-slate-950 p-6 text-white shadow-[0_24px_60px_rgba(5,30,59,.18)] sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-end">
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-[0.24em] text-cyan-300">Recuperacao do capital</p>
            <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
              <p className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">{formatPercentage(recoveryRate)}</p>
              <p className="pb-1 text-xs text-slate-400">{formatCurrency(totals.capitalRecovered)} de {formatCurrency(totals.capitalInvested)}</p>
            </div>
            <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-700" style={{ width: `${Math.min(100, Math.max(0, recoveryRate))}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-4"><Trophy className="h-4 w-4 text-gold-200" /><p className="mt-3 text-[9px] uppercase tracking-wider text-slate-400">Melhor ROI</p><p className="mt-1 text-sm font-extrabold">{bestAsset ? formatPercentage(bestAsset.metrics.operationalRoi) : '-'}</p><p className="mt-1 truncate text-[9px] text-slate-500">{bestAsset?.device.model ?? 'Sem dados'}</p></div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-4"><Award className="h-4 w-4 text-emerald-300" /><p className="mt-3 text-[9px] uppercase tracking-wider text-slate-400">Ja se pagaram</p><p className="mt-1 text-sm font-extrabold">{recoveredAssets} aparelho{recoveredAssets === 1 ? '' : 's'}</p></div>
            <div className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.055] p-4 sm:col-span-1"><ShieldCheck className="h-4 w-4 text-cyan-300" /><p className="mt-3 text-[9px] uppercase tracking-wider text-slate-400">Entradas de compra</p><p className="mt-1 text-sm font-extrabold">{formatCurrency(totals.purchaseEntryRevenue)}</p></div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="profitability-summary-card profitability-summary-card-capital">
          <Landmark className="profitability-summary-icon" />
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-blue-700">Capital monitorado</p>
          <p className="mt-2 text-xl font-extrabold text-slate-950">{formatCurrency(totals.capitalInvested)}</p>
          <p className="mt-2 text-xs text-slate-500">Custo historico dos aparelhos</p>
        </article>
        <article className="profitability-summary-card profitability-summary-card-revenue">
          <Gauge className="profitability-summary-icon" />
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">Capital recuperado</p>
          <p className="mt-2 text-xl font-extrabold text-emerald-700">{formatCurrency(totals.capitalRecovered)}</p>
          <p className="mt-2 text-xs text-emerald-700/70">Locacoes, entradas de compra e vendas, liquidas das despesas</p>
        </article>
        <article className="profitability-summary-card profitability-summary-card-expenses">
          <Target className="profitability-summary-icon" />
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-amber-700">Capital a recuperar</p>
          <p className="mt-2 text-xl font-extrabold text-amber-800">{formatCurrency(totals.capitalToRecover)}</p>
          <p className="mt-2 text-xs text-amber-700/70">Meta restante da carteira</p>
        </article>
        <article className={`profitability-summary-card ${totals.economicResult >= 0 ? 'profitability-summary-card-profit' : 'profitability-summary-card-negative'}`}>
          <TrendingUp className="profitability-summary-icon" />
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-600">Resultado economico</p>
          <p className={`mt-2 text-xl font-extrabold ${totals.economicResult >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(totals.economicResult)}</p>
          <p className="mt-2 text-xs text-slate-500">Inclui o valor atual da frota</p>
        </article>
      </div>

      {unallocatedOperationalExpenses > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">
          <ReceiptText className="mt-0.5 h-4 w-4 shrink-0" />
          <p><strong>{formatCurrency(unallocatedOperationalExpenses)} em despesas sem aparelho vinculado.</strong> O valor reduz o resultado total da frota, mas nao foi distribuido entre os cards individuais.</p>
        </div>
      )}

      <div className="panel grid gap-3 p-3 md:grid-cols-[1fr_220px]">
        <div className="relative">
          <Search className="input-icon" />
          <input className="input border-0 bg-slate-50 pl-11" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Modelo, cor ou numero de serie" />
        </div>
        <select className="input" value={sort} onChange={(event) => setSort(event.target.value as ProfitabilitySort)}>
          <option value="recovery">Maior valor a recuperar</option>
          <option value="roi">Maior ROI</option>
          <option value="result">Melhor resultado</option>
          <option value="model">Modelo</option>
        </select>
      </div>

      {filteredRows.length === 0 ? (
        <EmptyState title="Sem dados de rentabilidade" description="Cadastre aparelhos e registre pagamentos para iniciar a analise." />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {filteredRows.map((row) => {
            const profitPositive = row.metrics.operationalProfit >= 0;
            return (
              <article key={row.device.id} className="panel overflow-hidden p-0">
                <div className="p-5 sm:p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-950 text-cyan-300"><Smartphone className="h-5 w-5" /></div>
                      <div className="min-w-0"><h2 className="truncate font-bold text-slate-950">{row.device.model}</h2><p className="mt-0.5 font-mono text-[10px] text-slate-400">SN {row.device.serial_number} - {row.months} meses</p></div>
                    </div>
                    <span className={`status-pill self-start ${row.recommendationTone}`}>{row.recommendation}</span>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-xl bg-emerald-50/70 p-3"><p className="text-[10px] text-emerald-700">Receita de locacao</p><p className="mt-1 text-sm font-extrabold text-emerald-700">{formatCurrency(row.metrics.rentalRevenue)}</p></div>
                    <div className="rounded-xl bg-blue-50/70 p-3"><p className="text-[10px] text-blue-700">{row.directSale ? 'Margem da venda' : 'Outras receitas'}</p><p className={`mt-1 text-sm font-extrabold ${row.directSale && row.metrics.saleMargin < 0 ? 'text-red-700' : 'text-blue-700'}`}>{formatCurrency(row.directSale ? row.metrics.saleMargin : row.metrics.otherRevenue)}</p></div>
                    <div className="rounded-xl bg-amber-50/70 p-3"><p className="text-[10px] text-amber-700">Despesas vinculadas</p><p className="mt-1 text-sm font-extrabold text-amber-800">{formatCurrency(row.metrics.operationalExpenses)}</p></div>
                    <div className={`rounded-xl p-3 ${profitPositive ? 'bg-cyan-50/70' : 'bg-red-50/70'}`}><p className={`text-[10px] ${profitPositive ? 'text-cyan-700' : 'text-red-700'}`}>Resultado operacional</p><p className={`mt-1 text-sm font-extrabold ${profitPositive ? 'text-cyan-700' : 'text-red-700'}`}>{formatCurrency(row.metrics.operationalProfit)}</p></div>
                  </div>

                  <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                    <div className="flex items-end justify-between gap-4"><div><p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Recuperacao do investimento</p><p className="mt-1 text-lg font-extrabold text-slate-950">{formatPercentage(row.recoveryPercent)}</p></div><div className="text-right"><p className="text-[10px] text-slate-400">Falta recuperar</p><p className="mt-1 font-extrabold text-amber-700">{formatCurrency(row.metrics.remainingToRecover)}</p></div></div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${row.recoveryPercent}%` }} /></div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-xs sm:grid-cols-4">
                    <div><p className="text-slate-400">Valor de compra</p><p className="mt-1 font-bold text-slate-800">{formatCurrency(row.metrics.purchaseValue)}</p></div>
                    <div><p className="text-slate-400">{row.directSale ? 'Valor da venda' : 'Mercado atual'}</p><p className="mt-1 font-bold text-slate-800">{formatCurrency(row.directSale?.sale_amount ?? row.metrics.currentMarketValue)}</p></div>
                    <div><p className="text-slate-400">Resultado economico</p><p className={`mt-1 font-bold ${row.metrics.economicResult >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(row.metrics.economicResult)}</p></div>
                    <div><p className="text-slate-400">ROI operacional</p><p className="mt-1 font-bold text-blue-700">{formatPercentage(row.metrics.operationalRoi)}</p></div>
                  </div>

                  {row.metrics.purchaseEntryRevenue > 0 && <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-gold-300/30 bg-amber-50/70 px-4 py-3 text-xs"><span className="flex items-center gap-2 font-bold text-amber-900"><ShieldCheck className="h-4 w-4" />Entrada para compra futura</span><strong className="text-amber-800">{formatCurrency(row.metrics.purchaseEntryRevenue)}</strong></div>}

                  <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 text-xs sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-slate-500">{row.directSale ? 'Ciclo encerrado pela venda' : `Payback estimado ${formatMonths(row.metrics.remainingPaybackMonths)}`}</p>
                    <p className="text-slate-500">{row.directSale ? 'Valor realizado' : `Residual projetado a ${depreciationRate}% a.a.`} <strong className="text-slate-800">{formatCurrency(row.directSale?.sale_amount ?? row.projectedResidualValue)}</strong></p>
                  </div>

                  {row.device.battery_health < 85 ? (
                    <p className="mt-4 flex items-center gap-2 text-xs font-bold text-amber-700"><BatteryWarning className="h-4 w-4" />Bateria em {row.device.battery_health}% pode reduzir o valor de mercado.</p>
                  ) : (
                    <p className="mt-4 flex items-center gap-2 text-xs font-bold text-emerald-700"><ReceiptText className="h-4 w-4" />Compra tratada como ativo; a entrada de compra recupera o investimento.</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
