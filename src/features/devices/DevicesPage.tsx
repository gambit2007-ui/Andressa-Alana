import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { BatteryCharging, PencilLine, Plus, Save, Search, ShieldCheck, Smartphone, Wrench } from 'lucide-react';
import { useAuth } from '../../AuthGate';
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader } from '../../components/ui';
import { createDevice, listDevices, updateDevice } from '../../repositories/rentalRepository';
import { deviceSchema, type DeviceFormData } from '../../schemas/forms';
import type { Device, DeviceStatus } from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';

const statusLabel: Record<DeviceStatus, string> = { available: 'Disponivel', rented: 'Alugado', maintenance: 'Manutencao', sold: 'Vendido', retired: 'Retirado' };
const statusTone: Record<DeviceStatus, string> = { available: 'bg-emerald-50 text-emerald-700', rented: 'bg-cyan-50 text-cyan-700', maintenance: 'bg-amber-50 text-amber-700', sold: 'bg-slate-100 text-slate-600', retired: 'bg-red-50 text-red-700' };
const defaultValues: DeviceFormData = { model: '', color: '', capacity_gb: 128, imei_1: '', imei_2: '', serial_number: '', battery_health: 100, purchase_date: new Date().toISOString().slice(0, 10), purchase_amount: 0, supplier: '', invoice_number: '', warranty_until: '', condition: 'Excelente', accessories: '', market_value: 0, indemnity_value: 0, notes: '', mdm_enrolled: false };

const deviceFormValues = (device: Device): DeviceFormData => ({
  model: device.model,
  color: device.color,
  capacity_gb: device.capacity_gb,
  imei_1: device.imei_1,
  imei_2: device.imei_2 ?? '',
  serial_number: device.serial_number,
  battery_health: device.battery_health,
  purchase_date: device.purchase_date.slice(0, 10),
  purchase_amount: device.purchase_amount,
  supplier: device.supplier ?? '',
  invoice_number: device.invoice_number ?? '',
  warranty_until: device.warranty_until?.slice(0, 10) ?? '',
  condition: device.condition,
  accessories: device.accessories.join(', '),
  market_value: device.market_value,
  indemnity_value: device.indemnity_value ?? device.market_value,
  notes: device.notes ?? '',
  mdm_enrolled: device.mdm_enrolled,
});

