import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { differenceInMonths, parseISO } from 'date-fns';
import {
  Award,
  BatteryWarning,
  ChevronDown,
  CircleDollarSign,
  Landmark,
  ReceiptText,
  Scale,
  Search,
  Smartphone,
  TrendingUp,
} from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import { canonicalizeCashTransactions } from '../../domain/cashTransactions';
import {
  calculateAssetMetrics,
  calculateFleetMetrics,
  calculateProjectedResidualValue,
  isOperationalExpense,
  isReceivedDeposit,
} from '../../domain/fleetFinance';
import { listCashTransactions, listDevices, listDeviceSales, listInstallments } from '../../repositories/rentalRepository';
import { formatCurrency, formatMonths, formatPercentage } from '../../utils/formatters';

export default function ProfitabilityPage() {
  const [search, setSearch] = useState('');
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
    const operationalTransactions = canonicalTransactions.filter(isOperationalExpense);
    const depositTransactions = canonicalTransactions.filter(isReceivedDeposit);

    return query.data.devices.map((device) => {
      const deviceInstallments = query.data.installments.filter((installment) => (
        installment.contract?.device_id === device.id
        && installment.contract.status !== 'cancelled'
      ));
      const rentalRevenue = deviceInstallments.reduce((sum, installment) => sum + installment.paid_amount, 0);
      const deviceContractIds = new Set(deviceInstallments.map((installment) => installment.contract_id));
      const depositRevenue = depositTransactions
        .filter((transaction) => transaction.device_id === device.id
          || (transaction.contract_id !== null && deviceContractIds.has(transaction.contract_id)))
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      const directSale = query.data.sales.find((sale) => sale.device_id === device.id && sale.paid_in_full);
      const saleRevenue = directSale?.sale_amount ?? 0;
      const revenueReceived = rentalRevenue + depositRevenue + saleRevenue;
      const deviceOperationalTransactions = operationalTransactions.filter((transaction) => transaction.device_id === device.id);
      const operationalExpenses = deviceOperationalTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
      const months = Math.max(1, differenceInMonths(now, parseISO(device.purchase_date)));
      const averageMonthlyRevenue = (rentalRevenue + depositRevenue) / months;
      const currentMarketValue = directSale || device.status === 'sold' ? 0 : device.market_value;
      const metrics = calculateAssetMetrics({
        revenueReceived,
        operationalExpenses,
        purchaseValue: device.purchase_amount,
        currentMarketValue,
        averageMonthlyRevenue,
      });
      const projectedResidualValue = calculateProjectedResidualValue(
        device.purchase_amount,
        depreciationRate,
        months,
      );
      const maintenanceEvents = deviceOperationalTransactions.filter((transaction) => transaction.kind === 'maintenance').length;
      const depreciationRatio = metrics.purchaseValue > 0
        ? metrics.accumulatedDepreciation / metrics.purchaseValue
        : 0;

      let recommendation = 'Em maturacao';
      let recommendationTone = 'bg-slate-100 text-slate-600';
      if (device.status === 'sold') {
        recommendation = 'Venda concluida';
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
        recommendation = 'Manutencao ou venda';
        recommendationTone = 'bg-amber-50 text-amber-700';
      } else if (months >= 3 && averageMonthlyRevenue <= 0) {
        recommendation = 'Baixa utilizacao';
        recommendationTone = 'bg-amber-50 text-amber-700';
      } else if (metrics.operationalRoi >= 40) {
        recommendation = 'Alta rentabilidade';
        recommendationTone = 'bg-cyan-50 text-cyan-700';
      } else if (metrics.operationalProfit > 0) {
        recommendation = 'Manter em locacao';
        recommendationTone = 'bg-emerald-50 text-emerald-700';
      }

      return {
        device,
        months,
        metrics,
        projectedResidualValue,
        rentalRevenue,
        depositRevenue,
        saleRevenue,
        directSale,
        recommendation,
        recommendationTone,
      };
    });
  }, [canonicalTransactions, query.data, depreciationRate]);

  const filteredRows = useMemo(() => rows.filter((row) => (
    `${row.device.model} ${row.device.serial_number} ${row.device.color}`
      .toLowerCase()
      .includes(search.toLowerCase())
  )), [rows, search]);

  const totals = useMemo(() => {
    if (!query.data) return calculateFleetMetrics({
      capitalInvested: 0,
      revenuesReceived: 0,
      operationalExpenses: 0,
      currentFleetValue: 0,
    });

    const validInstallments = query.data.installments.filter((installment) => (
      installment.contract?.status !== 'cancelled'
    ));
    const directSalesRevenue = query.data.sales
      .filter((sale) => sale.paid_in_full)
      .reduce((sum, sale) => sum + sale.sale_amount, 0);
    const depositRevenue = canonicalTransactions
      .filter(isReceivedDeposit)
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    return calculateFleetMetrics({
      capitalInvested: query.data.devices.reduce((sum, device) => sum + device.purchase_amount, 0),
      revenuesReceived: validInstallments.reduce((sum, installment) => sum + installment.paid_amount, 0)
        + depositRevenue
        + directSalesRevenue,
      operationalExpenses: canonicalTransactions
        .filter(isOperationalExpense)
        .reduce((sum, transaction) => sum + transaction.amount, 0),
      currentFleetValue: query.data.devices
        .filter((device) => device.status !== 'sold')
        .reduce((sum, device) => sum + device.market_value, 0),
    });
  }, [canonicalTransactions, query.data]);

  if (query.isLoading) return <LoadingState />;

  const operationalProfitPositive = totals.operationalProfit >= 0;
  const consolidatedPositive = totals.consolidatedResult >= 0;
  const variationPositive = totals.assetVariation >= 0;
  const allocatedOperationalExpenses = rows.reduce((sum, row) => sum + row.metrics.operationalExpenses, 0);
  const unallocatedOperationalExpenses = Math.max(0, totals.operationalExpenses - allocatedOperationalExpenses);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Economia por ativo"
        title="Rentabilidade da frota"
        action={(
          <label className="form-field w-full sm:w-56">
            <span>Depreciacao estimada</span>
            <select className="input" value={depreciationRate} onChange={(event) => setDepreciationRate(Number(event.target.value))}>
              {[10, 15, 20, 25].map((rate) => <option key={rate} value={rate}>{rate}% ao ano</option>)}
            </select>
          </label>
        )}
      />
      {query.error && <ErrorState error={query.error} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <article className="profitability-summary-card profitability-summary-card-capital">
          <Landmark className="profitability-summary-icon" />
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Capital investido</p>
          <p className="mt-2 text-xl font-extrabold text-slate-950">{formatCurrency(totals.capitalInvested)}</p>
          <p className="mt-2 text-xs text-slate-500">Ativos patrimoniais, nao despesas</p>
        </article>
        <article className="profitability-summary-card profitability-summary-card-revenue">
          <CircleDollarSign className="profitability-summary-icon" />
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">Receitas recebidas</p>
          <p className="mt-2 text-xl font-extrabold text-emerald-700">{formatCurrency(totals.revenuesReceived)}</p>
          <p className="mt-2 text-xs text-emerald-700/70">Locacoes e vendas efetivamente recebidas</p>
        </article>
        <article className="profitability-summary-card profitability-summary-card-expenses">
          <ReceiptText className="profitability-summary-icon" />
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-amber-700">Despesas operacionais</p>
          <p className="mt-2 text-xl font-extrabold text-amber-800">{formatCurrency(totals.operationalExpenses)}</p>
          <p className="mt-2 text-xs text-amber-700/70">{unallocatedOperationalExpenses > 0 ? `${formatCurrency(unallocatedOperationalExpenses)} sem aparelho vinculado` : 'Saidas reais vinculadas a operacao'}</p>
        </article>
        <article className={`profitability-summary-card ${operationalProfitPositive ? 'profitability-summary-card-profit' : 'profitability-summary-card-negative'}`}>
          <TrendingUp className="profitability-summary-icon" />
          <p className={`text-[10px] font-extrabold uppercase tracking-wider ${operationalProfitPositive ? 'text-emerald-700' : 'text-red-700'}`}>Lucro operacional</p>
          <p className={`mt-2 text-xl font-extrabold ${operationalProfitPositive ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(totals.operationalProfit)}</p>
          <p className="mt-2 text-xs text-slate-500">ROI operacional {formatPercentage(totals.operationalRoi)}</p>
        </article>
        <article className="profitability-summary-card profitability-summary-card-fleet">
          <Smartphone className="profitability-summary-icon" />
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Valor atual da frota</p>
          <p className="mt-2 text-xl font-extrabold text-slate-950">{formatCurrency(totals.currentFleetValue)}</p>
          <p className={`mt-2 text-xs font-semibold ${variationPositive ? 'text-emerald-700' : 'text-red-700'}`}>Variacao patrimonial {formatCurrency(totals.assetVariation)}</p>
        </article>
        <article className={`profitability-summary-card profitability-summary-card-consolidated ${consolidatedPositive ? 'ring-emerald-400/25' : 'ring-red-400/25'}`}>
          <Scale className="profitability-summary-icon" />
          <p className={`text-[10px] font-extrabold uppercase tracking-wider ${consolidatedPositive ? 'text-emerald-300' : 'text-red-300'}`}>Resultado consolidado</p>
          <p className={`mt-2 text-2xl font-extrabold ${consolidatedPositive ? 'text-emerald-200' : 'text-red-200'}`}>{formatCurrency(totals.consolidatedResult)}</p>
          <p className="mt-2 text-xs text-slate-400">ROI consolidado {formatPercentage(totals.consolidatedRoi)}</p>
        </article>
      </div>

      <details className="finance-drawer">
        <summary className="finance-drawer-summary">
          <div className="finance-drawer-title">
            <span className="finance-drawer-icon finance-drawer-icon-blue"><Scale className="h-5 w-5" /></span>
            <span><small>Guia rapido</small><strong>Como interpretar os indicadores</strong></span>
          </div>
          <div className="finance-drawer-preview">
            <span>Lucro operacional <strong>Receitas - despesas</strong></span>
            <span>Resultado consolidado <strong>Inclui o valor da frota</strong></span>
          </div>
          <ChevronDown className="finance-drawer-chevron" />
        </summary>
        <div className="finance-drawer-content grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[
            ['Capital investido', 'Soma dos valores pagos na compra dos aparelhos. E patrimonio, nao despesa operacional.'],
            ['Receitas recebidas', 'Pagamentos de locacao e vendas diretas que ja foram efetivamente recebidos.'],
            ['Despesas operacionais', 'Fretes, manutencoes, taxas e custos da operacao. Compras de estoque ficam fora.'],
            ['Lucro operacional', 'Receitas recebidas menos despesas operacionais. Mede o desempenho real da operacao.'],
            ['Valor atual da frota', 'Soma do valor de mercado dos aparelhos que ainda pertencem a frota.'],
            ['Resultado consolidado', 'Lucro operacional somado a variacao patrimonial da frota, incluindo vendas ja realizadas.'],
          ].map(([title, description]) => (
            <article key={title} className="profitability-guide-card"><strong>{title}</strong><p>{description}</p></article>
          ))}
        </div>
      </details>

      <div className="panel p-3">
        <div className="relative">
          <Search className="input-icon" />
          <input className="input border-0 bg-slate-50 pl-11" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por modelo, cor ou serie" />
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <EmptyState title="Sem dados de rentabilidade" description="Cadastre aparelhos e registre pagamentos para iniciar a analise." />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {filteredRows.map((row) => {
            const profitPositive = row.metrics.operationalProfit >= 0;
            return (
              <article key={row.device.id} className="panel p-5 sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-950 text-cyan-300"><Smartphone className="h-5 w-5" /></div>
                    <div className="min-w-0"><h2 className="truncate font-bold text-slate-950">{row.device.model}</h2><p className="mt-0.5 font-mono text-[10px] text-slate-400">SN {row.device.serial_number} - {row.months} meses</p></div>
                  </div>
                  <span className={`status-pill self-start ${row.recommendationTone}`}>{row.recommendation}</span>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl bg-emerald-50/70 p-3"><p className="text-[10px] text-emerald-700">Receita recebida</p><p className="mt-1 text-sm font-extrabold text-emerald-700">{formatCurrency(row.metrics.revenueReceived)}</p><p className="mt-1 text-[9px] text-emerald-700/70">Locacao {formatCurrency(row.rentalRevenue)}{row.depositRevenue > 0 ? ` + caucao ${formatCurrency(row.depositRevenue)}` : ''}{row.saleRevenue > 0 ? ` + venda ${formatCurrency(row.saleRevenue)}` : ''}</p></div>
                  <div className="rounded-xl bg-amber-50/70 p-3"><p className="text-[10px] text-amber-700">Despesas operacionais</p><p className="mt-1 text-sm font-extrabold text-amber-800">{formatCurrency(row.metrics.operationalExpenses)}</p></div>
                  <div className={`rounded-xl p-3 ${profitPositive ? 'bg-emerald-50/70' : 'bg-red-50/70'}`}><p className={`text-[10px] ${profitPositive ? 'text-emerald-700' : 'text-red-700'}`}>Lucro operacional</p><p className={`mt-1 text-sm font-extrabold ${profitPositive ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(row.metrics.operationalProfit)}</p></div>
                  <div className="rounded-xl bg-cyan-50/70 p-3"><p className="text-[10px] text-cyan-700">ROI operacional</p><p className="mt-1 text-sm font-extrabold text-cyan-700">{formatPercentage(row.metrics.operationalRoi)}</p></div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-xs sm:grid-cols-4">
                  <div><p className="text-slate-400">Valor de compra</p><p className="mt-1 font-bold text-slate-800">{formatCurrency(row.metrics.purchaseValue)}</p></div>
                  <div><p className="text-slate-400">{row.directSale ? 'Valor realizado na venda' : 'Valor de mercado atual'}</p><p className="mt-1 font-bold text-slate-800">{formatCurrency(row.directSale?.sale_amount ?? row.metrics.currentMarketValue)}</p></div>
                  <div><p className="text-slate-400">{row.directSale ? 'Custo baixado na venda' : 'Depreciacao acumulada'}</p><p className="mt-1 font-bold text-slate-800">{formatCurrency(row.directSale ? row.metrics.purchaseValue : row.metrics.accumulatedDepreciation)}</p></div>
                  <div><p className="text-slate-400">Tempo restante para recuperar o investimento</p><p className="mt-1 font-bold text-slate-800">{row.directSale ? 'Venda encerrada' : formatMonths(row.metrics.remainingPaybackMonths)}</p></div>
                </div>

                <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 text-xs sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-slate-500">Resultado economico <strong className={row.metrics.economicResult >= 0 ? 'text-emerald-700' : 'text-red-700'}>{formatCurrency(row.metrics.economicResult)}</strong></p>
                  <p className="text-slate-500">{row.directSale ? 'Venda efetivada' : `Residual projetado a ${depreciationRate}% a.a.`} <strong className="text-slate-800">{formatCurrency(row.directSale?.sale_amount ?? row.projectedResidualValue)}</strong></p>
                </div>

                {row.device.battery_health < 85 ? (
                  <p className="mt-4 flex items-center gap-2 text-xs font-bold text-amber-700"><BatteryWarning className="h-4 w-4" />Bateria em {row.device.battery_health}% reduz a atratividade.</p>
                ) : (
                  <p className="mt-4 flex items-center gap-2 text-xs font-bold text-emerald-700"><Award className="h-4 w-4" />Analise operacional sem incluir a compra como despesa.</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
