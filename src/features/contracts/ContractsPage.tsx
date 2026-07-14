import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { CalendarDays, FilePlus2, Search, ShieldCheck, Smartphone, UserRound } from 'lucide-react';
import { useAuth } from '../../AuthGate';
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader } from '../../components/ui';
import { generateInstallmentSchedule } from '../../domain/finance';
import { createContract, listClients, listContracts, listDevices } from '../../repositories/rentalRepository';
import { contractSchema, type ContractFormData } from '../../schemas/forms';
import type { ContractStatus } from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';

const statusLabel: Record<ContractStatus, string> = { draft: 'Rascunho', active: 'Ativo', overdue: 'Inadimplente', completed: 'Finalizado', cancelled: 'Cancelado', renegotiated: 'Renegociado' };
const statusTone: Record<ContractStatus, string> = { draft: 'bg-slate-100 text-slate-600', active: 'bg-emerald-50 text-emerald-700', overdue: 'bg-red-50 text-red-700', completed: 'bg-cyan-50 text-cyan-700', cancelled: 'bg-slate-100 text-slate-500', renegotiated: 'bg-amber-50 text-amber-700' };

const defaultValues: ContractFormData = {
  client_id: '', device_id: '', start_date: new Date().toISOString().slice(0, 10), due_day: 10,
  term_months: 12, monthly_amount: 350, deposit_amount: 500, late_fee_percent: 2,
  daily_interest_percent: 0.033, purchase_option: false, purchase_option_amount: 0,
};