export default function DevicesPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | DeviceStatus>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const query = useQuery({ queryKey: ['devices'], queryFn: listDevices });
  const form = useForm<DeviceFormData>({ resolver: zodResolver(deviceSchema), defaultValues });
  const mutation = useMutation({
    mutationFn: ({ values, deviceId }: { values: DeviceFormData; deviceId?: string }) => deviceId
      ? updateDevice(profile.organization_id, deviceId, values)
      : createDevice(profile.organization_id, values),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['devices'] }),
        queryClient.invalidateQueries({ queryKey: ['mdm-devices'] }),
      ]);
      setModalOpen(false);
      setEditingDevice(null);
      form.reset(defaultValues);
    },
  });

  const openCreateModal = () => {
    mutation.reset();
    setEditingDevice(null);
    form.reset(defaultValues);
    setModalOpen(true);
  };

  const openEditModal = (device: Device) => {
    mutation.reset();
    setEditingDevice(device);
    form.reset(deviceFormValues(device));
    setModalOpen(true);
  };

  const closeModal = () => {
    if (mutation.isPending) return;
    setModalOpen(false);
    setEditingDevice(null);
    form.reset(defaultValues);
    mutation.reset();
  };

  const filtered = useMemo(() => (query.data ?? []).filter((device) => {
    const term = search.toLowerCase();
    return (status === 'all' || device.status === status) && `${device.model} ${device.color} ${device.serial_number} ${device.imei_1}`.toLowerCase().includes(term);
  }), [query.data, search, status]);

  if (query.isLoading) return <LoadingState />;

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Ativos e inventario" title="Frota de iPhones" action={profile.role !== 'viewer' ? <button className="btn-primary" type="button" onClick={openCreateModal}><Plus className="h-4 w-4" />Novo aparelho</button> : undefined} />
      {query.error && <ErrorState error={query.error} />}
      <div className="panel flex flex-col gap-3 p-3 md:flex-row">
        <div className="relative flex-1"><Search className="input-icon" /><input className="input border-0 bg-slate-50 pl-11" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Modelo, cor, numero de serie ou IMEI" /></div>
        <select className="input md:w-48" value={status} onChange={(event) => setStatus(event.target.value as 'all' | DeviceStatus)}><option value="all">Todos os status</option>{Object.entries(statusLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      </div>

      {filtered.length === 0 ? <EmptyState title="Nenhum aparelho encontrado" description="Cadastre o primeiro iPhone da frota." /> : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((device) => (
            <article key={device.id} className="panel overflow-hidden">
              <div className="relative bg-slate-950 p-5 text-white">
                <div className="absolute right-4 top-4 h-16 w-16 rounded-full bg-cyan-400/10 blur-xl" />
                <div className="flex items-start justify-between"><div><p className="font-display text-2xl">{device.model}</p><p className="mt-1 text-xs text-slate-400">{device.color} · {device.capacity_gb} GB</p></div><span className={`status-pill ${statusTone[device.status]}`}>{statusLabel[device.status]}</span></div>
                <div className="mt-5 flex items-center justify-between text-[11px] text-slate-400"><span>SN {device.serial_number}</span><span>IMEI {device.imei_1}</span></div>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-slate-400">Valor de compra</p><p className="mt-1 font-extrabold text-slate-800">{formatCurrency(device.purchase_amount)}</p></div>
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-slate-400">Mercado atual</p><p className="mt-1 font-extrabold text-slate-800">{formatCurrency(device.market_value)}</p></div>
                </div>
                <div className="mt-4 space-y-2.5 text-xs text-slate-600">
                  <p className="flex items-center justify-between"><span className="flex items-center gap-2"><BatteryCharging className={`h-4 w-4 ${device.battery_health < 85 ? 'text-red-500' : 'text-emerald-600'}`} />Saude da bateria</span><strong>{device.battery_health}%</strong></p>
                  <p className="flex items-center justify-between"><span className="flex items-center gap-2"><Wrench className="h-4 w-4 text-slate-400" />Condicao</span><strong>{device.condition}</strong></p>
                  <p className="flex items-center justify-between"><span className="flex items-center gap-2"><ShieldCheck className={`h-4 w-4 ${device.mdm_enrolled ? 'text-emerald-600' : 'text-slate-400'}`} />Apple Business / MDM</span><strong className={device.mdm_enrolled ? 'text-emerald-700' : 'text-slate-500'}>{device.mdm_enrolled ? 'Ativo' : 'Desativado'}</strong></p>
                </div>
                <p className="mt-4 border-t border-slate-100 pt-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Comprado em {formatDate(device.purchase_date)} · {device.supplier || 'Fornecedor nao informado'}</p>
                {profile.role !== 'viewer' && <button className="btn-secondary mt-4 w-full" type="button" onClick={() => openEditModal(device)}><PencilLine className="h-4 w-4" />Editar informacoes</button>}
              </div>
            </article>
          ))}
        </div>
      )}

      {modalOpen && (
        <Modal title={editingDevice ? 'Editar iPhone' : 'Cadastrar iPhone'} description={editingDevice ? `${editingDevice.model} · SN ${editingDevice.serial_number}` : 'IMEIs e serie devem ser unicos dentro da organizacao.'} onClose={closeModal}>
          <form className="space-y-5" onSubmit={form.handleSubmit((values) => mutation.mutate({ values, deviceId: editingDevice?.id }))}>
            {mutation.error && <ErrorState error={mutation.error} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="form-field"><span>Modelo *</span><input className="input" placeholder="iPhone 15 Pro Max" {...form.register('model')} /></label>
              <label className="form-field"><span>Cor *</span><input className="input" placeholder="Titanio natural" {...form.register('color')} /></label>
              <label className="form-field"><span>Capacidade</span><select className="input" {...form.register('capacity_gb', { valueAsNumber: true })}>{[64,128,256,512,1024].map((value) => <option key={value} value={value}>{value === 1024 ? '1 TB' : `${value} GB`}</option>)}</select></label>
              <label className="form-field"><span>Saude da bateria (%)</span><input className="input" type="number" min="0" max="100" {...form.register('battery_health', { valueAsNumber: true })} /></label>
              <label className="form-field"><span>IMEI 1 *</span><input className="input font-mono" maxLength={15} {...form.register('imei_1')} /></label>
              <label className="form-field"><span>IMEI 2</span><input className="input font-mono" maxLength={15} {...form.register('imei_2')} /></label>
              <label className="form-field sm:col-span-2"><span>Numero de serie *</span><input className="input font-mono uppercase" {...form.register('serial_number')} /></label>
              <label className="form-field"><span>Data de compra *</span><input className="input" type="date" {...form.register('purchase_date')} /></label>
              <label className="form-field"><span>Garantia ate</span><input className="input" type="date" {...form.register('warranty_until')} /></label>
              <label className="form-field"><span>Valor de compra</span><input className="input" type="number" step="0.01" {...form.register('purchase_amount', { valueAsNumber: true })} /></label>
              <label className="form-field"><span>Valor de mercado</span><input className="input" type="number" step="0.01" {...form.register('market_value', { valueAsNumber: true })} /></label>
              <label className="form-field"><span>Valor de indenizacao *</span><input className="input" type="number" min="0.01" step="0.01" {...form.register('indemnity_value', { valueAsNumber: true })} /></label>
              <label className="form-field"><span>Fornecedor</span><input className="input" {...form.register('supplier')} /></label>
              <label className="form-field"><span>Nota fiscal</span><input className="input" {...form.register('invoice_number')} /></label>
              <label className="form-field sm:col-span-2"><span>Condicao</span><select className="input" {...form.register('condition')}><option>Excelente</option><option>Bom</option><option>Regular</option><option>Necessita manutencao</option></select></label>
              <label className="form-field sm:col-span-2"><span>Acessorios entregues</span><input className="input" placeholder="Cabo, carregador, caixa" {...form.register('accessories')} /></label>
              <label className="form-field sm:col-span-2"><span>Observacoes e avarias</span><textarea className="input min-h-20" {...form.register('notes')} /></label>
              <label className="form-field sm:col-span-2"><span>Apple Business / MDM</span><select className="input" {...form.register('mdm_enrolled', { setValueAs: (value) => value === 'true' })}><option value="false">Desativado</option><option value="true">Ativo</option></select></label>
            </div>
            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end"><button className="btn-secondary" disabled={mutation.isPending} type="button" onClick={closeModal}>Cancelar</button><button className="btn-primary" disabled={mutation.isPending} type="submit">{editingDevice ? <Save className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}{mutation.isPending ? 'Salvando...' : editingDevice ? 'Salvar alteracoes' : 'Cadastrar aparelho'}</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
