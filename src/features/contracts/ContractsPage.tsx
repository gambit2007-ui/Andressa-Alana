import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  CalendarDays, CheckCircle2, ChevronDown, Download, Eye, FileClock, FilePlus2,
  FileText, LoaderCircle, PencilLine, RefreshCw, Save, Search, Settings2, Share2,
  ShieldCheck, Smartphone, UserRound,
} from 'lucide-react';
import { useAuth } from '../../AuthGate';
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader } from '../../components/ui';
import { calculateContractPlan, dueDateForMonth, generateInstallmentSchedule } from '../../domain/finance';
import { generateInitialContractDocuments } from '../../domain/contractDocuments';
import {
  createContract,
  createContractDocumentSignedUrl,
  generateContractDocument,
  getOrganizationContractSettings,
  listClients,
  listContractDocuments,
  listContracts,
  listDevices,
  saveOrganizationContractSettings,
  updateContract,
} from '../../repositories/rentalRepository';
import {
  contractSchema,
  organizationContractSettingsSchema,
  type ContractFormData,
  type OrganizationContractSettingsFormData,
} from '../../schemas/forms';
import type {
  Contract,
  ContractDocument,
  ContractDocumentType,
  ContractStatus,
  DeliveryChecklist,
  DeliveryChecklistKey,
} from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';

const statusLabel: Record<ContractStatus, string> = { draft: 'Rascunho', active: 'Ativo', overdue: 'Inadimplente', completed: 'Finalizado', cancelled: 'Cancelado', renegotiated: 'Renegociado' };
const statusTone: Record<ContractStatus, string> = { draft: 'bg-slate-100 text-slate-600', active: 'bg-emerald-50 text-emerald-700', overdue: 'bg-red-50 text-red-700', completed: 'bg-cyan-50 text-cyan-700', cancelled: 'bg-slate-100 text-slate-500', renegotiated: 'bg-amber-50 text-amber-700' };

const checklistLabels: Record<DeliveryChecklistKey, string> = {
  screen: 'Tela', face_id: 'Face ID', cameras: 'Cameras', microphones: 'Microfones',
  speakers: 'Alto-falantes', buttons: 'Botoes', connectors: 'Conectores', housing: 'Carcaca',
  battery: 'Bateria', wifi: 'Wi-Fi', bluetooth: 'Bluetooth', mobile_data: 'Dados moveis',
  cable: 'Cabo', charger: 'Carregador', box: 'Caixa', case: 'Capinha', screen_protector: 'Pelicula',
};

const emptyChecklist: DeliveryChecklist = {
  screen: false, face_id: false, cameras: false, microphones: false, speakers: false,
  buttons: false, connectors: false, housing: false, battery: false, wifi: false,
  bluetooth: false, mobile_data: false, cable: false, charger: false, box: false,
  case: false, screen_protector: false, notes: '',
};

const today = new Date().toISOString().slice(0, 10);
const defaultValues: ContractFormData = {
  client_id: '', device_id: '', start_date: today, first_installment_date: dueDateForMonth(today, 1, 10),
  due_day: 10, term_months: 12, monthly_amount: 350, deposit_amount: 500,
  deposit_paid_at: today, deposit_payment_method: 'pix', indemnity_value: 0,
  late_fee_percent: 2, daily_interest_percent: 1.5,
  purchase_option: false, purchase_option_amount: 0, delivery_checklist: emptyChecklist,
};

const contractFormValues = (contract: Contract): ContractFormData => ({
  client_id: contract.client_id,
  device_id: contract.device_id,
  start_date: contract.start_date.slice(0, 10),
  first_installment_date: contract.first_installment_date?.slice(0, 10)
    ?? dueDateForMonth(contract.start_date.slice(0, 10), 1, contract.due_day),
  due_day: contract.due_day,
  term_months: contract.term_months,
  monthly_amount: contract.monthly_amount,
  deposit_amount: contract.deposit_amount,
  deposit_paid_at: contract.deposit_paid_at?.slice(0, 10) ?? contract.start_date.slice(0, 10),
  deposit_payment_method: contract.deposit_payment_method ?? 'other',
  indemnity_value: contract.indemnity_value ?? 0,
  late_fee_percent: contract.late_fee_percent,
  daily_interest_percent: contract.daily_interest_percent,
  purchase_option: contract.purchase_option,
  purchase_option_amount: contract.purchase_option_amount ?? 0,
  delivery_checklist: emptyChecklist,
});

