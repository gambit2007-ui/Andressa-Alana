import { useQuery } from '@tanstack/react-query';
import { Braces, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../AuthGate';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import { listAuditLogs } from '../../repositories/rentalRepository';
import { formatDate } from '../../utils/formatters';

export default function AuditPage() {
  const { profile } = useAuth();
  const allowed = ['admin', 'manager'].includes(profile.role);
  const query = useQuery({ queryKey: ['audit-logs'], queryFn: listAuditLogs, enabled: allowed });

  if (!allowed) return <div className="space-y-7"><PageHeader eyebrow="Governanca" title="Auditoria" /><div className="alert border-amber-200 bg-amber-50 text-amber-800"><ShieldCheck className="mr-2 inline h-4 w-4" />Seu perfil nao possui permissao para consultar logs de auditoria.</div></div>;
  if (query.isLoading) return <LoadingState />;

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Governanca e rastreabilidade" title="Auditoria" />
      {query.error && <ErrorState error={query.error} />}
      {(query.data?.length ?? 0) === 0 ? <EmptyState title="Nenhum evento auditado" description="Os eventos surgirao apos alteracoes nas tabelas criticas." /> : <div className="table-shell overflow-x-auto"><table className="min-w-[880px]"><thead><tr><th>Data</th><th>Acao</th><th>Tabela</th><th>Registro</th><th>Usuario</th><th>Dados</th></tr></thead><tbody>{query.data?.map((item) => <tr key={item.id}><td>{formatDate(item.created_at)}</td><td><span className="status-pill bg-cyan-50 text-cyan-700">{item.action}</span></td><td className="font-mono font-bold">{item.table_name}</td><td className="font-mono text-xs">{item.record_id?.slice(0, 8) ?? '-'}</td><td className="font-mono text-xs">{item.actor_id?.slice(0, 8) ?? 'sistema'}</td><td><span className="inline-flex items-center gap-1 text-xs text-slate-500"><Braces className="h-3.5 w-3.5" />JSON auditado</span></td></tr>)}</tbody></table></div>}
    </div>
  );
}
