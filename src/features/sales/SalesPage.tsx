import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  Banknote,
  CircleDollarSign,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  TrendingUp,
  UserRound,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useAuth } from '../../AuthGate';
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader } from '../../components/ui';
import {
  createDirectDeviceSale,
  listClients,
  listDevices,
  listDeviceSales,
} from '../../repositories/rentalRepository';
import { directDeviceSaleSchema, type DirectDeviceSaleFormData } from '../../schemas/forms';
import type { PaymentMethod } from '../../types';
import { displayCpf, formatCurrency, formatDate } from '../../utils/formatters';

const paymentMethodLabel: Record<PaymentMethod, string> = {
  pix: 'Pix',
  card: 'Cartao',
  transfer: 'Transferencia',
  cash: 'Dinheiro',
  other: 'Outros',
};

const localDateTime = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const saleDefaults = (): DirectDeviceSaleFormData => ({
  device_id: '',
  client_id: '',
  sale_amount: 0,
  sold_at: localDateTime(),
  payment_method: 'pix',
  serial_confirmation: '',
  apple_release_confirmed: false,
  notes: '',
});

const allowedRoles = new Set(['admin', 'manager', 'finance']);

export default function SalesPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const canSell = allowedRoles.has(profile.role);
  const query = useQuery({
    queryKey: ['device-sales'],
    queryFn: async () => {
      const [sales, devices, clients] = await Promise.all([
        listDeviceSales(),
        listDevices(),
        listClients(),
      ]);
      return { sales, devices, clients };
    },
  });
  const form = useForm<DirectDeviceSaleFormData>({
    resolver: zodResolver(directDeviceSaleSchema),
    defaultValues: saleDefaults(),
  });
  const selectedDeviceId = form.watch('device_id');
  const saleAmount = form.watch('sale_amount');
  const selectedDevice = query.data?.devices.find((device) => device.id === selectedDeviceId);
  const availableDevices = query.data?.devices.filter((device) => device.status === 'available') ?? [];

  const mutation = useMutation({
    mutationFn: (values: DirectDeviceSaleFormData) => createDirectDeviceSale(profile.organization_id, values),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['device-sales'] }),
        queryClient.invalidateQueries({ queryKey: ['devices'] }),
        queryClient.invalidateQueries({ queryKey: ['cash-transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['profitability'] }),
        queryClient.invalidateQueries({ queryKey: ['rental-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['mdm-devices'] }),
      ]);
      setModalOpen(false);
      form.reset(saleDefaults());
      setNotice('Venda concluida. O aparelho foi baixado da frota e o valor entrou no caixa.');
    },
  });

  const filteredSales = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return query.data?.sales ?? [];
    return (query.data?.sales ?? []).filter((sale) => (
      `${sale.client?.full_name ?? ''} ${sale.client?.cpf ?? ''} ${sale.device?.model ?? ''} ${sale.device?.serial_number ?? ''}`
        .toLowerCase()
        .includes(term)
    ));
  }, [query.data?.sales, search]);

  const totals = useMemo(() => {
    const sales = query.data?.sales ?? [];
    const revenue = sales.reduce((sum, sale) => sum + sale.sale_amount, 0);
    const grossMargin = sales.reduce((sum, sale) => sum + sale.sale_amount - (sale.device?.purchase_amount ?? 0), 0);
    return {
      count: sales.length,
      revenue,
      grossMargin,
      averageTicket: sales.length ? revenue / sales.length : 0,
    };
  }, [query.data?.sales]);

  const openModal = () => {
    mutation.reset();
    setNotice('');
    form.reset(saleDefaults());
    setModalOpen(true);
  };

  const closeModal = () => {
    if (mutation.isPending) return;
    setModalOpen(false);
    mutation.reset();
    form.reset(saleDefaults());
  };

  const submitSale = (values: DirectDeviceSaleFormData) => {
    if (!selectedDevice) {
      form.setError('device_id', { message: 'Selecione um aparelho disponivel.' });
      return;
    }
    if (values.serial_confirmation.trim().toUpperCase() !== selectedDevice.serial_number.trim().toUpperCase()) {
      form.setError('serial_confirmation', { message: 'O numero de serie digitado nao confere.' });
      return;
    }
    if (selectedDevice.mdm_enrolled && !values.apple_release_confirmed) {
      form.setError('apple_release_confirmed', { message: 'Confirme a liberacao do Apple Business/MDM.' });
      return;
    }
    mutation.mutate(values);
  };

  if (query.isLoading) return <LoadingState label="Carregando vendas..." />;

  const grossMargin = Number(saleAmount || 0) - (selectedDevice?.purchase_amount ?? 0);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Estoque, cliente e caixa"
        title="Vendas de iPhones"
        action={canSell ? (
          <button className="btn-primary" type="button" onClick={openModal} disabled={!availableDevices.length || !(query.data?.clients.length)}>
            <Plus className="h-4 w-4" />Nova venda direta
          </button>
        ) : undefined}
      />

      {query.error && <ErrorState error={query.error} />}
      {notice && <div className="alert alert-success flex items-center gap-2"><BadgeCheck className="h-4 w-4 shrink-0" />{notice}</div>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="metric-card">
          <div className="flex items-center justify-between"><p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Vendas concluidas</p><ShoppingBag className="h-4 w-4 text-cyan-600" /></div>
          <p className="mt-2 text-xl font-extrabold text-slate-950">{totals.count}</p>
        </article>
        <article className="metric-card border-emerald-200/80 bg-emerald-50/50">
          <div className="flex items-center justify-between"><p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">Receita recebida</p><CircleDollarSign className="h-4 w-4 text-emerald-600" /></div>
          <p className="mt-2 text-xl font-extrabold text-emerald-700">{formatCurrency(totals.revenue)}</p>
        </article>
        <article className="metric-card">
          <div className="flex items-center justify-between"><p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Margem bruta</p><TrendingUp className="h-4 w-4 text-gold-600" /></div>
          <p className={`mt-2 text-xl font-extrabold ${totals.grossMargin >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(totals.grossMargin)}</p>
        </article>
        <article className="metric-card">
          <div className="flex items-center justify-between"><p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Ticket medio</p><ReceiptText className="h-4 w-4 text-cyan-600" /></div>
          <p className="mt-2 text-xl font-extrabold text-slate-950">{formatCurrency(totals.averageTicket)}</p>
        </article>
      </div>

      {!availableDevices.length && canSell && (
        <div className="alert border-amber-200 bg-amber-50 text-amber-800">Nao ha aparelho disponivel para uma nova venda.</div>
      )}
      {!query.data?.clients.length && canSell && (
        <div className="alert border-amber-200 bg-amber-50 text-amber-800">Cadastre o cliente antes de concluir uma venda.</div>
      )}

      <div className="panel p-3">
        <div className="relative"><Search className="input-icon" /><input className="input border-0 bg-slate-50 pl-11" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cliente, CPF, modelo ou numero de serie" /></div>
      </div>

      {filteredSales.length === 0 ? (
        <EmptyState title="Nenhuma venda direta registrada" description="As vendas concluidas aparecerao aqui com cliente, aparelho e valor recebido." />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredSales.map((sale) => {
            const margin = sale.sale_amount - (sale.device?.purchase_amount ?? 0);
            return (
              <article key={sale.id} className="panel overflow-hidden">
                <div className="panel-dark rounded-none p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="font-display text-2xl text-white">{sale.device?.model ?? 'iPhone vendido'}</p><p className="mt-1 truncate font-mono text-[10px] text-slate-400">SN {sale.device?.serial_number ?? '-'}</p></div>
                    <span className="status-pill bg-emerald-50 text-emerald-700">Quitada</span>
                  </div>
                  <p className="mt-5 text-2xl font-extrabold text-gold-200">{formatCurrency(sale.sale_amount)}</p>
                </div>
                <div className="space-y-4 p-5 text-xs">
                  <div className="flex items-center gap-3"><UserRound className="h-4 w-4 shrink-0 text-cyan-700" /><div className="min-w-0"><p className="truncate font-bold text-slate-800">{sale.client?.full_name ?? 'Cliente nao informado'}</p><p className="mt-0.5 text-[10px] text-slate-400">{sale.client?.cpf ? displayCpf(sale.client.cpf) : '-'}</p></div></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-slate-50 p-3"><p className="text-slate-400">Pagamento</p><p className="mt-1 font-bold text-slate-800">{paymentMethodLabel[sale.payment_method]}</p></div>
                    <div className="rounded-xl bg-slate-50 p-3"><p className="text-slate-400">Data da venda</p><p className="mt-1 font-bold text-slate-800">{formatDate(sale.sold_at)}</p></div>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-100 pt-4"><span className="text-slate-500">Margem bruta</span><strong className={margin >= 0 ? 'text-emerald-700' : 'text-red-700'}>{formatCurrency(margin)}</strong></div>
                  <p className="flex items-center gap-2 font-semibold text-emerald-700"><ShieldCheck className="h-4 w-4" />Apple Business / MDM liberado</p>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <Modal title="Nova venda direta" description="Venda quitada com baixa imediata do aparelho e entrada automatica no caixa." onClose={closeModal}>
          <form className="space-y-5" onSubmit={form.handleSubmit(submitSale)}>
            {mutation.error && <ErrorState error={mutation.error} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="form-field sm:col-span-2"><span>Aparelho disponivel *</span><select className="input" {...form.register('device_id', { onChange: (event) => {
                const device = availableDevices.find((item) => item.id === event.target.value);
                form.setValue('sale_amount', device?.market_value ?? 0, { shouldValidate: true });
                form.setValue('serial_confirmation', '');
                form.setValue('apple_release_confirmed', false);
              } })}><option value="">Selecione</option>{availableDevices.map((device) => <option key={device.id} value={device.id}>{device.model} - {device.color} - SN {device.serial_number}</option>)}</select>{form.formState.errors.device_id && <small className="text-red-600">{form.formState.errors.device_id.message}</small>}</label>
              <label className="form-field sm:col-span-2"><span>Cliente comprador *</span><select className="input" {...form.register('client_id')}><option value="">Selecione</option>{query.data?.clients.map((client) => <option key={client.id} value={client.id}>{client.full_name} - {displayCpf(client.cpf)}</option>)}</select>{form.formState.errors.client_id && <small className="text-red-600">{form.formState.errors.client_id.message}</small>}</label>
              <label className="form-field"><span>Valor recebido *</span><input className="input" type="number" min="0.01" step="0.01" {...form.register('sale_amount', { valueAsNumber: true })} />{form.formState.errors.sale_amount && <small className="text-red-600">{form.formState.errors.sale_amount.message}</small>}</label>
              <label className="form-field"><span>Data e hora *</span><input className="input" type="datetime-local" max={localDateTime()} {...form.register('sold_at')} />{form.formState.errors.sold_at && <small className="text-red-600">{form.formState.errors.sold_at.message}</small>}</label>
              <label className="form-field sm:col-span-2"><span>Forma de pagamento *</span><select className="input" {...form.register('payment_method')}>{Object.entries(paymentMethodLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            </div>

            {selectedDevice && (
              <div className="panel-dark p-5">
                <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-gold-200"><Smartphone className="h-5 w-5" /></div><div><p className="font-bold text-white">{selectedDevice.model}</p><p className="text-[10px] text-slate-400">{selectedDevice.color} - {selectedDevice.capacity_gb} GB</p></div></div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div className="rounded-xl bg-white/[0.06] p-3"><p className="text-slate-400">Compra</p><p className="mt-1 font-bold text-white">{formatCurrency(selectedDevice.purchase_amount)}</p></div><div className="rounded-xl bg-white/[0.06] p-3"><p className="text-slate-400">Margem bruta</p><p className={`mt-1 font-bold ${grossMargin >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{formatCurrency(grossMargin)}</p></div></div>
              </div>
            )}

            <label className="form-field"><span>Confirme o numero de serie *</span><input className="input font-mono uppercase" autoComplete="off" placeholder={selectedDevice ? `Digite ${selectedDevice.serial_number}` : 'Selecione o aparelho primeiro'} {...form.register('serial_confirmation')} />{form.formState.errors.serial_confirmation && <small className="text-red-600">{form.formState.errors.serial_confirmation.message}</small>}</label>

            {selectedDevice?.mdm_enrolled && (
              <label className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><input className="mt-1" type="checkbox" {...form.register('apple_release_confirmed')} /><span><strong className="block">Apple Business / MDM liberado</strong>Confirmo que o aparelho foi removido do gerenciamento antes da entrega.</span></label>
            )}
            {form.formState.errors.apple_release_confirmed && <small className="block text-red-600">{form.formState.errors.apple_release_confirmed.message}</small>}

            <label className="form-field"><span>Observacoes</span><textarea className="input min-h-24 resize-y" maxLength={1000} {...form.register('notes')} /></label>
            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end"><button className="btn-secondary" type="button" onClick={closeModal}>Cancelar</button><button className="btn-primary" type="submit" disabled={mutation.isPending}><Banknote className="h-4 w-4" />{mutation.isPending ? 'Concluindo...' : 'Confirmar venda e receber'}</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
