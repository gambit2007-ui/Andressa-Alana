import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Camera, FileCheck2, Mail, MapPin, PencilLine, Plus, Save, Search, ShieldCheck, Upload, UserRound } from 'lucide-react';
import { useAuth } from '../../AuthGate';
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader } from '../../components/ui';
import { clientSchema, type ClientFormData } from '../../schemas/forms';
import { createClient, listClients, updateClient, uploadClientDocument } from '../../repositories/rentalRepository';
import type { Client, ClientDocumentKind } from '../../types';
import { displayCpf, formatCurrency, formatDate } from '../../utils/formatters';

const defaultValues: ClientFormData = {
  full_name: '', cpf: '', rg: '', birth_date: '', phone: '', secondary_phone: '', email: '', profession: '', monthly_income: 0,
  address_line: '', address_number: '', address_complement: '', neighborhood: '', city: '', state: '', postal_code: '',
  work_address: '', reference_name: '', reference_phone: '',
  internal_risk_score: 650, notes: '',
};

const clientFormValues = (client: Client): ClientFormData => ({
  full_name: client.full_name, cpf: client.cpf, rg: client.rg ?? '', birth_date: client.birth_date ?? '',
  phone: client.phone, secondary_phone: client.secondary_phone ?? '', email: client.email ?? '',
  profession: client.profession ?? '', monthly_income: client.monthly_income,
  address_line: client.address_line ?? '', address_number: client.address_number ?? '',
  address_complement: client.address_complement ?? '', neighborhood: client.neighborhood ?? '',
  city: client.city ?? '', state: client.state ?? '', postal_code: client.postal_code ?? '',
  work_address: client.work_address ?? '', reference_name: client.reference_name ?? '',
  reference_phone: client.reference_phone ?? '', internal_risk_score: client.internal_risk_score,
  notes: client.notes ?? '',
});

