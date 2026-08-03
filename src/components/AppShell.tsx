import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  BarChart3,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  Smartphone,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useAuth } from '../AuthGate';
import type { AppRole } from '../types';

const roleLabel: Record<AppRole, string> = {
  admin: 'Administrador',
  manager: 'Gestor',
  finance: 'Financeiro',
  operator: 'Operador',
  viewer: 'Leitura',
};

const navigation = [
  { to: '/', label: 'Visao geral', icon: LayoutDashboard },
  { to: '/devices', label: 'Frota de iPhones', icon: Smartphone },
  { to: '/clients', label: 'Clientes', icon: Users },
  { to: '/contracts', label: 'Contratos', icon: FileText },
  { to: '/finance', label: 'Financeiro', icon: WalletCards },
  { to: '/profitability', label: 'Rentabilidade', icon: BarChart3 },
  { to: '/mdm', label: 'Apple & MDM', icon: ShieldCheck },
  { to: '/audit', label: 'Auditoria', icon: ClipboardList },
] as const;

function SidebarContent({ close }: { close?: () => void }) {
  const { profile, signOut } = useAuth();
  const organizationName = profile.organization?.name ?? 'GR Solution';

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute -right-16 top-20 h-40 w-40 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="relative flex items-center justify-between px-5 py-6">
        <div className="flex items-center gap-3">
          <div className="brand-mark">
            <span className="font-display text-lg">GR</span>
          </div>
          <div>
            <p className="font-display text-xl leading-none text-white">GR Solution</p>
            <p className="mt-1 text-[9px] font-extrabold uppercase tracking-[0.3em] text-amber-200">Rental</p>
          </div>
        </div>
        {close && <button type="button" onClick={close} aria-label="Fechar menu" className="rounded-xl p-2.5 text-slate-400 transition hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button>}
      </div>

      <div className="relative px-4">
        <div className="sidebar-organization">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,.1)]" />
          <p className="truncate text-xs font-bold text-slate-200">{organizationName}</p>
        </div>
      </div>

      <nav className="relative mt-6 flex-1 space-y-1 overflow-y-auto px-3" aria-label="Navegacao principal">
        {navigation.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={close}
            className={({ isActive }) => `sidebar-nav-link ${isActive ? 'is-active' : ''}`}
          >
            <item.icon className="h-[18px] w-[18px]" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="relative border-t border-white/[0.08] p-4">
        <div className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.04] p-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-200/10 text-sm font-extrabold text-amber-200">
            {profile.full_name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-white">{profile.full_name}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">{roleLabel[profile.role]}</p>
          </div>
          <button type="button" onClick={() => void signOut()} title="Sair" aria-label="Sair" className="rounded-lg p-2.5 text-slate-400 transition hover:bg-red-500/10 hover:text-red-300">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const currentSection = navigation.find((item) => item.to === '/'
    ? location.pathname === '/'
    : location.pathname.startsWith(item.to));

  return (
    <div className="min-h-screen">
      <aside className="app-sidebar fixed inset-y-0 left-0 z-40 hidden w-72 lg:block">
        <SidebarContent />
      </aside>

      <header className="mobile-topbar lg:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <div className="brand-mark brand-mark-mobile"><span className="font-display text-sm">GR</span></div>
          <div className="min-w-0">
            <p className="truncate font-display text-lg leading-none text-slate-950">GR Solution</p>
            <p className="mt-1 truncate text-[9px] font-extrabold uppercase tracking-[0.18em] text-slate-500">{currentSection?.label ?? 'Rental'}</p>
          </div>
        </div>
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="Abrir menu" className="rounded-xl border border-slate-200/80 bg-white/80 p-2.5 text-slate-700 shadow-sm">
          <Menu className="h-5 w-5" />
        </button>
      </header>

      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.button
              type="button"
              aria-label="Fechar menu"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="app-sidebar fixed inset-y-0 left-0 z-50 w-[min(88vw,320px)] lg:hidden"
            >
              <SidebarContent close={() => setMenuOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className="min-h-screen lg:ml-72">
        <div className="mx-auto w-full max-w-[1520px] px-4 py-5 sm:px-6 sm:py-7 lg:p-9 xl:p-11">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="app-page"
          >
            <Outlet />
          </motion.div>
        </div>
      </main>

    </div>
  );
}