export default function ContractsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | ContractStatus>('all');
  const contractsQuery = useQuery({ queryKey: ['contracts'], queryFn: listContracts });
  const clientsQuery = useQuery({ queryKey: ['clients'], queryFn: listClients });
  const devicesQuery = useQuery({ queryKey: ['devices'], queryFn: listDevices });
  const form = useForm<ContractFormData>({ resolver: zodResolver(contractSchema), defaultValues });
  const watched = form.watch();

  const preview = useMemo(() => generateInstallmentSchedule({
    startDate: watched.start_date || defaultValues.start_date,
    dueDay: Number(watched.due_day || 1),
    termMonths: Math.min(Number(watched.term_months || 0), 60),
    monthlyAmount: Number(watched.monthly_amount || 0),
  }).slice(0, 4), [watched.start_date, watched.due_day, watched.term_months, watched.monthly_amount]);

  const mutation = useMutation({
    mutationFn: (values: ContractFormData) => createContract(profile.organization_id, values),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contracts'] }),
        queryClient.invalidateQueries({ queryKey: ['devices'] }),
        queryClient.invalidateQueries({ queryKey: ['installments'] }),
        queryClient.invalidateQueries({ queryKey: ['rental-overview'] }),
      ]);
      setModalOpen(false);
      form.reset(defaultValues);
    },
  });

  const filtered = useMemo(() => (contractsQuery.data ?? []).filter((contract) => {
    const term = search.toLowerCase();
    return (status === 'all' || contract.status === status)
      && `${contract.contract_number} ${contract.client?.full_name ?? ''} ${contract.device?.model ?? ''} ${contract.device?.serial_number ?? ''}`.toLowerCase().includes(term);
  }), [contractsQuery.data, search, status]);

  if (contractsQuery.isLoading || clientsQuery.isLoading || devicesQuery.isLoading) return <LoadingState />;
  const availableDevices = (devicesQuery.data ?? []).filter((device) => device.status === 'available');
  const canCreate = profile.role !== 'viewer' && (clientsQuery.data?.length ?? 0) > 0 && availableDevices.length > 0;

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Locacao e ciclo contratual" title="Contratos" description="Vinculo atomico entre cliente, iPhone, caucao e cronograma de parcelas com vencimentos seguros ate o dia 31." action={<button className="btn-primary" disabled={!canCreate} type="button" onClick={() => setModalOpen(true)}><FilePlus2 className="h-4 w-4" />Novo contrato</button>} />
      {(contractsQuery.error || clientsQuery.error || devicesQuery.error) && <ErrorState error={contractsQuery.error ?? clientsQuery.error ?? devicesQuery.error} />}
      {!canCreate && profile.role !== 'viewer' && <div className="alert border-amber-200 bg-amber-50 text-amber-800">Cadastre um cliente e mantenha ao menos um aparelho disponivel para abrir um contrato.</div>}

      <div className="panel flex flex-col gap-3 p-3 md:flex-row">
        <div className="relative flex-1"><Search className="input-icon" /><input className="input border-0 bg-slate-50 pl-11" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cliente, contrato, modelo ou serie" /></div>
        <select className="input md:w-48" value={status} onChange={(event) => setStatus(event.target.value as 'all' | ContractStatus)}><option value="all">Todos os status</option>{Object.entries(statusLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      </div>

      {filtered.length === 0 ? <EmptyState title="Nenhum contrato encontrado" description="Os contratos ativos aparecerao aqui com cliente, aparelho e condicoes financeiras." /> : (
        <div className="grid gap-5 xl:grid-cols-2">
          {filtered.map((contract) => (
            <article key={contract.id} className="panel p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">Contrato</p><h2 className="mt-1 font-mono text-sm font-bold text-slate-900">{contract.contract_number}</h2></div>
                <span className={`status-pill ${statusTone[contract.status]}`}>{statusLabel[contract.status]}</span>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4"><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400"><UserRound className="h-3.5 w-3.5" />Locatario</p><p className="mt-2 font-bold text-slate-900">{contract.client?.full_name}</p><p className="mt-1 text-xs text-slate-500">CPF {contract.client?.cpf}</p></div>
                <div className="rounded-2xl bg-slate-950 p-4 text-white"><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-cyan-300"><Smartphone className="h-3.5 w-3.5" />Aparelho</p><p className="mt-2 font-bold">{contract.device?.model}</p><p className="mt-1 text-xs text-slate-400">SN {contract.device?.serial_number}</p></div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-4 text-xs sm:grid-cols-4">
                <div><p className="text-slate-400">Mensalidade</p><p className="mt-1 font-extrabold text-slate-900">{formatCurrency(contract.monthly_amount)}</p></div>
                <div><p className="text-slate-400">Caucao</p><p className="mt-1 font-extrabold text-slate-900">{formatCurrency(contract.deposit_amount)}</p></div>
                <div><p className="text-slate-400">Inicio</p><p className="mt-1 font-bold text-slate-700">{formatDate(contract.start_date)}</p></div>
                <div><p className="text-slate-400">Prazo</p><p className="mt-1 font-bold text-slate-700">{contract.term_months} meses</p></div>
              </div>
            </article>
          ))}
        </div>
      )}

      {modalOpen && (
        <Modal title="Novo contrato de locacao" description="O contrato, a reserva do aparelho e as parcelas serao criados na mesma transacao." onClose={() => setModalOpen(false)}>
          <form className="space-y-6" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
            {mutation.error && <ErrorState error={mutation.error} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="form-field"><span>Cliente *</span><select className="input" {...form.register('client_id')}><option value="">Selecione</option>{clientsQuery.data?.map((client) => <option key={client.id} value={client.id}>{client.full_name} · {client.cpf}</option>)}</select></label>
              <label className="form-field"><span>iPhone disponivel *</span><select className="input" {...form.register('device_id')}><option value="">Selecione</option>{availableDevices.map((device) => <option key={device.id} value={device.id}>{device.model} · SN {device.serial_number}</option>)}</select></label>
              <label className="form-field"><span>Data de inicio *</span><input className="input" type="date" {...form.register('start_date')} /></label>
              <label className="form-field"><span>Prazo em meses</span><select className="input" {...form.register('term_months', { valueAsNumber: true })}>{[3,6,12,18,24,36].map((month) => <option key={month} value={month}>{month} meses</option>)}</select></label>
              <label className="form-field"><span>Mensalidade</span><input className="input" type="number" step="0.01" {...form.register('monthly_amount', { valueAsNumber: true })} /></label>
              <label className="form-field"><span>Caucao</span><input className="input" type="number" step="0.01" {...form.register('deposit_amount', { valueAsNumber: true })} /></label>
              <label className="form-field"><span>Dia do vencimento (1 a 31)</span><input className="input" type="number" min="1" max="31" {...form.register('due_day', { valueAsNumber: true })} /></label>
              <label className="form-field"><span>Multa por atraso (%)</span><input className="input" type="number" step="0.01" {...form.register('late_fee_percent', { valueAsNumber: true })} /></label>
              <label className="form-field"><span>Juros diarios (%)</span><input className="input" type="number" step="0.001" {...form.register('daily_interest_percent', { valueAsNumber: true })} /></label>
              <label className="form-field"><span>Valor da opcao de compra</span><input className="input" type="number" step="0.01" disabled={!watched.purchase_option} {...form.register('purchase_option_amount', { valueAsNumber: true })} /></label>
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-700 sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-cyan-700" {...form.register('purchase_option')} />Permitir opcao de compra</label>
            </div>

            <div className="rounded-2xl border border-cyan-200 bg-cyan-50/60 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-cyan-900"><CalendarDays className="h-4 w-4" />Previa das primeiras parcelas</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-4">{preview.map((item) => <div key={item.installmentNumber} className="rounded-xl bg-white p-3 text-xs"><p className="text-slate-400">Parcela {item.installmentNumber}</p><p className="mt-1 font-bold text-slate-800">{formatDate(item.dueDate)}</p><p className="mt-1 text-cyan-700">{formatCurrency(item.amount)}</p></div>)}</div>
              <p className="mt-3 flex items-center gap-2 text-[11px] text-cyan-800"><ShieldCheck className="h-3.5 w-3.5" />Dias 29, 30 e 31 sao ajustados ao ultimo dia valido de cada mes.</p>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 pt-5"><button className="btn-secondary" type="button" onClick={() => setModalOpen(false)}>Cancelar</button><button className="btn-primary" disabled={mutation.isPending} type="submit">{mutation.isPending ? 'Gerando...' : 'Gerar contrato e parcelas'}</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