export default function ClientsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [files, setFiles] = useState<Partial<Record<ClientDocumentKind, File>>>({});
  const clientsQuery = useQuery({ queryKey: ['clients'], queryFn: listClients });
  const form = useForm<ClientFormData>({ resolver: zodResolver(clientSchema), defaultValues });

  const mutation = useMutation({
    mutationFn: async (values: ClientFormData) => {
      const client = editingClient
        ? await updateClient(profile.organization_id, editingClient.id, values)
        : await createClient(profile.organization_id, values);
      await Promise.all(Object.entries(files).map(([kind, file]) => uploadClientDocument({
        organizationId: profile.organization_id,
        clientId: client.id,
        kind: kind as ClientDocumentKind,
        file,
      })));
      return client;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      setModalOpen(false);
      setEditingClient(null);
      setFiles({});
      form.reset(defaultValues);
    },
  });

  const filtered = useMemo(() => (clientsQuery.data ?? []).filter((client) => {
    const term = search.toLowerCase();
    return client.full_name.toLowerCase().includes(term) || client.cpf.includes(search.replace(/\D/g, '')) || client.phone.includes(search);
  }), [clientsQuery.data, search]);

  const canWrite = ['admin', 'manager', 'operator'].includes(profile.role);

  const openCreateModal = () => {
    mutation.reset();
    setEditingClient(null);
    setFiles({});
    form.reset(defaultValues);
    setModalOpen(true);
  };

  const openEditModal = (client: Client) => {
    mutation.reset();
    setEditingClient(client);
    setFiles({});
    form.reset(clientFormValues(client));
    setModalOpen(true);
  };

  const closeModal = () => {
    if (mutation.isPending) return;
    setModalOpen(false);
    setEditingClient(null);
    setFiles({});
    form.reset(defaultValues);
  };

  if (clientsQuery.isLoading) return <LoadingState />;

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Cadastro e risco" title="Clientes" action={canWrite ? <button className="btn-primary" type="button" onClick={openCreateModal}><Plus className="h-4 w-4" />Novo cliente</button> : undefined} />
      {clientsQuery.error && <ErrorState error={clientsQuery.error} />}

      <div className="panel p-3">
        <div className="relative"><Search className="input-icon" /><input className="input border-0 bg-slate-50 pl-11 focus:bg-white" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, CPF ou telefone" /></div>
      </div>

      {filtered.length === 0 ? <EmptyState title="Nenhum cliente encontrado" description="Cadastre o primeiro locatario para iniciar a operacao." /> : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((client) => {
            const riskTone = client.internal_risk_score >= 800 ? 'bg-emerald-50 text-emerald-700' : client.internal_risk_score >= 600 ? 'bg-cyan-50 text-cyan-700' : client.internal_risk_score >= 400 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700';
            return (
              <article key={client.id} className="panel p-5 transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-950 font-display text-lg text-cyan-300">{client.full_name.slice(0, 2).toUpperCase()}</div>
                    <div className="min-w-0"><h2 className="truncate font-bold text-slate-950">{client.full_name}</h2><p className="mt-0.5 text-xs text-slate-500">CPF {displayCpf(client.cpf)}</p></div>
                  </div>
                  <span className={`status-pill ${riskTone}`}>{client.internal_risk_score}</span>
                </div>
                <div className="mt-5 space-y-2.5 border-t border-slate-100 pt-4 text-xs text-slate-600">
                  <p className="flex items-center gap-2"><UserRound className="h-3.5 w-3.5 text-slate-400" />{client.phone}</p>
                  <p className="flex items-center gap-2 truncate"><Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />{client.email || 'Email nao informado'}</p>
                  <p className="flex items-center gap-2 truncate"><MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />{client.city ? `${client.city}/${client.state}` : 'Endereco incompleto'}</p>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-50 p-3 text-xs">
                  <div><p className="text-slate-400">Renda declarada</p><p className="mt-1 font-bold text-slate-800">{formatCurrency(client.monthly_income)}</p></div>
                  <div><p className="text-slate-400">Cadastro</p><p className="mt-1 font-bold text-slate-800">{formatDate(client.created_at)}</p></div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400"><ShieldCheck className="h-3.5 w-3.5 text-cyan-600" />Classificacao interna, nao score de bureau</div>
                {canWrite && <button className="btn-secondary mt-4 w-full" type="button" onClick={() => openEditModal(client)}><PencilLine className="h-4 w-4" />Editar cadastro</button>}
              </article>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <Modal title={editingClient ? 'Editar cliente' : 'Novo cliente'} description="Os documentos serao enviados para um bucket privado do Supabase." onClose={closeModal}>
          <form className="space-y-6" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
            {mutation.error && <ErrorState error={mutation.error} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="form-field sm:col-span-2"><span>Nome completo *</span><input className="input" {...form.register('full_name')} />{form.formState.errors.full_name && <small className="text-red-600">{form.formState.errors.full_name.message}</small>}</label>
              <label className="form-field"><span>CPF *</span><input className="input" {...form.register('cpf')} /></label>
              <label className="form-field"><span>RG</span><input className="input" {...form.register('rg')} /></label>
              <label className="form-field"><span>Data de nascimento</span><input className="input" type="date" {...form.register('birth_date')} /></label>
              <label className="form-field"><span>Telefone / WhatsApp *</span><input className="input" {...form.register('phone')} /></label>
              <label className="form-field"><span>Telefone secundario</span><input className="input" {...form.register('secondary_phone')} /></label>
              <label className="form-field"><span>Email</span><input className="input" type="email" {...form.register('email')} /></label>
              <label className="form-field"><span>Profissao</span><input className="input" {...form.register('profession')} /></label>
              <label className="form-field"><span>Renda mensal</span><input className="input" type="number" step="0.01" {...form.register('monthly_income', { valueAsNumber: true })} /></label>
            </div>
            <div className="grid gap-4 sm:grid-cols-6">
              <label className="form-field sm:col-span-4"><span>Endereco</span><input className="input" {...form.register('address_line')} /></label>
              <label className="form-field sm:col-span-2"><span>Numero</span><input className="input" {...form.register('address_number')} /></label>
              <label className="form-field sm:col-span-3"><span>Complemento</span><input className="input" {...form.register('address_complement')} /></label>
              <label className="form-field sm:col-span-2"><span>Bairro</span><input className="input" {...form.register('neighborhood')} /></label>
              <label className="form-field sm:col-span-2"><span>Cidade</span><input className="input" {...form.register('city')} /></label>
              <label className="form-field"><span>UF</span><input className="input uppercase" maxLength={2} {...form.register('state')} /></label>
              <label className="form-field"><span>CEP</span><input className="input" {...form.register('postal_code')} /></label>
              <label className="form-field sm:col-span-6"><span>Endereco de trabalho</span><input className="input" {...form.register('work_address')} /></label>
              <label className="form-field sm:col-span-3"><span>Contato de referencia</span><input className="input" {...form.register('reference_name')} /></label>
              <label className="form-field sm:col-span-3"><span>Telefone da referencia</span><input className="input" {...form.register('reference_phone')} /></label>
            </div>
            <label className="form-field"><span>Classificacao interna: {form.watch('internal_risk_score')}</span><input type="range" min="0" max="1000" className="w-full accent-cyan-700" {...form.register('internal_risk_score', { valueAsNumber: true })} /><small className="font-normal text-slate-500">Uso interno da Vantage iPhones. Nao equivale a score oficial de credito.</small></label>
            <label className="form-field"><span>Observacoes</span><textarea className="input min-h-24" {...form.register('notes')} /></label>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-cyan-700" /><p className="text-sm font-bold text-slate-800">Documentos privados</p></div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {([
                  ['selfie', 'Selfie com documento', Camera],
                  ['identity', 'Documento de identidade', FileCheck2],
                  ['income', 'Comprovante de renda', Upload],
                  ['residence', 'Comprovante de residencia', MapPin],
                ] as const).map(([kind, label, Icon]) => (
                  <label key={kind} className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 p-3 text-xs font-semibold text-slate-600 hover:border-cyan-500 hover:bg-cyan-50/40">
                    <Icon className="h-4 w-4 text-cyan-700" /><span className="min-w-0 flex-1 truncate">{files[kind]?.name ?? label}</span>
                    <input type="file" accept="image/*,.pdf" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) setFiles((current) => ({ ...current, [kind]: file })); }} />
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 pt-5"><button className="btn-secondary" type="button" onClick={closeModal}>Cancelar</button><button className="btn-primary" disabled={mutation.isPending} type="submit">{editingClient ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{mutation.isPending ? 'Salvando...' : editingClient ? 'Salvar alteracoes' : 'Cadastrar cliente'}</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
