import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  BarChart3,
  Boxes,
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
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 py-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-400/15">
            <span className="font-display text-lg">GR</span>
          </div>
          <div>
            <p className="font-display text-xl leading-none text-white">GR Solution</p>
            <p className="mt-1 text-[9px] font-extrabold uppercase tracking-[0.24em] text-cyan-300">Rental</p>
          </div>
        </div>
        {close && <button type="button" onClick={close} className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button>}
      </div>

      <div className="px-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <p className="truncate text-xs font-bold text-slate-200">{organizationName}</p>
          <div className="mt-2 flex items-center gap-2 text-[10px] text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Operacao online
          </div>
        </div>
      </div>

      <nav className="mt-6 flex-1 space-y-1 overflow-y-auto px-3">
        {navigation.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={close}
            className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-semibold transition ${
              isActive ? 'bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-400/10' : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3 rounded-2xl bg-white/[0.04] p-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-800 text-sm font-extrabold text-cyan-300">
            {profile.full_name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-white">{profile.full_name}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">{roleLabel[profile.role]}</p>
          </div>
          <button type="button" onClick={() => void signOut()} title="Sair" className="rounded-lg p-2 text-slate-400 hover:bg-red-500/10 hover:text-red-300">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-68 bg-slate-950 lg:block">
        <SidebarContent />
      </aside>

      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-stone-50/90 px-4 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2">
          <Boxes className="h-5 w-5 text-cyan-700" />
          <span className="font-display text-xl text-slate-950">GR Solution Rental</span>
        </div>
        <button type="button" onClick={() => setMenuOpen(true)} className="rounded-xl border border-slate-300 bg-white p-2.5 text-slate-700">
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
              className="fixed inset-y-0 left-0 z-50 w-[min(86vw,300px)] bg-slate-950 lg:hidden"
            >
              <SidebarContent close={() => setMenuOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className="min-h-screen lg:ml-68">
        <div className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8 xl:p-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
