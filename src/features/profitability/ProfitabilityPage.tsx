import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { differenceInMonths, parseISO } from 'date-fns';
import { Award, BatteryWarning, Search, Smartphone } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import { calculateProfitability } from '../../domain/finance';
import { listCashTransactions, listDevices, listInstallments } from '../../repositories/rentalRepository';
import { formatCurrency } from '../../utils/formatters';

export default function ProfitabilityPage() {
  const [search, setSearch] = useState('');
  const [depreciationRate, setDepreciationRate] = useState(15);
  const query = useQuery({
    queryKey: ['profitability'],
    queryFn: async () => {
      const [devices, installments, transactions] = await Promise.all([listDevices(), listInstallments(), listCashTransactions()]);
      return { devices, installments, transactions };
    },
  });

  const rows = useMemo(() => {
    if (!query.data) return [];
    const now = new Date();
    return query.data.devices.map((device) => {
      const deviceInstallments = query.data.installments.filter((item) => item.contract?.device_id === device.id);
      const rentalRevenue = deviceInstallments.reduce((sum, item) => sum + item.paid_amount, 0);
      const deviceTransactions = query.data.transactions.filter((item) => item.device_id === device.id && item.status === 'confirmed');
      const saleRevenue = deviceTransactions.filter((item) => item.direction === 'in' && item.kind === 'device_sale').reduce((sum, item) => sum + item.amount, 0);
      const otherExpenses = deviceTransactions.filter((item) => item.direction === 'out' && item.kind !== 'payment_reversal').reduce((sum, item) => sum + item.amount, 0);
      const months = Math.max(1, differenceInMonths(now, parseISO(device.purchase_date)));
      const monthlyNet = (rentalRevenue - otherExpenses) / months;
      const result = calculateProfitability({ rentalRevenue, saleRevenue, purchaseCost: device.purchase_amount, maintenanceCost: 0, mdmCost: 0, insuranceCost: 0, fees: 0, taxes: 0, otherExpenses, averageMonthlyNet: monthlyNet });
      const depreciation = Math.min(device.purchase_amount * 0.7, device.purchase_amount * (depreciationRate / 100) * (months / 12));

      let recommendation = 'Manter em locacao';
      let recommendationTone = 'bg-emerald-50 text-emerald-700';
      if (device.status === 'sold') { recommendation = 'Venda concluida'; recommendationTone = 'bg-slate-100 text-slate-600'; }
      else if (device.battery_health < 85) { recommendation = 'Manutencao ou venda'; recommendationTone = 'bg-amber-50 text-amber-700'; }
      else if (months >= 30 && result.roi < 0) { recommendation = 'Renovar a frota'; recommendationTone = 'bg-red-50 text-red-700'; }
      else if (result.roi >= 40) { recommendation = 'Alta rentabilidade'; recommendationTone = 'bg-cyan-50 text-cyan-700'; }

      return { device, rentalRevenue, saleRevenue, otherExpenses, months, depreciation, result, recommendation, recommendationTone };
    }).filter((row) => `${row.device.model} ${row.device.serial_number} ${row.device.color}`.toLowerCase().includes(search.toLowerCase()));
  }, [query.data, search, depreciationRate]);

  const totals = useMemo(() => rows.reduce((acc, row) => ({
    invested: acc.invested + row.device.purchase_amount,
    revenue: acc.revenue + row.result.revenue,
    expenses: acc.expenses + row.result.expenses,
    profit: acc.profit + row.result.netProfit,
    market: acc.market + row.device.market_value,
  }), { invested: 0, revenue: 0, expenses: 0, profit: 0, market: 0 }), [rows]);

  if (query.isLoading) return <LoadingState />;

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Economia por ativo" title="Rentabilidade da frota" action={<label className="form-field w-full sm:w-56"><span>Depreciacao estimada</span><select className="input" value={depreciationRate} onChange={(event) => setDepreciationRate(Number(event.target.value))}>{[10,15,20,25].map((rate) => <option key={rate} value={rate}>{rate}% ao ano</option>)}</select></label>} />
      {query.error && <ErrorState error={query.error} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ['Capital investido', totals.invested], ['Receitas realizadas', totals.revenue], ['Despesas + compra', totals.expenses], ['Lucro operacional', totals.profit], ['Valor da frota', totals.market],
        ].map(([label, value], index) => <article key={String(label)} className={index === 3 ? 'panel-dark p-5' : 'metric-card'}><p className={`text-[10px] font-extrabold uppercase tracking-wider ${index === 3 ? 'text-cyan-300' : 'text-slate-400'}`}>{label}</p><p className="mt-2 text-xl font-extrabold">{formatCurrency(Number(value))}</p>{index === 3 && <p className="mt-2 text-xs text-slate-400">ROI {totals.invested > 0 ? ((totals.profit / totals.invested) * 100).toFixed(2) : '0.00'}%</p>}</article>)}
      </div>

      <div className="panel p-3"><div className="relative"><Search className="input-icon" /><input className="input border-0 bg-slate-50 pl-11" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por modelo, cor ou serie" /></div></div>

      {rows.length === 0 ? <EmptyState title="Sem dados de rentabilidade" description="Cadastre aparelhos e registre pagamentos para iniciar a analise." /> : (
        <div className="grid gap-5 xl:grid-cols-2">
          {rows.map((row) => (
            <article key={row.device.id} className="panel p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-cyan-300"><Smartphone className="h-5 w-5" /></div><div><h2 className="font-bold text-slate-950">{row.device.model}</h2><p className="mt-0.5 font-mono text-[10px] text-slate-400">SN {row.device.serial_number} · {row.months} meses</p></div></div><span className={`status-pill ${row.recommendationTone}`}>{row.recommendation}</span></div>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-400">Alugueis</p><p className="mt-1 text-sm font-extrabold text-emerald-700">{formatCurrency(row.rentalRevenue)}</p></div>
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-400">Despesas</p><p className="mt-1 text-sm font-extrabold text-red-700">{formatCurrency(row.otherExpenses)}</p></div>
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-400">Lucro</p><p className="mt-1 text-sm font-extrabold text-slate-900">{formatCurrency(row.result.netProfit)}</p></div>
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-400">ROI real</p><p className="mt-1 text-sm font-extrabold text-cyan-700">{row.result.roi.toFixed(2)}%</p></div>
              </div>
              <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-xs sm:grid-cols-3"><div><p className="text-slate-400">Payback estimado</p><p className="mt-1 font-bold text-slate-800">{row.result.paybackMonths ? `${row.result.paybackMonths} meses` : 'Sem fluxo positivo'}</p></div><div><p className="text-slate-400">Depreciacao estimada</p><p className="mt-1 font-bold text-slate-800">{formatCurrency(row.depreciation)}</p></div><div><p className="text-slate-400">Mercado atual</p><p className="mt-1 font-bold text-slate-800">{formatCurrency(row.device.market_value)}</p></div></div>
              {row.device.battery_health < 85 ? <p className="mt-4 flex items-center gap-2 text-xs font-bold text-amber-700"><BatteryWarning className="h-4 w-4" />Bateria em {row.device.battery_health}% reduz a atratividade.</p> : <p className="mt-4 flex items-center gap-2 text-xs font-bold text-emerald-700"><Award className="h-4 w-4" />Ativo apto para operacao.</p>}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
