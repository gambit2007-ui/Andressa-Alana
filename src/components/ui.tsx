import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, LoaderCircle, X } from 'lucide-react';

export function PageHeader({ eyebrow, title, description, action }: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="min-w-0">
        {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-subtitle max-w-2xl">{description}</p>}
      </div>
      {action && <div className="page-header-action">{action}</div>}
    </header>
  );
}

export function Modal({ title, description, children, onClose }: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="flex items-start justify-between border-b border-slate-200/80 px-5 py-4 sm:px-7 sm:py-5">
          <div>
            <h2 className="font-display text-2xl text-slate-950">{title}</h2>
            {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-xl p-2.5 text-slate-500 transition hover:bg-slate-200"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[78vh] overflow-y-auto p-5 sm:p-7">{children}</div>
      </div>
    </div>
  );
}

export function LoadingState({ label = 'Carregando dados...' }: { label?: string }) {
  return <div className="panel grid min-h-48 place-items-center text-sm font-semibold text-slate-500"><span className="flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin text-cyan-600" />{label}</span></div>;
}

export function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Falha inesperada ao carregar os dados.';
  return <div className="alert alert-error flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{message}</span></div>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="panel grid min-h-52 place-items-center p-8 text-center">
      <div>
        <Inbox className="mx-auto h-9 w-9 text-slate-300" />
        <p className="mt-3 font-bold text-slate-700">{title}</p>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
    </div>
  );
}
