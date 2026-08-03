import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { CalendarDays, FilePlus2, PencilLine, Save, Search, ShieldCheck, Smartphone, UserRound } from 'lucide-react';
import { useAuth } from '../../AuthGate';
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader } from '../../components/ui';
import { calculateContractPlan, generateInstallmentSchedule } from '../../domain/finance';
import { createContract, listClients, listContracts, listDevices, updateContract } from '../../repositories/rentalRepository';
import { contractSchema, type ContractFormData } from '../../schemas/forms';
import type { Contract, ContractStatus } from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';

const statusLabel: Record<ContractStatus, string> = { draft: 'Rascunho', active: 'Ativo', overdue: 'Inadimplente', completed: 'Finalizado', cancelled: 'Cancelado', renegotiated: 'Renegociado' };
const statusTone: Record<ContractStatus, string> = { draft: 'bg-slate-100 text-slate-600', active: 'bg-emerald-50 text-emerald-700', overdue: 'bg-red-50 text-red-700', completed: 'bg-cyan-50 text-cyan-700', cancelled: 'bg-slate-100 text-slate-500', renegotiated: 'bg-amber-50 text-amber-700' };

const defaultValues: ContractFormData = {
  client_id: '', device_id: '', start_date: new Date().toISOString().slice(0, 10), due_day: 10,
  term_months: 12, monthly_amount: 350, deposit_amount: 500, late_fee_percent: 2,
  daily_interest_percent: 0.033, purchase_option: false, purchase_option_amount: 0,
};

const contractFormValues = (contract: Contract): ContractFormData => ({
  client_id: contract.client_id,
  device_id: contract.device_id,
  start_date: contract.start_date.slice(0, 10),
  due_day: contract.due_day,
  term_months: contract.term_months,
  monthly_amount: contract.monthly_amount,
  deposit_amount: contract.deposit_amount,
  late_fee_percent: contract.late_fee_percent,
  daily_interest_percent: contract.daily_interest_percent,
  purchase_option: contract.purchase_option,
  purchase_option_amount: contract.purchase_option_amount ?? 0,
});