const settingsValues = (settings: Awaited<ReturnType<typeof getOrganizationContractSettings>>): OrganizationContractSettingsFormData => ({
  legal_name: settings?.legal_name ?? '', tax_id: settings?.tax_id ?? '', address: settings?.address ?? '',
  phone: settings?.phone ?? '', email: settings?.email ?? '', city: settings?.city ?? '',
  default_venue: settings?.default_venue ?? '',
});

const documentTitle: Record<ContractDocumentType, string> = {
  rental_contract: 'Contrato de locacao', delivery_term: 'Termo de entrega',
};

export default function ContractsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [expandedContractId, setExpandedContractId] = useState<string | null>(null);
  const [regenerateTarget, setRegenerateTarget] = useState<{ contractId: string; type: ContractDocumentType } | null>(null);
  const [regenerationReason, setRegenerationReason] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | ContractStatus>('all');
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning'; message: string } | null>(null);
  const [creationStage, setCreationStage] = useState<string | null>(null);

  const contractsQuery = useQuery({ queryKey: ['contracts'], queryFn: listContracts });
  const clientsQuery = useQuery({ queryKey: ['clients'], queryFn: listClients });
  const devicesQuery = useQuery({ queryKey: ['devices'], queryFn: listDevices });
  const documentsQuery = useQuery({ queryKey: ['contract-documents'], queryFn: listContractDocuments });
  const settingsQuery = useQuery({ queryKey: ['contract-settings'], queryFn: getOrganizationContractSettings });
  const form = useForm<ContractFormData>({ resolver: zodResolver(contractSchema), defaultValues });
  const settingsForm = useForm<OrganizationContractSettingsFormData>({
    resolver: zodResolver(organizationContractSettingsSchema),
    defaultValues: settingsValues(null),
  });
  const watched = form.watch();

  useEffect(() => {
    if (!settingsOpen) return;
    settingsForm.reset(settingsValues(settingsQuery.data ?? null));
  }, [settingsForm, settingsOpen, settingsQuery.data]);

  useEffect(() => {
    if (editingContract || !watched.device_id) return;
    const device = devicesQuery.data?.find((item) => item.id === watched.device_id);
    if (device) form.setValue('indemnity_value', device.indemnity_value ?? device.market_value, { shouldValidate: true });
  }, [devicesQuery.data, editingContract, form, watched.device_id]);

  const contractPlan = useMemo(() => calculateContractPlan({
    monthlyInstallments: Math.min(Number(watched.term_months || 0), 60),
    monthlyAmount: Number(watched.monthly_amount || 0),
    depositAmount: Number(watched.deposit_amount || 0),
  }), [watched.deposit_amount, watched.monthly_amount, watched.term_months]);

  const preview = useMemo(() => generateInstallmentSchedule({
    firstInstallmentDate: watched.first_installment_date || defaultValues.first_installment_date,
    dueDay: Number(watched.due_day || 1),
    termMonths: Math.min(Number(watched.term_months || 0), 60),
    monthlyAmount: Number(watched.monthly_amount || 0),
  }), [watched.first_installment_date, watched.due_day, watched.term_months, watched.monthly_amount]);

  const missingRelatedData = useMemo(() => {
    const client = clientsQuery.data?.find((item) => item.id === watched.client_id);
    const device = devicesQuery.data?.find((item) => item.id === watched.device_id);
    const missing: string[] = [];
    if (client) {
      if (!client.rg) missing.push('RG do cliente');
      if (!client.address_line || !client.city || !client.state) missing.push('endereco completo do cliente');
      if (!client.birth_date) missing.push('data de nascimento do cliente');
    }
    if (device) {
      if (!device.indemnity_value && !device.market_value) missing.push('valor de indenizacao do aparelho');
      if (!device.accessories.length) missing.push('acessorios do aparelho');
    }
    return missing;
  }, [clientsQuery.data, devicesQuery.data, watched.client_id, watched.device_id]);

  const mutation = useMutation({
    mutationFn: async ({ values, contract }: { values: ContractFormData; contract?: Contract | null }) => {
      if (contract) {
        const contractId = await updateContract(contract.id, values, contract.deposit_as_first_installment);
        return { contractId, documentsOk: true, edited: true };
      }
      setCreationStage('Salvando contrato e mensalidades...');
      const contractId = await createContract(profile.organization_id, values);
      setCreationStage('Contrato salvo. Gerando documentos...');
      const generation = await generateInitialContractDocuments(contractId, generateContractDocument);
      return { contractId, documentsOk: generation.documentsOk, edited: false };
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contracts'] }),
        queryClient.invalidateQueries({ queryKey: ['contract-documents'] }),
        queryClient.invalidateQueries({ queryKey: ['devices'] }),
        queryClient.invalidateQueries({ queryKey: ['installments'] }),
        queryClient.invalidateQueries({ queryKey: ['payments'] }),
        queryClient.invalidateQueries({ queryKey: ['cash-transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['rental-overview'] }),
      ]);
      setNotice(result.edited
        ? { tone: 'success', message: 'Contrato atualizado com sucesso.' }
        : result.documentsOk
          ? { tone: 'success', message: 'Contrato e termo de entrega gerados com sucesso.' }
          : { tone: 'warning', message: 'Contrato salvo, mas nao foi possivel gerar um ou mais documentos. Use Regenerar.' });
      setExpandedContractId(result.contractId);
      setCreationStage(null);
      setModalOpen(false);
      setEditingContract(null);
      form.reset(defaultValues);
    },
    onError: () => setCreationStage(null),
  });

  const documentMutation = useMutation({
    mutationFn: ({ contractId, type, reason }: { contractId: string; type: ContractDocumentType; reason?: string }) => generateContractDocument(contractId, type, reason),
    onSuccess: async (document) => {
      await queryClient.invalidateQueries({ queryKey: ['contract-documents'] });
      setNotice({ tone: 'success', message: `${documentTitle[document.document_type]} gerado na versao ${document.version}.` });
      setRegenerateTarget(null);
      setRegenerationReason('');
    },
  });

  const settingsMutation = useMutation({
    mutationFn: (values: OrganizationContractSettingsFormData) => saveOrganizationContractSettings(profile.organization_id, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['contract-settings'] });
      setSettingsOpen(false);
      setNotice({ tone: 'success', message: 'Dados institucionais atualizados.' });
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

  const handleDocumentAction = async (document: ContractDocument, action: 'view' | 'download' | 'share') => {
    try {
      const url = await createContractDocumentSignedUrl(document, action === 'download');
      if (action === 'view') window.open(url, '_blank', 'noopener,noreferrer');
      if (action === 'download') {
        const anchor = window.document.createElement('a');
        anchor.href = url;
        anchor.download = document.file_name;
        anchor.click();
      }
      if (action === 'share') {
        if (navigator.share) await navigator.share({ title: documentTitle[document.document_type], url });
        else {
          await navigator.clipboard.writeText(url);
          setNotice({ tone: 'success', message: 'Link seguro copiado. Ele fica valido por 5 minutos.' });
        }
      }
    } catch (error) {
      setNotice({ tone: 'warning', message: error instanceof Error ? error.message : 'Nao foi possivel abrir o documento.' });
    }
  };

  const filtered = useMemo(() => (contractsQuery.data ?? []).filter((contract) => {
    const term = search.toLowerCase();
    return (status === 'all' || contract.status === status)
      && `${contract.contract_number} ${contract.client?.full_name ?? ''} ${contract.device?.model ?? ''} ${contract.device?.serial_number ?? ''}`.toLowerCase().includes(term);
  }), [contractsQuery.data, search, status]);

  if (contractsQuery.isLoading || clientsQuery.isLoading || devicesQuery.isLoading || documentsQuery.isLoading) return <LoadingState />;
  const canManage = ['admin', 'manager', 'operator'].includes(profile.role);
  const canManageSettings = ['admin', 'manager'].includes(profile.role);
  const availableDevices = (devicesQuery.data ?? []).filter((device) => device.status === 'available');
  const formDevices = (devicesQuery.data ?? []).filter((device) => device.status === 'available' || device.id === editingContract?.device_id);
  const canCreate = canManage && (clientsQuery.data?.length ?? 0) > 0 && availableDevices.length > 0;
  const institutionalDataIncomplete = !settingsQuery.data?.tax_id || !settingsQuery.data.address || !settingsQuery.data.phone;

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Locacao e ciclo contratual" title="Contratos" action={(
        <div className="flex flex-wrap gap-2">
          {canManageSettings && <button className="btn-secondary" type="button" onClick={() => setSettingsOpen(true)}><Settings2 className="h-4 w-4" />Dados do locador</button>}
          <button className="btn-primary" disabled={!canCreate} type="button" onClick={openCreateModal}><FilePlus2 className="h-4 w-4" />Novo contrato</button>
        </div>
      )} />
      {(contractsQuery.error || clientsQuery.error || devicesQuery.error || documentsQuery.error || settingsQuery.error) && <ErrorState error={contractsQuery.error ?? clientsQuery.error ?? devicesQuery.error ?? documentsQuery.error ?? settingsQuery.error} />}
      {notice && <div className={`alert ${notice.tone === 'success' ? 'alert-success' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{notice.message}</div>}
      {canManageSettings && institutionalDataIncomplete && <div className="alert border-amber-200 bg-amber-50 text-amber-800">Complete CPF/CNPJ, endereco e telefone em Dados do locador antes de emitir documentos definitivos.</div>}
      {!canCreate && canManage && <div className="alert border-amber-200 bg-amber-50 text-amber-800">Cadastre um cliente e mantenha ao menos um aparelho disponivel para abrir um contrato.</div>}

      <div className="panel flex flex-col gap-3 p-3 md:flex-row">
        <div className="relative flex-1"><Search className="input-icon" /><input className="input border-0 bg-slate-50 pl-11" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cliente, contrato, modelo ou serie" /></div>
        <select className="input md:w-48" value={status} onChange={(event) => setStatus(event.target.value as 'all' | ContractStatus)}><option value="all">Todos os status</option>{Object.entries(statusLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      </div>

      {filtered.length === 0 ? <EmptyState title="Nenhum contrato encontrado" description="Os contratos ativos aparecerao aqui com cliente, aparelho e condicoes financeiras." /> : (
        <div className="grid gap-5 xl:grid-cols-2">
          {filtered.map((contract) => {
            const contractDocuments = (documentsQuery.data ?? []).filter((document) => document.contract_id === contract.id);
            const expanded = expandedContractId === contract.id;
            return (
              <article key={contract.id} className={`panel p-5 sm:p-6 ${expanded ? 'xl:col-span-2' : ''}`}>
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
                  <div><p className="text-slate-400">Caucao separada</p><p className="mt-1 font-extrabold text-slate-900">{formatCurrency(contract.deposit_amount)}</p></div>
                  <div><p className="text-slate-400">Inicio</p><p className="mt-1 font-bold text-slate-700">{formatDate(contract.start_date)}</p></div>
                  <div><p className="text-slate-400">Mensalidades</p><p className="mt-1 font-bold text-slate-700">{contract.term_months}</p></div>
                </div>
                {contract.deposit_as_first_installment && <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">Contrato historico: a caucao permanece registrada conforme a regra vigente na criacao.</div>}
                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <button className="btn-secondary flex-1" type="button" onClick={() => setExpandedContractId(expanded ? null : contract.id)}><FileText className="h-4 w-4" />Documentos <ChevronDown className={`h-4 w-4 transition ${expanded ? 'rotate-180' : ''}`} /></button>
                  {canManage && ['active', 'overdue'].includes(contract.status) && <button className="btn-secondary flex-1" type="button" onClick={() => openEditModal(contract)}><PencilLine className="h-4 w-4" />Editar contrato</button>}
                </div>

                {expanded && (
                  <div className="mt-6 border-t border-slate-200 pt-6">
                    <div className="grid gap-4 lg:grid-cols-2">
                      {(['rental_contract', 'delivery_term'] as const).map((type) => {
                        const versions = contractDocuments.filter((document) => document.document_type === type).sort((a, b) => b.version - a.version);
                        const current = versions.find((document) => document.is_current && document.status === 'ready') ?? versions[0];
                        const generatingThis = documentMutation.isPending && documentMutation.variables?.contractId === contract.id && documentMutation.variables.type === type;
                        return (
                          <section key={type} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-700">Documento</p><h3 className="mt-1 font-bold text-slate-950">{documentTitle[type]}</h3></div>
                              <span className={`status-pill ${current?.status === 'ready' ? 'bg-emerald-50 text-emerald-700' : current?.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{generatingThis ? 'Gerando' : current?.status === 'ready' ? 'Pronto' : current?.status === 'failed' ? 'Falhou' : 'Pendente'}</span>
                            </div>
                            <p className="mt-3 text-xs text-slate-500">{current ? `Versao ${current.version} | ${formatDate(current.generated_at ?? current.created_at)}` : 'Ainda nao gerado'}</p>
                            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                              <button className="btn-secondary px-2" type="button" disabled={!current || current.status !== 'ready' || generatingThis} onClick={() => current && handleDocumentAction(current, 'view')}><Eye className="h-4 w-4" />Ver</button>
                              <button className="btn-secondary px-2" type="button" disabled={!current || current.status !== 'ready' || generatingThis} onClick={() => current && handleDocumentAction(current, 'download')}><Download className="h-4 w-4" />Baixar</button>
                              <button className="btn-secondary px-2" type="button" disabled={!current || current.status !== 'ready' || generatingThis} onClick={() => current && handleDocumentAction(current, 'share')}><Share2 className="h-4 w-4" />Enviar</button>
                              <button className="btn-primary px-2" type="button" disabled={generatingThis} onClick={() => setRegenerateTarget({ contractId: contract.id, type })}>{generatingThis ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Gerar</button>
                            </div>
                            {versions.length > 0 && <details className="mt-4 text-xs"><summary className="cursor-pointer font-bold text-slate-600">Historico ({versions.length})</summary><div className="mt-2 space-y-2">{versions.map((version) => <div key={version.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2"><span>v{version.version} | {formatDate(version.generated_at ?? version.created_at)}</span>{version.status === 'ready' && <button className="font-bold text-cyan-700" type="button" onClick={() => handleDocumentAction(version, 'view')}>Abrir</button>}</div>)}</div></details>}
                          </section>
                        );
                      })}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <Modal title={editingContract ? 'Editar contrato' : 'Novo contrato de locacao'} description={editingContract ? editingContract.contract_number : 'Revise as condicoes, mensalidades e entrega antes de salvar.'} onClose={closeModal}>
          <form className="space-y-6" onSubmit={form.handleSubmit((values) => mutation.mutate({ values, contract: editingContract }))}>
            {mutation.error && <ErrorState error={mutation.error} />}
            {creationStage && <div className="alert alert-success flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin" />{creationStage}</div>}
            {editingContract?.deposit_as_first_installment && <div className="alert border-amber-200 bg-amber-50 text-amber-800">Este contrato e historico. A edicao preservara a caucao como foi registrada originalmente.</div>}
            {missingRelatedData.length > 0 && <div className="alert border-amber-200 bg-amber-50 text-amber-800">Revise o cadastro antes do PDF: {missingRelatedData.join(', ')}.</div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="form-field"><span>Cliente *</span><select className="input" {...form.register('client_id')}><option value="">Selecione</option>{clientsQuery.data?.map((client) => <option key={client.id} value={client.id}>{client.full_name} | {client.cpf}</option>)}</select></label>
              <label className="form-field"><span>iPhone *</span><select className="input" {...form.register('device_id')}><option value="">Selecione</option>{formDevices.map((device) => <option key={device.id} value={device.id}>{device.model} | SN {device.serial_number}</option>)}</select></label>
              <label className="form-field"><span>Data de inicio *</span><input className="input" type="date" {...form.register('start_date')} /></label>
              <label className="form-field"><span>Data da primeira mensalidade *</span><input className="input" type="date" {...form.register('first_installment_date')} />{form.formState.errors.first_installment_date && <small className="text-red-600">{form.formState.errors.first_installment_date.message}</small>}</label>
            </div>

            <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <h3 className="font-display text-xl text-slate-950">Resumo financeiro</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="form-field"><span>Quantidade de mensalidades (1 a 60)</span><input className="input" type="number" min="1" max="60" step="1" {...form.register('term_months', { valueAsNumber: true })} /></label>
                <label className="form-field"><span>Valor da mensalidade *</span><input className="input" type="number" min="0.01" step="0.01" {...form.register('monthly_amount', { valueAsNumber: true })} /></label>
                <label className="form-field"><span>Valor da caucao</span><input className="input" type="number" min="0" step="0.01" readOnly={Boolean(editingContract?.deposit_as_first_installment)} {...form.register('deposit_amount', { valueAsNumber: true })} /></label>
                <label className="form-field"><span>Data de pagamento da caucao</span><input className="input" type="date" disabled={Number(watched.deposit_amount) <= 0} readOnly={Boolean(editingContract?.deposit_as_first_installment)} {...form.register('deposit_paid_at')} /></label>
                <label className="form-field"><span>Forma de pagamento da caucao</span><select className="input" disabled={Number(watched.deposit_amount) <= 0 || Boolean(editingContract?.deposit_as_first_installment)} {...form.register('deposit_payment_method')}><option value="">Selecione</option><option value="pix">Pix</option><option value="card">Cartao</option><option value="transfer">Transferencia</option><option value="cash">Dinheiro</option><option value="other">Outro</option></select></label>
                <label className="form-field"><span>Dia de vencimento</span><input className="input" type="number" min="1" max="31" {...form.register('due_day', { valueAsNumber: true })} /></label>
                <label className="form-field"><span>Multa por atraso (%)</span><input className="input" type="number" step="0.01" {...form.register('late_fee_percent', { valueAsNumber: true })} /></label>
                <label className="form-field"><span>Juros diarios (%)</span><input className="input" type="number" step="0.001" {...form.register('daily_interest_percent', { valueAsNumber: true })} /></label>
                <label className="form-field"><span>Valor de indenizacao *</span><input className="input" type="number" min="0.01" step="0.01" {...form.register('indemnity_value', { valueAsNumber: true })} /></label>
                {watched.purchase_option && <label className="form-field"><span>Valor da opcao de compra *</span><input className="input" type="number" min="0.01" step="0.01" {...form.register('purchase_option_amount', { valueAsNumber: true })} /></label>}
                <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-700 sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-cyan-700" {...form.register('purchase_option')} />Permitir opcao de compra</label>
              </div>
              <div className="mt-4 grid gap-3 rounded-2xl bg-slate-950 p-4 text-white sm:grid-cols-4">
                <div><p className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">Caucao separada</p><p className="mt-1 font-extrabold">{formatCurrency(contractPlan.depositAmount)}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Mensalidades</p><p className="mt-1 font-extrabold">{contractPlan.monthlyInstallments} x {formatCurrency(Number(watched.monthly_amount || 0))}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total do contrato</p><p className="mt-1 font-extrabold text-cyan-300">{formatCurrency(contractPlan.totalContract)}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Saldo apos o ato</p><p className="mt-1 font-extrabold">{formatCurrency(contractPlan.remainingBalance)}</p></div>
              </div>
            </section>

            <section className="rounded-2xl border border-cyan-200 bg-cyan-50/60 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-cyan-900"><CalendarDays className="h-4 w-4" />Datas das mensalidades</p>
              <div className="mt-3 max-h-56 overflow-auto rounded-xl bg-white"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-slate-950 text-white"><tr><th className="p-3">Parcela</th><th className="p-3">Vencimento</th><th className="p-3">Valor</th><th className="p-3">Status</th></tr></thead><tbody>{preview.map((item) => <tr key={item.installmentNumber} className="border-b border-slate-100"><td className="p-3 font-bold">{item.installmentNumber}</td><td className="p-3">{formatDate(item.dueDate)}</td><td className="p-3">{formatCurrency(item.amount)}</td><td className="p-3 text-slate-400">Pendente</td></tr>)}</tbody></table></div>
              <p className="mt-3 flex items-center gap-2 text-[11px] text-cyan-800"><ShieldCheck className="h-3.5 w-3.5" />A caucao nao aparece nesta tabela e nao altera a numeracao.</p>
            </section>

            <section className="rounded-2xl border border-slate-200 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-slate-900"><CheckCircle2 className="h-4 w-4 text-cyan-700" />Checklist de entrega</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">{Object.entries(checklistLabels).map(([key, label]) => <label key={key} className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-700"><input type="checkbox" className="accent-cyan-700" {...form.register(`delivery_checklist.${key as DeliveryChecklistKey}`)} />{label}</label>)}</div>
              <label className="form-field mt-4"><span>Observacoes da entrega</span><textarea className="input min-h-20" {...form.register('delivery_checklist.notes')} /></label>
            </section>

            <div className="flex justify-end gap-3 border-t border-slate-200 pt-5"><button className="btn-secondary" disabled={mutation.isPending} type="button" onClick={closeModal}>Cancelar</button><button className="btn-primary" disabled={mutation.isPending} type="submit">{mutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : editingContract ? <Save className="h-4 w-4" /> : <FilePlus2 className="h-4 w-4" />}{mutation.isPending ? 'Processando...' : editingContract ? 'Salvar alteracoes' : 'Criar contrato e documentos'}</button></div>
          </form>
        </Modal>
      )}

      {settingsOpen && (
        <Modal title="Dados institucionais do locador" description="Estas informacoes serao usadas nos contratos e termos de entrega." onClose={() => setSettingsOpen(false)}>
          <form className="space-y-5" onSubmit={settingsForm.handleSubmit((values) => settingsMutation.mutate(values))}>
            {settingsMutation.error && <ErrorState error={settingsMutation.error} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="form-field sm:col-span-2"><span>Nome ou razao social *</span><input className="input" {...settingsForm.register('legal_name')} /></label>
              <label className="form-field"><span>CPF ou CNPJ</span><input className="input" {...settingsForm.register('tax_id')} /></label>
              <label className="form-field"><span>Telefone</span><input className="input" {...settingsForm.register('phone')} /></label>
              <label className="form-field sm:col-span-2"><span>Endereco</span><input className="input" {...settingsForm.register('address')} /></label>
              <label className="form-field"><span>Email</span><input className="input" type="email" {...settingsForm.register('email')} /></label>
              <label className="form-field"><span>Cidade</span><input className="input" {...settingsForm.register('city')} /></label>
              <label className="form-field sm:col-span-2"><span>Foro padrao</span><input className="input" {...settingsForm.register('default_venue')} /></label>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 pt-5"><button className="btn-secondary" type="button" onClick={() => setSettingsOpen(false)}>Cancelar</button><button className="btn-primary" disabled={settingsMutation.isPending} type="submit"><Save className="h-4 w-4" />{settingsMutation.isPending ? 'Salvando...' : 'Salvar dados'}</button></div>
          </form>
        </Modal>
      )}

      {regenerateTarget && (
        <Modal title={`Gerar ${documentTitle[regenerateTarget.type]}`} description="Uma nova versao sera criada sem apagar as anteriores." onClose={() => !documentMutation.isPending && setRegenerateTarget(null)}>
          <div className="space-y-5">
            {documentMutation.error && <ErrorState error={documentMutation.error} />}
            <label className="form-field"><span>Motivo da regeneracao (opcional)</span><textarea className="input min-h-24" maxLength={250} value={regenerationReason} onChange={(event) => setRegenerationReason(event.target.value)} /></label>
            <div className="flex justify-end gap-3"><button className="btn-secondary" type="button" disabled={documentMutation.isPending} onClick={() => setRegenerateTarget(null)}>Cancelar</button><button className="btn-primary" type="button" disabled={documentMutation.isPending} onClick={() => documentMutation.mutate({ ...regenerateTarget, reason: regenerationReason })}>{documentMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileClock className="h-4 w-4" />}{documentMutation.isPending ? 'Gerando...' : 'Criar nova versao'}</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
