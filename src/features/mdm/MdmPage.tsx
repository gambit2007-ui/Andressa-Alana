import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CloudCog, LockKeyhole, Play, RefreshCw, Smartphone } from 'lucide-react';
import { useAuth } from '../../AuthGate';
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader } from '../../components/ui';
import { invokeMdmCommand, listMdmCommands, listMdmDevices } from '../../repositories/rentalRepository';
import { supabase } from '../../lib/supabase';
import type { MdmDevice } from '../../types';
import { formatDate } from '../../utils/formatters';

const commands = [
  { key: 'sync', label: 'Sincronizar', destructive: false },
  { key: 'lock', label: 'Bloquear tela', destructive: false },
  { key: 'lost_mode_on', label: 'Ativar Modo Perdido', destructive: false },
  { key: 'lost_mode_off', label: 'Desativar Modo Perdido', destructive: false },
  { key: 'erase', label: 'Apagar aparelho', destructive: true },
  { key: 'clear_activation_lock', label: 'Limpar Activation Lock', destructive: true },
  { key: 'remove_management', label: 'Remover gerenciamento', destructive: true },
] as const;

export default function MdmPage() {
  const { profile, session } = useAuth();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<MdmDevice | null>(null);
  const [command, setCommand] = useState<(typeof commands)[number]['key']>('sync');
  const [reason, setReason] = useState('');
  const [serial, setSerial] = useState('');
  const [password, setPassword] = useState('');
  const devicesQuery = useQuery({ queryKey: ['mdm-devices'], queryFn: listMdmDevices });
  const commandsQuery = useQuery({ queryKey: ['mdm-commands'], queryFn: listMdmCommands });
  const selectedCommand = commands.find((item) => item.key === command)!;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('Selecione um dispositivo.');
      if (selectedCommand.destructive) {
        if (!session.user.email || !password) throw new Error('Informe sua senha para reautenticar.');
        const { error } = await supabase!.auth.signInWithPassword({ email: session.user.email, password });
        if (error) throw new Error('Reautenticacao falhou. Confira a senha.');
      }
      await invokeMdmCommand({ mdmDeviceId: selected.id, command, reason, confirmedSerial: serial, destructive: selectedCommand.destructive });
    },
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['mdm-devices'] }), queryClient.invalidateQueries({ queryKey: ['mdm-commands'] })]);
      setSelected(null); setReason(''); setSerial(''); setPassword('');
    },
  });

  const commandByStatus = useMemo(() => (commandsQuery.data ?? []).reduce<Record<string, number>>((acc, item) => { acc[item.status] = (acc[item.status] ?? 0) + 1; return acc; }, {}), [commandsQuery.data]);
  if (devicesQuery.isLoading || commandsQuery.isLoading) return <LoadingState />;
  const canCommand = ['admin', 'manager'].includes(profile.role);

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Apple Business Manager" title="MDM e seguranca da frota" />
      {(devicesQuery.error || commandsQuery.error) && <ErrorState error={devicesQuery.error ?? commandsQuery.error} />}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Dispositivos no MDM', value: devicesQuery.data?.length ?? 0, Icon: Smartphone },
          { label: 'Comandos executados', value: commandByStatus.executed ?? 0, Icon: CheckCircle2 },
          { label: 'Aguardando / enviados', value: (commandByStatus.requested ?? 0) + (commandByStatus.sent ?? 0), Icon: CloudCog },
        ].map(({ label, value, Icon }) => <article key={label} className="metric-card flex items-center gap-4"><div className="grid h-11 w-11 place-items-center rounded-xl bg-cyan-50 text-cyan-700"><Icon className="h-5 w-5" /></div><div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-extrabold text-slate-950">{value}</p></div></article>)}
      </div>

      {(devicesQuery.data?.length ?? 0) === 0 ? <EmptyState title="Nenhum aparelho vinculado ao MDM" description="O cadastro de um iPhone cria o registro MDM mock automaticamente." /> : (
        <div className="grid gap-5 xl:grid-cols-2">
          {devicesQuery.data?.map((item) => {
            const isActive = Boolean(item.device?.mdm_enrolled);
            return (
              <article key={item.id} className="panel p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-extrabold uppercase tracking-wider text-cyan-700">{item.provider.toUpperCase()}</p><h2 className="mt-1 font-bold text-slate-950">{item.device?.model}</h2><p className="mt-1 font-mono text-[10px] text-slate-400">SN {item.device?.serial_number}</p></div><span className={`status-pill ${isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{isActive ? 'Ativo' : 'Desativado'}</span></div>
                <div className="mt-5 grid grid-cols-2 gap-2 text-xs">
                  {[
                    ['Cadastrado no ABM', Boolean(item.device?.apple_business_registered)], ['Atribuido a MDM', isActive], ['Inscrito', isActive], ['Supervisionado', item.supervised], ['Activation Lock gerenciado', item.activation_lock_managed], ['Pronto para locacao', item.supervised && item.activation_lock_managed],
                  ].map(([label, checked]) => <div key={String(label)} className="flex items-center gap-2 rounded-xl bg-slate-50 p-3"><span className={`h-2 w-2 rounded-full ${checked ? 'bg-emerald-500' : 'bg-amber-400'}`} /><span className="text-slate-600">{label}</span></div>)}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4"><p className="text-[10px] text-slate-400">Ultimo sync: {item.last_sync_at ? formatDate(item.last_sync_at) : 'nunca'}</p>{canCommand && <button className="btn-primary min-h-9 px-3 py-1.5 text-xs" type="button" onClick={() => { setSelected(item); setCommand('sync'); }}>Comando mock</button>}</div>
              </article>
            );
          })}
        </div>
      )}

      <section className="table-shell overflow-x-auto"><div className="border-b border-slate-200 p-5"><h2 className="font-display text-2xl text-slate-950">Historico de comandos</h2></div><table className="min-w-[760px]"><thead><tr><th>Comando</th><th>Motivo</th><th>Status</th><th>Tipo</th><th>Solicitado em</th></tr></thead><tbody>{commandsQuery.data?.map((item) => <tr key={item.id}><td className="font-mono font-bold">{item.command}</td><td>{item.reason}</td><td><span className="status-pill bg-slate-100 text-slate-700">{item.status}</span></td><td>{item.is_destructive ? <span className="text-red-700">Destrutivo</span> : 'Operacional'}</td><td>{formatDate(item.requested_at)}</td></tr>)}</tbody></table></section>

      {selected && <Modal title="Enviar comando MDM mock" description={`${selected.device?.model} · SN ${selected.device?.serial_number}`} onClose={() => setSelected(null)}><form className="space-y-5" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
        {mutation.error && <ErrorState error={mutation.error} />}
        <label className="form-field"><span>Comando</span><select className="input" value={command} onChange={(event) => setCommand(event.target.value as typeof command)}>{commands.map((item) => <option key={item.key} value={item.key}>{item.label}{item.destructive ? ' · destrutivo' : ''}</option>)}</select></label>
        <label className="form-field"><span>Motivo operacional *</span><textarea className="input min-h-24" minLength={selectedCommand.destructive ? 10 : 3} required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        {selectedCommand.destructive && <div className="space-y-4 rounded-2xl border border-red-200 bg-red-50 p-4"><p className="flex items-start gap-2 text-sm font-bold text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Comando destrutivo: exige administrador, senha atual, motivo e confirmacao do serial.</p><label className="form-field"><span>Digite o serial completo</span><input className="input font-mono uppercase" value={serial} onChange={(event) => setSerial(event.target.value)} /></label><label className="form-field"><span>Senha atual para reautenticacao</span><input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label></div>}
        <div className="flex justify-end gap-3 border-t border-slate-200 pt-5"><button className="btn-secondary" type="button" onClick={() => setSelected(null)}>Cancelar</button><button className={selectedCommand.destructive ? 'btn-danger' : 'btn-primary'} disabled={mutation.isPending || (selectedCommand.destructive && profile.role !== 'admin')} type="submit">{command === 'sync' ? <RefreshCw className="h-4 w-4" /> : command === 'lock' ? <LockKeyhole className="h-4 w-4" /> : <Play className="h-4 w-4" />}{mutation.isPending ? 'Processando...' : 'Registrar comando mock'}</button></div>
      </form></Modal>}
    </div>
  );
}