export default function ContractsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | ContractStatus>('all');
  const contractsQuery = useQuery({ queryKey: ['contracts'], queryFn: listContracts });
  const clientsQuery = useQuery({ queryKey: ['clients'], queryFn: listClients });
  const devicesQuery = useQuery({ queryKey: ['devices'], queryFn: listDevices });
  const form = useForm<ContractFormData>({ resolver: zodResolver(contractSchema), defaultValues });
  const watched = form.watch();

  const contractPlan = useMemo(() => calculateContractPlan({
    remainingInstallments: Math.min(Number(watched.term_months || 0), 60),
    monthlyAmount: Number(watched.monthly_amount || 0),
    depositAmount: Number(watched.deposit_amount || 0),
  }), [watched.deposit_amount, watched.monthly_amount, watched.term_months]);

  const preview = useMemo(() => generateInstallmentSchedule({
    startDate: watched.start_date || defaultValues.start_date,
    dueDay: Number(watched.due_day || 1),
    termMonths: Math.min(Number(watched.term_months || 0), 60),
    monthlyAmount: Number(watched.monthly_amount || 0),
  }).slice(0, 4).map((item) => ({
    ...item,
    installmentNumber: item.installmentNumber + (Number(watched.deposit_amount || 0) > 0 ? 1 : 0),
  })), [watched.start_date, watched.due_day, watched.term_months, watched.monthly_amount, watched.deposit_amount]);

  const mutation = useMutation({
    mutationFn: ({ values, contractId }: { values: ContractFormData; contractId?: string }) => contractId
      ? updateContract(contractId, values)
      : createContract(profile.organization_id, values),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contracts'] }),
        queryClient.invalidateQueries({ queryKey: ['devices'] }),
        queryClient.invalidateQueries({ queryKey: ['installments'] }),
        queryClient.invalidateQueries({ queryKey: ['rental-overview'] }),
      ]);
      setModalOpen(false);
      setEditingContract(null);
      form.reset(defaultValues);
    },
  });

  const openCreateModal = () => {
    mutation.reset();
    setEditingContract(null);
    form.reset(defaultValues);
    setModalOpen(true);
  };

  const openEditModal = (contract: Contract) => {
    mutation.reset();
    setEditingContract(contract);
    form.reset(contractFormValues(contract));
    setModalOpen(true);
  };

  const closeModal = () => {
    if (mutation.isPending) return;
    setModalOpen(false);
    setEditingContract(null);
    form.reset(defaultValues);
    mutation.reset();
  };

  const filtered = useMemo(() => (contractsQuery.data ?? []).filter((contract) => {
    const term = search.toLowerCase();
    return (status === 'all' || contract.status === status)
      && `${contract.contract_number} ${contract.client?.full_name ?? ''} ${contract.device?.model ?? ''} ${contract.device?.serial_number ?? ''}`.toLowerCase().includes(term);
  }), [contractsQuery.data, search, status]);

  if (contractsQuery.isLoading || clientsQuery.isLoading || devicesQuery.isLoading) return <LoadingState />;
  const canManage = ['admin', 'manager', 'operator'].includes(profile.role);
  const availableDevices = (devicesQuery.data ?? []).filter((device) => device.status === 'available');
  const formDevices = (devicesQuery.data ?? []).filter((device) => device.status === 'available' || device.id === editingContract?.device_id);
  const canCreate = canManage && (clientsQuery.data?.length ?? 0) > 0 && availableDevices.length > 0;

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Locacao e ciclo contratual" title="Contratos" action={<button className="btn-primary" disabled={!canCreate} type="button" onClick={openCreateModal}><FilePlus2 className="h-4 w-4" />Novo contrato</button>} />
      {(contractsQuery.error || clientsQuery.error || devicesQuery.error) && <ErrorState error={contractsQuery.error ?? clientsQuery.error ?? devicesQuery.error} />}
      {!canCreate && canManage && <div className="alert border-amber-200 bg-amber-50 text-amber-800">Cadastre um cliente e mantenha ao menos um aparelho disponivel para abrir um contrato.</div>}

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
                <div><p className="text-slate-400">{contract.deposit_as_first_installment ? 'Caucao paga' : 'Caucao'}</p><p className="mt-1 font-extrabold text-slate-900">{formatCurrency(contract.deposit_amount)}</p></div>
                <div><p className="text-slate-400">Inicio</p><p className="mt-1 font-bold text-slate-700">{formatDate(contract.start_date)}</p></div>
                <div><p className="text-slate-400">Parcelas</p><p className="mt-1 font-bold text-slate-700">{contract.deposit_as_first_installment ? `1 + ${contract.term_months}` : contract.term_months}</p></div>
              </div>
              {canManage && ['active', 'overdue'].includes(contract.status) && <button className="btn-secondary mt-5 w-full" type="button" onClick={() => openEditModal(contract)}><PencilLine className="h-4 w-4" />Editar contrato</button>}
            </article>
          ))}
        </div>
      )}

      {modalOpen && (
        <Modal title={editingContract ? 'Editar contrato' : 'Novo contrato de locacao'} description={editingContract ? editingContract.contract_number : 'O contrato, a reserva do aparelho e as parcelas serao criados na mesma transacao.'} onClose={closeModal}>
          <form className="space-y-6" onSubmit={form.handleSubmit((values) => mutation.mutate({ values, contractId: editingContract?.id }))}>
            {mutation.error && <ErrorState error={mutation.error} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="form-field"><span>Cliente *</span><select className="input" {...form.register('client_id')}><option value="">Selecione</option>{clientsQuery.data?.map((client) => <option key={client.id} value={client.id}>{client.full_name} · {client.cpf}</option>)}</select></label>
              <label className="form-field"><span>iPhone *</span><select className="input" {...form.register('device_id')}><option value="">Selecione</option>{formDevices.map((device) => <option key={device.id} value={device.id}>{device.model} · SN {device.serial_number}</option>)}</select></label>
              <label className="form-field"><span>Data de inicio *</span><input className="input" type="date" {...form.register('start_date')} /></label>
              <label className="form-field"><span>Mensalidades restantes (1 a 60)</span><input className="input" type="number" min="1" max="60" step="1" inputMode="numeric" {...form.register('term_months', { valueAsNumber: true })} />{form.formState.errors.term_months && <small className="text-red-600">Informe de 1 a 60 mensalidades restantes.</small>}</label>
              <label className="form-field"><span>Mensalidade</span><input className="input" type="number" step="0.01" {...form.register('monthly_amount', { valueAsNumber: true })} /></label>
              <label className="form-field"><span>Caucao paga na entrada</span><input className="input" type="number" min="0" step="0.01" readOnly={Boolean(editingContract?.deposit_as_first_installment)} {...form.register('deposit_amount', { valueAsNumber: true })} />{editingContract?.deposit_as_first_installment && <small>Valor protegido porque ja entrou no caixa.</small>}</label>
              <label className="form-field"><span>Dia do vencimento (1 a 31)</span><input className="input" type="number" min="1" max="31" {...form.register('due_day', { valueAsNumber: true })} /></label>
              <label className="form-field"><span>Multa por atraso (%)</span><input className="input" type="number" step="0.01" {...form.register('late_fee_percent', { valueAsNumber: true })} /></label>
              <label className="form-field"><span>Juros diarios (%)</span><input className="input" type="number" step="0.001" {...form.register('daily_interest_percent', { valueAsNumber: true })} /></label>
              <label className="form-field"><span>Valor da opcao de compra</span><input className="input" type="number" step="0.01" disabled={!watched.purchase_option} {...form.register('purchase_option_amount', { valueAsNumber: true })} /></label>
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-700 sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-cyan-700" {...form.register('purchase_option')} />Permitir opcao de compra</label>
            </div>

            <div className="grid gap-3 rounded-2xl bg-slate-950 p-4 text-white sm:grid-cols-3">
              <div><p className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">Entrada no caixa</p><p className="mt-1 font-extrabold">{formatCurrency(Number(watched.deposit_amount || 0))}</p></div>
              <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Mensalidades restantes</p><p className="mt-1 font-extrabold">{contractPlan.remainingInstallments} x {formatCurrency(Number(watched.monthly_amount || 0))}</p></div>
              <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total a receber ({contractPlan.totalInstallments} parcelas)</p><p className="mt-1 font-extrabold text-cyan-300">{formatCurrency(contractPlan.totalReceivable)}</p></div>
            </div>

            <div className="rounded-2xl border border-cyan-200 bg-cyan-50/60 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-cyan-900"><CalendarDays className="h-4 w-4" />Previa das proximas mensalidades</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-4">{preview.map((item) => <div key={item.installmentNumber} className="rounded-xl bg-white p-3 text-xs"><p className="text-slate-400">Parcela {item.installmentNumber}</p><p className="mt-1 font-bold text-slate-800">{formatDate(item.dueDate)}</p><p className="mt-1 text-cyan-700">{formatCurrency(item.amount)}</p></div>)}</div>
              <p className="mt-3 flex items-center gap-2 text-[11px] text-cyan-800"><ShieldCheck className="h-3.5 w-3.5" />A caucao sera a parcela 1 paga; as demais vencem a partir do proximo mes.</p>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 pt-5"><button className="btn-secondary" disabled={mutation.isPending} type="button" onClick={closeModal}>Cancelar</button><button className="btn-primary" disabled={mutation.isPending} type="submit">{editingContract ? <Save className="h-4 w-4" /> : <FilePlus2 className="h-4 w-4" />}{mutation.isPending ? 'Salvando...' : editingContract ? 'Salvar alteracoes' : 'Gerar contrato e parcelas'}</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
