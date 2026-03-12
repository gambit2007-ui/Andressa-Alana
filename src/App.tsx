import React, { useEffect, useMemo, useState } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useNavigate,
  useLocation,
  useParams,
} from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Calendar,
  Sparkles,
  Plus,
  Search,
  ChevronRight,
  Clock,
  Phone,
  Mail,
  CalendarDays,
  CheckCircle2,
  XCircle,
  Trash2,
  ArrowLeft,
  DollarSign,
  BarChart3,
  Receipt,
  Upload,
  X,
  Wallet,
  FileText,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Types
interface UploadAsset {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

interface Client {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  notes: string | null;
  profile_photo?: string | null;
  attachments?: UploadAsset[];
  created_at: string;
}

interface Procedure {
  id: number;
  name: string;
  description: string | null;
  price: number;
  duration: number;
  cover_photo?: string | null;
  attachments?: UploadAsset[];
}

interface Appointment {
  id: number;
  client_id: number;
  procedure_id: number;
  appointment_date: string;
  appointment_time: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  notes: string | null;
  client_name?: string;
  procedure_name?: string;
}

interface DashboardStats {
  todayAppointments: number;
  totalClients: number;
  pendingAppointments: number;
}

interface ClientDetails extends Client {
  appointments: Appointment[];
}

interface Expense {
  id: number;
  description: string;
  category: string | null;
  amount: number;
  expense_date: string;
  notes: string | null;
  created_at: string;
}

interface FinanceProcedure {
  name: string;
  value: number;
  count: number;
}

interface DailyPerformance {
  date: string;
  day: number;
  total: number;
  expenses?: number;
}

interface FinanceDetails {
  monthlyTotal: number;
  monthlyExpenses: number;
  netTotal: number;
  byProcedure: FinanceProcedure[];
  appointmentCount: number;
  dailyPerformance: DailyPerformance[];
}

interface FinanceMonth {
  id: string;
  label: string;
  revenue: number;
  expenses: number;
  net: number;
  appointmentCount: number;
}

interface FinanceSummary {
  caixaGeral: number;
  totalReceitas: number;
  totalDespesas: number;
  mesAtual: string;
  faturamentoMes: number;
  despesasMes: number;
  saldoMes: number;
  totalAtendimentosMes: number;
}

interface FinanceHistoryResponse {
  year: number;
  history: FinanceMonth[];
  summary: FinanceSummary;
}

type ApiErrorResponse = {
  error?: string;
  message?: string;
};

const getLocalDateKey = (date = new Date()): string => format(date, 'yyyy-MM-dd');
const getLocalMonthKey = (date = new Date()): string => format(date, 'yyyy-MM');

const MAX_ASSETS = 12;

const formatMoney = (value: number): string =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);

const fileToAsset = (file: File): Promise<UploadAsset> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Falha ao ler o arquivo ${file.name}.`));
        return;
      }

      resolve({
        id:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl: reader.result,
      });
    };
    reader.onerror = () => reject(new Error(`Falha ao ler o arquivo ${file.name}.`));
    reader.readAsDataURL(file);
  });

const loadAssets = async (fileList: FileList | null): Promise<UploadAsset[]> => {
  if (!fileList || fileList.length === 0) {
    return [];
  }

  const files = Array.from(fileList).slice(0, MAX_ASSETS);
  return Promise.all(files.map((file) => fileToAsset(file)));
};
const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Erro inesperado. Tente novamente.';

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

  if (!response.ok) {
    let message = `Erro ${response.status}`;
    if (contentType.includes('application/json')) {
      try {
        const payload = (await response.json()) as ApiErrorResponse;
        message = payload.error ?? payload.message ?? message;
      } catch {
        // Ignore parse errors and keep fallback status message.
      }
    }
    throw new Error(message);
  }

  if (!contentType.includes('application/json')) {
    throw new Error('Resposta invalida da API. Verifique se as rotas /api estao configuradas no deploy.');
  }

  return (await response.json()) as T;
}

// Components
const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Painel', path: '/' },
  { icon: Calendar, label: 'Agenda', path: '/agenda' },
  { icon: Users, label: 'Clientes', path: '/clientes' },
  { icon: Sparkles, label: 'Procedimentos', path: '/procedimentos' },
  { icon: Receipt, label: 'Despesas', path: '/despesas' },
  { icon: Wallet, label: 'Finan\u00e7as', path: '/financas' },
] as const;

const Sidebar = () => {
  const location = useLocation();
  return (
    <div className="hidden lg:flex lg:w-72 bg-white border-r border-brand-200 h-screen sticky top-0 flex-col p-6">
      <div className="mb-10">
        <h1 className="text-3xl font-serif font-bold text-brand-700 flex items-center gap-2">
          <Sparkles className="w-8 h-8 text-brand-500" />
          Andressa Alana
        </h1>
        <p className="text-xs text-brand-400 uppercase tracking-widest mt-1 font-medium">GestÃ£o de EstÃ©tica</p>
      </div>

      <nav className="flex-1 space-y-2">
        {NAV_ITEMS.map((item) => {
          const isActive = item.path === '/'
            ? location.pathname === '/'
            : location.pathname === item.path || location.pathname.startsWith(
              `${item.path}/`,
            );
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-200 group',
                isActive
                  ? 'bg-brand-700 text-white shadow-lg shadow-brand-700/20'
                  : 'text-brand-500 hover:bg-brand-100 hover:text-brand-700',
              )}
            >
              <item.icon
                className={cn(
                  'w-5 h-5',
                  isActive ? 'text-white' : 'text-brand-400 group-hover:text-brand-700',
                )}
              />
              <span className="font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto p-4 bg-brand-100 rounded-2xl">
        <p className="text-xs text-brand-500 font-medium">Logado como</p>
        <p className="text-sm font-bold text-brand-800">Admin Estetica</p>
      </div>
    </div>
  );
};

const MobileBottomNav = () => {
  const location = useLocation();

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-brand-200 bg-white/95 backdrop-blur">
      <div className="grid grid-cols-6 px-1 py-2">
        {NAV_ITEMS.map((item) => {
          const isActive = item.path === '/'
            ? location.pathname === '/'
            : location.pathname === item.path || location.pathname.startsWith(
              `${item.path}/`,
            );

          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex flex-col items-center justify-center gap-1 rounded-xl py-2 text-[10px] font-semibold transition-colors',
                isActive
                  ? 'bg-brand-700 text-white'
                  : 'text-brand-500 hover:bg-brand-100 hover:text-brand-700',
              )}
            >
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

const Dashboard = () => {
  const [stats, setStats] = useState<DashboardStats>({ todayAppointments: 0, totalClients: 0, pendingAppointments: 0 });
  const [todayAppointments, setTodayAppointments] = useState<Appointment[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadDashboard = async () => {
      try {
        const today = getLocalDateKey();
        const [statsData, appointmentsData] = await Promise.all([
          apiFetch<DashboardStats>('/api/stats'),
          apiFetch<Appointment[]>(`/api/appointments?date=${encodeURIComponent(today)}`),
        ]);

        if (!mounted) {
          return;
        }

        setStats(statsData);
        setTodayAppointments(appointmentsData);
        setError(null);
      } catch (err) {
        if (!mounted) {
          return;
        }
        setError(getErrorMessage(err));
      }
    };

    void loadDashboard();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-3xl sm:text-4xl font-serif font-bold text-brand-900">Bem-vinda de volta!</h2>
        <p className="text-brand-500">Aqui estÃ¡ o resumo do seu dia hoje, {format(new Date(), "dd 'de' MMMM", { locale: ptBR })}.</p>
      </header>

      {error && (
        <div className="glass-card p-4 text-sm font-medium text-red-700 bg-red-50 border-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: 'Agendamentos Hoje', value: stats.todayAppointments, icon: Calendar, color: 'bg-blue-50 text-blue-600' },
          { label: 'Total de Clientes', value: stats.totalClients, icon: Users, color: 'bg-brand-100 text-brand-700' },
          { label: 'Pendentes', value: stats.pendingAppointments, icon: Clock, color: 'bg-amber-50 text-amber-600' },
        ].map((stat, i) => (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            key={stat.label}
            className="glass-card p-6 flex items-center gap-4"
          >
            <div className={cn("p-4 rounded-2xl", stat.color)}>
              <stat.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-brand-500 font-medium">{stat.label}</p>
              <p className="text-3xl font-serif font-bold text-brand-900">{stat.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="glass-card p-8">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-2xl font-serif font-bold">PrÃ³ximos atendimentos</h3>
            <Link to="/agenda" className="text-brand-500 hover:text-brand-700 text-sm font-medium flex items-center gap-1">
              Ver agenda completa <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="space-y-4">
            {todayAppointments.length === 0 ? (
              <div className="text-center py-10 text-brand-400">
                <CalendarDays className="w-12 h-12 mx-auto mb-2 opacity-20" />
                <p>Nenhum agendamento para hoje.</p>
              </div>
            ) : (
              todayAppointments.map((apt) => (
                <div key={apt.id} className="flex items-center gap-4 p-4 rounded-2xl hover:bg-brand-50 transition-colors border border-transparent hover:border-brand-200">
                  <div className="w-16 text-center">
                    <p className="text-lg font-bold text-brand-900">{apt.appointment_time}</p>
                    <p className="text-xs text-brand-400 uppercase font-bold">Hoje</p>
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-brand-800">{apt.client_name}</p>
                    <p className="text-sm text-brand-500">{apt.procedure_name}</p>
                  </div>
                  <div className={cn(
                    "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
                    apt.status === 'scheduled' ? "bg-blue-100 text-blue-700" :
                    apt.status === 'completed' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                  )}>
                    {apt.status === 'scheduled' ? 'Agendado' : apt.status === 'completed' ? 'ConcluÃ­do' : 'Cancelado'}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="glass-card p-8">
          <h3 className="text-2xl font-serif font-bold mb-6">AÃ§Ãµes rÃ¡pidas</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Link to="/agenda" className="p-6 rounded-3xl bg-brand-700 text-white hover:bg-brand-800 transition-all flex flex-col items-center gap-3 text-center">
              <Plus className="w-8 h-8" />
              <span className="font-medium">Novo Agendamento</span>
            </Link>
            <Link to="/clientes" className="p-6 rounded-3xl border-2 border-brand-200 text-brand-700 hover:border-brand-700 transition-all flex flex-col items-center gap-3 text-center">
              <Users className="w-8 h-8" />
              <span className="font-medium">Cadastrar Cliente</span>
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
};

const Clients = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newClient, setNewClient] = useState({
    name: '',
    phone: '',
    email: '',
    birth_date: '',
    notes: '',
    profilePhoto: null as UploadAsset | null,
    attachments: [] as UploadAsset[],
  });

  const fetchClients = async () => {
    try {
      const data = await apiFetch<Client[]>('/api/clients');
      setClients(data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  useEffect(() => {
    void fetchClients();
  }, []);

  const filteredClients = clients.filter(
    (c) => c.name.toLowerCase().includes(search.toLowerCase()) || (c.phone ?? '').includes(search),
  );

  const handleProfilePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const assets = await loadAssets(event.target.files);
      setNewClient((prev) => ({ ...prev, profilePhoto: assets[0] ?? null }));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleAttachments = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const assets = await loadAssets(event.target.files);
      setNewClient((prev) => ({
        ...prev,
        attachments: [...prev.attachments, ...assets].slice(0, MAX_ASSETS),
      }));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const removeAttachment = (assetId: string) => {
    setNewClient((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((asset) => asset.id !== assetId),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      await apiFetch<{ id: number }>('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newClient.name,
          phone: newClient.phone,
          email: newClient.email,
          birth_date: newClient.birth_date,
          notes: newClient.notes,
          profile_photo: newClient.profilePhoto?.dataUrl ?? null,
          attachments: newClient.attachments,
        }),
      });
      setIsModalOpen(false);
      setNewClient({
        name: '',
        phone: '',
        email: '',
        birth_date: '',
        notes: '',
        profilePhoto: null,
        attachments: [],
      });
      await fetchClients();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClient = async (client: Client) => {
    const confirmed = window.confirm(
      `Excluir cliente "${client.name}"? Esta aÃ§Ã£o remove tambÃ©m os agendamentos desse cliente.`,
    );
    if (!confirmed) return;

    try {
      await apiFetch<{ success: boolean }>(`/api/clients-delete?id=${encodeURIComponent(String(client.id))}`, {
        method: 'DELETE',
      });
      await fetchClients();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
        <div>
          <h2 className="text-3xl sm:text-4xl font-serif font-bold text-brand-900">Clientes</h2>
          <p className="text-brand-500">Gerencie sua base de clientes e histÃ³ricos.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-brand-700 text-white px-6 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 w-full sm:w-auto hover:bg-brand-800 transition-all shadow-lg shadow-brand-700/20"
        >
          <Plus className="w-5 h-5" />
          Novo cliente
        </button>
      </header>

      {error && (
        <div className="glass-card p-4 text-sm font-medium text-red-700 bg-red-50 border-red-200">
          {error}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Buscar por nome ou telefone..."
          className="w-full pl-12 pr-4 py-4 bg-white border border-brand-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence>
          {filteredClients.map((client) => (
            <motion.div
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              key={client.id}
              className="glass-card p-6 group hover:border-brand-500 transition-all cursor-pointer"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="w-12 h-12 rounded-full bg-brand-100 overflow-hidden flex items-center justify-center text-brand-700 font-serif text-xl font-bold">
                  {client.profile_photo ? (
                    <img src={client.profile_photo} alt={client.name} className="w-full h-full object-cover" />
                  ) : (
                    client.name.charAt(0)
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteClient(client)}
                  className="text-red-400 hover:text-red-600 transition-colors"
                  title="Excluir cliente"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
              <h4 className="text-xl font-bold text-brand-900 mb-1">{client.name}</h4>
              <div className="space-y-2 text-sm text-brand-500">
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4" /> {client.phone || 'NÃ£o informado'}
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4" /> {client.email || 'NÃ£o informado'}
                </div>
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4" /> {client.attachments?.length ?? 0} arquivo(s)
                </div>
              </div>
              <div className="mt-6 pt-4 border-t border-brand-100 flex justify-between items-center">
                <span className="text-xs text-brand-400 font-medium">Cadastrado em {format(parseISO(client.created_at), 'dd/MM/yy')}</span>
                <Link to={`/clientes/${client.id}`} className="text-brand-700 font-bold text-sm flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  Ver perfil <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-brand-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-brand-100">
                <h3 className="text-2xl font-serif font-bold">Novo cliente</h3>
                <p className="text-brand-500">Preencha os dados e adicione foto/arquivos no cadastro.</p>
              </div>
              <form onSubmit={handleSubmit} className="p-8 space-y-4">
                <div>
                  <label className="block text-sm font-bold text-brand-700 mb-1">Nome completo *</label>
                  <input
                    required
                    type="text"
                    className="w-full px-4 py-3 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                    value={newClient.name}
                    onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-brand-700 mb-1">Telefone</label>
                    <input
                      type="text"
                      className="w-full px-4 py-3 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                      value={newClient.phone}
                      onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-brand-700 mb-1">Data de nascimento</label>
                    <input
                      type="date"
                      className="w-full px-4 py-3 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                      value={newClient.birth_date}
                      onChange={(e) => setNewClient({ ...newClient, birth_date: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold text-brand-700 mb-1">E-mail</label>
                  <input
                    type="email"
                    className="w-full px-4 py-3 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                    value={newClient.email}
                    onChange={(e) => setNewClient({ ...newClient, email: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-brand-700 mb-1">Foto de perfil</label>
                    <label className="flex items-center gap-2 px-4 py-3 border border-dashed border-brand-300 rounded-xl cursor-pointer hover:bg-brand-50 transition-colors">
                      <Upload className="w-4 h-4 text-brand-500" />
                      <span className="text-sm text-brand-600">Selecionar imagem</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handleProfilePhoto} />
                    </label>
                    {newClient.profilePhoto && (
                      <img
                        src={newClient.profilePhoto.dataUrl}
                        alt="PrÃ©via do perfil"
                        className="mt-2 w-20 h-20 object-cover rounded-xl border border-brand-200"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-brand-700 mb-1">Arquivos e fotos</label>
                    <label className="flex items-center gap-2 px-4 py-3 border border-dashed border-brand-300 rounded-xl cursor-pointer hover:bg-brand-50 transition-colors">
                      <Upload className="w-4 h-4 text-brand-500" />
                      <span className="text-sm text-brand-600">Adicionar arquivos</span>
                      <input type="file" multiple className="hidden" onChange={handleAttachments} />
                    </label>
                    <div className="mt-2 space-y-1 max-h-24 overflow-y-auto pr-1">
                      {newClient.attachments.map((asset) => (
                        <div key={asset.id} className="flex items-center justify-between text-xs bg-brand-50 border border-brand-100 rounded-lg px-2 py-1">
                          <span className="truncate max-w-[180px]">{asset.name}</span>
                          <button type="button" onClick={() => removeAttachment(asset.id)}>
                            <X className="w-3.5 h-3.5 text-brand-500" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-brand-700 mb-1">ObservaÃ§Ãµes</label>
                  <textarea
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                    value={newClient.notes}
                    onChange={(e) => setNewClient({ ...newClient, notes: e.target.value })}
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-6 py-3 rounded-xl font-bold text-brand-500 hover:bg-brand-50 transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex-1 px-6 py-3 rounded-xl font-bold bg-brand-700 text-white hover:bg-brand-800 transition-all shadow-lg shadow-brand-700/20 disabled:opacity-70"
                  >
                    {isSaving ? 'Salvando...' : 'Salvar cliente'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Agenda = () => {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedDate, setSelectedDate] = useState(getLocalDateKey());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newApt, setNewApt] = useState({ client_id: '', procedure_id: '', appointment_date: getLocalDateKey(), appointment_time: '', notes: '' });

  const fetchAppointments = async () => {
    try {
      const data = await apiFetch<Appointment[]>(`/api/appointments?date=${encodeURIComponent(selectedDate)}`);
      setAppointments(data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  useEffect(() => {
    void fetchAppointments();
  }, [selectedDate]);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [clientData, procedureData] = await Promise.all([
          apiFetch<Client[]>('/api/clients'),
          apiFetch<Procedure[]>('/api/procedures')
        ]);
        setClients(clientData);
        setProcedures(procedureData);
      } catch (err) {
        setError(getErrorMessage(err));
      }
    };

    void loadInitialData();
  }, []);

  useEffect(() => {
    setNewApt((prev) => ({ ...prev, appointment_date: selectedDate }));
  }, [selectedDate]);

  const handleStatusUpdate = async (id: number, status: Appointment['status']) => {
    try {
      await apiFetch<{ success: boolean }>(`/api/appointments-update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status })
      });
      await fetchAppointments();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleDeleteAppointment = async (appointment: Appointment) => {
    const confirmed = window.confirm(
      `Excluir agendamento de ${appointment.client_name} Ã s ${appointment.appointment_time}?`,
    );
    if (!confirmed) return;

    try {
      await apiFetch<{ success: boolean }>(`/api/appointments-delete?id=${encodeURIComponent(String(appointment.id))}`, {
        method: 'DELETE',
      });
      await fetchAppointments();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await apiFetch<{ id: number }>('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newApt,
          client_id: Number(newApt.client_id),
          procedure_id: Number(newApt.procedure_id)
        })
      });
      setIsModalOpen(false);
      setNewApt({ client_id: '', procedure_id: '', appointment_date: selectedDate, appointment_time: '', notes: '' });
      await fetchAppointments();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
        <div>
          <h2 className="text-3xl sm:text-4xl font-serif font-bold text-brand-900">Agenda</h2>
          <p className="text-brand-500">Organize seus atendimentos diÃ¡rios.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-brand-700 text-white px-6 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 w-full sm:w-auto hover:bg-brand-800 transition-all shadow-lg shadow-brand-700/20"
        >
          <Plus className="w-5 h-5" />
          Novo Agendamento
        </button>
      </header>

      {error && (
        <div className="glass-card p-4 text-sm font-medium text-red-700 bg-red-50 border-red-200">
          {error}
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
        {Array.from({ length: 14 }).map((_, i) => {
          const date = new Date();
          date.setDate(date.getDate() + i - 3); // Show some past days too
          const dateStr = getLocalDateKey(date);
          const isActive = selectedDate === dateStr;
          return (
            <button
              key={dateStr}
              onClick={() => setSelectedDate(dateStr)}
              className={cn(
                "flex flex-col items-center min-w-[80px] p-4 rounded-2xl transition-all",
                isActive ? "bg-brand-700 text-white shadow-lg shadow-brand-700/20" : "bg-white text-brand-500 hover:bg-brand-100"
              )}
            >
              <span className="text-xs font-bold uppercase tracking-widest mb-1">{format(date, 'EEE', { locale: ptBR })}</span>
              <span className="text-2xl font-serif font-bold">{format(date, 'dd')}</span>
            </button>
          );
        })}
      </div>

      <div className="glass-card overflow-hidden">
        <div className="p-6 border-b border-brand-100 bg-brand-50/50">
          <h3 className="font-bold text-brand-800 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-brand-500" />
            {format(parseISO(selectedDate), "EEEE, dd 'de' MMMM", { locale: ptBR })}
          </h3>
        </div>

        <div className="divide-y divide-brand-100">
          {appointments.length === 0 ? (
            <div className="p-20 text-center text-brand-400">
              <Clock className="w-12 h-12 mx-auto mb-2 opacity-20" />
              <p>Nenhum agendamento para este dia.</p>
            </div>
          ) : (
            appointments.map((apt) => (
              <div key={apt.id} className="p-6 flex items-center gap-6 hover:bg-brand-50/50 transition-colors">
                <div className="w-20 text-center">
                  <p className="text-2xl font-serif font-bold text-brand-900">{apt.appointment_time}</p>
                </div>
                <div className="flex-1">
                  <p className="text-lg font-bold text-brand-900">{apt.client_name}</p>
                  <p className="text-brand-500 flex items-center gap-1">
                    <Sparkles className="w-4 h-4" /> {apt.procedure_name}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {apt.status === 'scheduled' && (
                    <>
                      <button
                        onClick={() => handleStatusUpdate(apt.id, 'completed')}
                        className="p-2 rounded-xl text-green-600 hover:bg-green-50 transition-colors" title="Concluir">
                        <CheckCircle2 className="w-6 h-6" />
                      </button>
                      <button
                        onClick={() => handleStatusUpdate(apt.id, 'cancelled')}
                        className="p-2 rounded-xl text-red-600 hover:bg-red-50 transition-colors" title="Cancelar">
                        <XCircle className="w-6 h-6" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleDeleteAppointment(apt)}
                    className="p-2 rounded-xl text-red-500 hover:bg-red-50 transition-colors"
                    title="Excluir agendamento"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  <div className={cn(
                    "px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider",
                    apt.status === 'scheduled' ? "bg-blue-100 text-blue-700" :
                    apt.status === 'completed' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                  )}>
                    {apt.status === 'scheduled' ? 'Agendado' : apt.status === 'completed' ? 'ConcluÃ­do' : 'Cancelado'}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modal Novo Agendamento */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsModalOpen(false)} className="absolute inset-0 bg-brand-900/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
              <div className="p-8 border-b border-brand-100">
                <h3 className="text-2xl font-serif font-bold">Novo Agendamento</h3>
                <p className="text-brand-500">Marque um novo horÃ¡rio para sua cliente.</p>
              </div>
              <form onSubmit={handleSubmit} className="p-8 space-y-4">
                <div>
                  <label className="block text-sm font-bold text-brand-700 mb-1">Cliente *</label>
                  <select
                    required
                    className="w-full px-4 py-3 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none bg-white"
                    value={newApt.client_id}
                    onChange={e => setNewApt({ ...newApt, client_id: e.target.value })}
                  >
                    <option value="">Selecione uma cliente</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-brand-700 mb-1">Procedimento *</label>
                  <select
                    required
                    className="w-full px-4 py-3 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none bg-white"
                    value={newApt.procedure_id}
                    onChange={e => setNewApt({ ...newApt, procedure_id: e.target.value })}
                  >
                    <option value="">Selecione um procedimento</option>
                    {procedures.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-brand-700 mb-1">Data *</label>
                    <input
                      required
                      type="date"
                      className="w-full px-4 py-3 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                      value={newApt.appointment_date}
                      onChange={e => setNewApt({ ...newApt, appointment_date: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-brand-700 mb-1">HorÃ¡rio *</label>
                    <input
                      required
                      type="time"
                      className="w-full px-4 py-3 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                      value={newApt.appointment_time}
                      onChange={e => setNewApt({ ...newApt, appointment_time: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold text-brand-700 mb-1">Notas</label>
                  <textarea
                    rows={2}
                    className="w-full px-4 py-3 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                    value={newApt.notes}
                    onChange={e => setNewApt({ ...newApt, notes: e.target.value })}
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 px-6 py-3 rounded-xl font-bold text-brand-500 hover:bg-brand-50 transition-all">Cancelar</button>
                  <button type="submit" className="flex-1 px-6 py-3 rounded-xl font-bold bg-brand-700 text-white hover:bg-brand-800 transition-all shadow-lg shadow-brand-700/20">Agendar</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Procedures = () => {
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [newProc, setNewProc] = useState({
    name: '',
    description: '',
    price: '',
    duration: '',
    coverPhoto: null as UploadAsset | null,
    attachments: [] as UploadAsset[],
  });

  const fetchProcedures = async () => {
    try {
      const data = await apiFetch<Procedure[]>('/api/procedures');
      setProcedures(data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  useEffect(() => {
    void fetchProcedures();
  }, []);

  const handleCoverPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const assets = await loadAssets(event.target.files);
      setNewProc((prev) => ({ ...prev, coverPhoto: assets[0] ?? null }));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleAttachments = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const assets = await loadAssets(event.target.files);
      setNewProc((prev) => ({
        ...prev,
        attachments: [...prev.attachments, ...assets].slice(0, MAX_ASSETS),
      }));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const removeAttachment = (assetId: string) => {
    setNewProc((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((asset) => asset.id !== assetId),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      await apiFetch<{ id: number }>('/api/procedures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProc.name,
          description: newProc.description,
          price: Number(newProc.price),
          duration: Number(newProc.duration),
          cover_photo: newProc.coverPhoto?.dataUrl ?? null,
          attachments: newProc.attachments,
        }),
      });
      setIsModalOpen(false);
      setNewProc({
        name: '',
        description: '',
        price: '',
        duration: '',
        coverPhoto: null,
        attachments: [],
      });
      await fetchProcedures();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProcedure = async (procedure: Procedure) => {
    const confirmed = window.confirm(
      `Excluir procedimento "${procedure.name}"? Agendamentos vinculados tambÃ©m serÃ£o removidos.`,
    );
    if (!confirmed) return;

    try {
      await apiFetch<{ success: boolean }>(`/api/procedures-delete?id=${encodeURIComponent(String(procedure.id))}`, {
        method: 'DELETE',
      });
      await fetchProcedures();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
        <div>
          <h2 className="text-3xl sm:text-4xl font-serif font-bold text-brand-900">Procedimentos</h2>
          <p className="text-brand-500">Cadastre e gerencie seus serviÃ§os com fotos e arquivos.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-brand-700 text-white px-6 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 w-full sm:w-auto hover:bg-brand-800 transition-all shadow-lg shadow-brand-700/20"
        >
          <Plus className="w-5 h-5" />
          Novo procedimento
        </button>
      </header>

      {error && (
        <div className="glass-card p-4 text-sm font-medium text-red-700 bg-red-50 border-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {procedures.map((proc) => (
          <div key={proc.id} className="glass-card p-8 flex flex-col">
            <div className="flex justify-end mb-3">
              <button
                type="button"
                onClick={() => void handleDeleteProcedure(proc)}
                className="p-2 rounded-xl text-red-500 hover:bg-red-50 transition-colors"
                title="Excluir procedimento"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
            <div className="w-full h-36 rounded-2xl bg-brand-100 overflow-hidden mb-6">
              {proc.cover_photo ? (
                <img src={proc.cover_photo} alt={proc.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-brand-500">
                  <Sparkles className="w-8 h-8" />
                </div>
              )}
            </div>
            <h4 className="text-2xl font-serif font-bold text-brand-900 mb-2">{proc.name}</h4>
            <p className="text-brand-500 text-sm mb-6 flex-1">{proc.description || 'Sem descriÃ§Ã£o.'}</p>
            <p className="text-xs text-brand-400 mb-4">Arquivos: {proc.attachments?.length ?? 0}</p>
            <div className="flex justify-between items-end pt-4 border-t border-brand-100">
              <div>
                <p className="text-xs text-brand-400 font-bold uppercase tracking-widest">DuraÃ§Ã£o</p>
                <p className="font-bold text-brand-800">{proc.duration} min</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-brand-400 font-bold uppercase tracking-widest">Valor</p>
                <p className="text-2xl font-serif font-bold text-brand-700">{formatMoney(proc.price)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-brand-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-brand-100">
                <h3 className="text-2xl font-serif font-bold">Novo procedimento</h3>
                <p className="text-brand-500">Adicione foto e anexos do procedimento.</p>
              </div>
              <form onSubmit={handleSubmit} className="p-8 space-y-4">
                <div>
                  <label className="block text-sm font-bold text-brand-700 mb-1">Nome do procedimento *</label>
                  <input
                    required
                    type="text"
                    className="w-full px-4 py-3 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                    value={newProc.name}
                    onChange={(e) => setNewProc({ ...newProc, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-brand-700 mb-1">DescriÃ§Ã£o</label>
                  <textarea
                    rows={2}
                    className="w-full px-4 py-3 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                    value={newProc.description}
                    onChange={(e) => setNewProc({ ...newProc, description: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-brand-700 mb-1">PreÃ§o (R$) *</label>
                    <input
                      required
                      type="number"
                      step="0.01"
                      className="w-full px-4 py-3 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                      value={newProc.price}
                      onChange={(e) => setNewProc({ ...newProc, price: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-brand-700 mb-1">DuraÃ§Ã£o (min) *</label>
                    <input
                      required
                      type="number"
                      className="w-full px-4 py-3 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                      value={newProc.duration}
                      onChange={(e) => setNewProc({ ...newProc, duration: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-brand-700 mb-1">Foto do procedimento</label>
                    <label className="flex items-center gap-2 px-4 py-3 border border-dashed border-brand-300 rounded-xl cursor-pointer hover:bg-brand-50 transition-colors">
                      <Upload className="w-4 h-4 text-brand-500" />
                      <span className="text-sm text-brand-600">Selecionar imagem</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handleCoverPhoto} />
                    </label>
                    {newProc.coverPhoto && (
                      <img
                        src={newProc.coverPhoto.dataUrl}
                        alt="PrÃ©via procedimento"
                        className="mt-2 w-20 h-20 object-cover rounded-xl border border-brand-200"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-brand-700 mb-1">Arquivos e fotos</label>
                    <label className="flex items-center gap-2 px-4 py-3 border border-dashed border-brand-300 rounded-xl cursor-pointer hover:bg-brand-50 transition-colors">
                      <Upload className="w-4 h-4 text-brand-500" />
                      <span className="text-sm text-brand-600">Adicionar arquivos</span>
                      <input type="file" multiple className="hidden" onChange={handleAttachments} />
                    </label>
                    <div className="mt-2 space-y-1 max-h-24 overflow-y-auto pr-1">
                      {newProc.attachments.map((asset) => (
                        <div key={asset.id} className="flex items-center justify-between text-xs bg-brand-50 border border-brand-100 rounded-lg px-2 py-1">
                          <span className="truncate max-w-[180px]">{asset.name}</span>
                          <button type="button" onClick={() => removeAttachment(asset.id)}>
                            <X className="w-3.5 h-3.5 text-brand-500" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex gap-4 pt-4">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 px-6 py-3 rounded-xl font-bold text-brand-500 hover:bg-brand-50 transition-all">Cancelar</button>
                  <button type="submit" disabled={isSaving} className="flex-1 px-6 py-3 rounded-xl font-bold bg-brand-700 text-white hover:bg-brand-800 transition-all shadow-lg shadow-brand-700/20 disabled:opacity-70">{isSaving ? 'Salvando...' : 'Salvar procedimento'}</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const ClientDetail = () => {
  const { id } = useParams();
  const [client, setClient] = useState<ClientDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    const loadClient = async () => {
      if (!id) {
        setError('Cliente invÃ¡lido.');
        setLoading(false);
        return;
      }

      try {
        const data = await apiFetch<ClientDetails>(`/api/client-details?id=${encodeURIComponent(id)}`);
        if (!mounted) {
          return;
        }
        setClient(data);
        setError(null);
      } catch (err) {
        if (!mounted) {
          return;
        }
        setError(getErrorMessage(err));
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadClient();

    return () => {
      mounted = false;
    };
  }, [id]);

  if (loading) return <div className="p-20 text-center">Carregando...</div>;

  if (error || !client) {
    return (
      <div className="space-y-6">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-brand-500 hover:text-brand-700 font-bold">
          <ArrowLeft className="w-5 h-5" /> Voltar
        </button>
        <div className="glass-card p-6 text-red-700 bg-red-50 border-red-200">
          {error ?? 'Cliente nÃ£o encontrado.'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-brand-500 hover:text-brand-700 font-bold">
        <ArrowLeft className="w-5 h-5" /> Voltar
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <div className="glass-card p-8 text-center">
            <div className="w-24 h-24 rounded-full bg-brand-100 overflow-hidden flex items-center justify-center text-brand-700 font-serif text-4xl font-bold mx-auto mb-4">
              {client.profile_photo ? (
                <img src={client.profile_photo} alt={client.name} className="w-full h-full object-cover" />
              ) : (
                client.name.charAt(0)
              )}
            </div>
            <h3 className="text-3xl font-serif font-bold text-brand-900">{client.name}</h3>
            <p className="text-brand-500 mb-6">Cliente desde {format(parseISO(client.created_at), 'MMMM yyyy', { locale: ptBR })}</p>

            <div className="space-y-4 text-left">
              <div className="flex items-center gap-3 p-3 bg-brand-50 rounded-xl">
                <Phone className="w-5 h-5 text-brand-500" />
                <div>
                  <p className="text-xs text-brand-400 font-bold uppercase">Telefone</p>
                  <p className="font-bold text-brand-800">{client.phone || 'NÃ£o informado'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-brand-50 rounded-xl">
                <Mail className="w-5 h-5 text-brand-500" />
                <div>
                  <p className="text-xs text-brand-400 font-bold uppercase">E-mail</p>
                  <p className="font-bold text-brand-800 truncate">{client.email || 'NÃ£o informado'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-brand-50 rounded-xl">
                <Calendar className="w-5 h-5 text-brand-500" />
                <div>
                  <p className="text-xs text-brand-400 font-bold uppercase">AniversÃ¡rio</p>
                  <p className="font-bold text-brand-800">{client.birth_date ? format(parseISO(client.birth_date), 'dd/MM/yyyy') : 'NÃ£o informado'}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-card p-8">
            <h4 className="font-bold text-brand-900 mb-4">ObservaÃ§Ãµes gerais</h4>
            <p className="text-brand-600 text-sm leading-relaxed">{client.notes || 'Nenhuma observaÃ§Ã£o cadastrada.'}</p>
          </div>

          <div className="glass-card p-8">
            <h4 className="font-bold text-brand-900 mb-4">Arquivos do cliente</h4>
            {!client.attachments || client.attachments.length === 0 ? (
              <p className="text-sm text-brand-500">Nenhum arquivo anexado.</p>
            ) : (
              <div className="space-y-2">
                {client.attachments.map((asset) => (
                  <a
                    key={asset.id}
                    href={asset.dataUrl}
                    download={asset.name}
                    className="flex items-center justify-between p-3 text-sm rounded-xl bg-brand-50 border border-brand-100 hover:border-brand-300"
                  >
                    <span className="truncate max-w-[220px]">{asset.name}</span>
                    <Upload className="w-4 h-4 text-brand-500" />
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-8">
          <section className="glass-card p-8">
            <h3 className="text-2xl font-serif font-bold mb-6">HistÃ³rico de atendimentos</h3>
            <div className="space-y-4">
              {client.appointments.length === 0 ? (
                <p className="text-center py-10 text-brand-400 italic">Nenhum atendimento registrado.</p>
              ) : (
                client.appointments.map((apt) => (
                  <div key={apt.id} className="flex items-center gap-4 p-4 rounded-2xl border border-brand-100 hover:bg-brand-50 transition-colors">
                    <div className="w-16 text-center">
                      <p className="text-lg font-bold text-brand-900">{format(parseISO(apt.appointment_date), 'dd/MM')}</p>
                      <p className="text-xs text-brand-400 font-bold">{apt.appointment_time}</p>
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-brand-800">{apt.procedure_name}</p>
                      <p className="text-sm text-brand-500 italic">{apt.notes || 'Sem notas'}</p>
                    </div>
                    <div className={cn(
                      'px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider',
                      apt.status === 'scheduled' ? 'bg-blue-100 text-blue-700' : apt.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700',
                    )}>
                      {apt.status === 'scheduled' ? 'Agendado' : apt.status === 'completed' ? 'ConcluÃ­do' : 'Cancelado'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

const MonthDetails = ({ monthId, revenue }: { monthId: string; revenue: number }) => {
  const [details, setDetails] = useState<FinanceDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadDetails = async () => {
      setLoading(true);
      try {
        const [data, expenseItems] = await Promise.all([
          apiFetch<FinanceDetails>(`/api/finances-details?month=${encodeURIComponent(monthId)}`),
          apiFetch<Expense[]>(`/api/expenses?month=${encodeURIComponent(monthId)}`).catch(() => [] as Expense[]),
        ]);

        const expenseByDate = expenseItems.reduce<Map<string, number>>((acc, expense) => {
          const current = acc.get(expense.expense_date) ?? 0;
          acc.set(expense.expense_date, current + Number(expense.amount ?? 0));
          return acc;
        }, new Map<string, number>());

        const normalizedDailyPerformance = data.dailyPerformance.map((point) => ({
          ...point,
          expenses: Number(point.expenses ?? expenseByDate.get(point.date) ?? 0),
        }));

        const normalizedData: FinanceDetails = {
          ...data,
          dailyPerformance: normalizedDailyPerformance,
        };

        if (!mounted) return;
        setDetails(normalizedData);
        setError(null);
      } catch (err) {
        if (!mounted) return;
        setError(getErrorMessage(err));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadDetails();

    return () => {
      mounted = false;
    };
  }, [monthId]);

  if (loading) return <div className="p-8 text-center text-brand-400 animate-pulse">Carregando detalhes...</div>;

  if (error || !details) {
    return <div className="p-8 text-center text-sm font-medium text-red-700">{error ?? 'Erro ao carregar detalhes do mÃªs.'}</div>;
  }

  return (
    <div className="p-8 bg-brand-50/30 border-t border-brand-100 space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white border border-brand-100">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-500">Faturamento</p>
          <p className="text-xl font-serif font-bold text-brand-900">{formatMoney(details.monthlyTotal)}</p>
        </div>
        <div className="p-4 rounded-2xl bg-white border border-brand-100">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-500">Despesas</p>
          <p className="text-xl font-serif font-bold text-red-700">{formatMoney(details.monthlyExpenses)}</p>
        </div>
        <div className="p-4 rounded-2xl bg-white border border-brand-100">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-500">Saldo</p>
          <p className="text-xl font-serif font-bold text-green-700">{formatMoney(details.netTotal)}</p>
        </div>
        <div className="p-4 rounded-2xl bg-white border border-brand-100">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-500">Atendimentos</p>
          <p className="text-xl font-serif font-bold text-brand-900">{details.appointmentCount}</p>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-bold text-brand-700 uppercase tracking-widest">GrÃ¡fico de desempenho do mÃªs</h4>
        <div className="h-64 bg-white border border-brand-100 rounded-2xl p-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={details.dailyPerformance}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e8e1d5" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value: number) => formatMoney(Number(value))} labelFormatter={(label) => `Dia ${label}`} />
              <Legend />
              <Bar dataKey="total" name="Receitas" fill="#5a5a40" radius={[6, 6, 0, 0]} />
              <Bar dataKey="expenses" name="Despesas" fill="#dc2626" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-bold text-brand-700 uppercase tracking-widest">Faturamento por procedimento</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4">
          {details.byProcedure.length === 0 ? (
            <p className="text-brand-400 italic text-sm">Nenhum atendimento concluÃ­do neste mÃªs.</p>
          ) : (
            details.byProcedure.map((item, i) => {
              const progress = revenue > 0 ? (item.value / revenue) * 100 : 0;
              return (
                <div key={item.name} className="space-y-1">
                  <div className="flex justify-between text-sm font-bold">
                    <span className="text-brand-800">{item.name}</span>
                    <span className="text-brand-500">{formatMoney(item.value)}</span>
                  </div>
                  <div className="w-full bg-brand-100 h-1.5 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.8, delay: i * 0.05 }}
                      className="bg-brand-700 h-full rounded-full"
                    />
                  </div>
                  <p className="text-[10px] text-brand-400 uppercase font-bold tracking-wider">{item.count} atendimento(s)</p>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

const Finances = () => {
  const [data, setData] = useState<FinanceHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadFinances = async () => {
      try {
        const response = await apiFetch<FinanceHistoryResponse>('/api/finances');
        if (!mounted) return;
        setData(response);
        setExpandedMonth(response.summary.mesAtual);
        setError(null);
      } catch (err) {
        if (!mounted) return;
        setError(getErrorMessage(err));
      }
    };

    void loadFinances();

    return () => {
      mounted = false;
    };
  }, []);

  if (!data && !error) return <div className="p-20 text-center">Carregando histÃ³rico financeiro...</div>;

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-3xl sm:text-4xl font-serif font-bold text-brand-900">FinanÃ§as</h2>
        <p className="text-brand-500">Acompanhe os meses de 2026 com foco em receitas, despesas e saldo.</p>
      </header>

      {error && (
        <div className="glass-card p-4 text-sm font-medium text-red-700 bg-red-50 border-red-200">
          {error}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
            <div className="glass-card p-6 md:col-span-2 border-brand-300">
              <p className="text-xs font-bold uppercase tracking-wider text-brand-500">Card principal</p>
              <h3 className="text-xl font-serif font-bold text-brand-900 mb-1">Caixa geral (2026)</h3>
              <p className="text-4xl font-serif font-bold text-brand-800">{formatMoney(data.summary.caixaGeral)}</p>
            </div>
            <div className="glass-card p-6">
              <p className="text-xs font-bold uppercase tracking-wider text-brand-500">Atendimentos do mÃªs</p>
              <p className="text-3xl font-serif font-bold text-brand-900">{data.summary.totalAtendimentosMes}</p>
            </div>
            <div className="glass-card p-6">
              <p className="text-xs font-bold uppercase tracking-wider text-brand-500">Faturamento do mÃªs</p>
              <p className="text-3xl font-serif font-bold text-green-700">{formatMoney(data.summary.faturamentoMes)}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="glass-card p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-brand-500">Receitas em 2026</p>
              <p className="text-2xl font-serif font-bold text-brand-900">{formatMoney(data.summary.totalReceitas)}</p>
            </div>
            <div className="glass-card p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-brand-500">Despesas em 2026</p>
              <p className="text-2xl font-serif font-bold text-red-700">{formatMoney(data.summary.totalDespesas)}</p>
            </div>
            <div className="glass-card p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-brand-500">Saldo do mÃªs atual</p>
              <p className="text-2xl font-serif font-bold text-green-700">{formatMoney(data.summary.saldoMes)}</p>
            </div>
          </div>

          <div className="space-y-4">
            {data.history.map((month) => (
              <div key={month.id} className="glass-card overflow-hidden border-transparent hover:border-brand-200 transition-all">
                <button
                  onClick={() => setExpandedMonth(expandedMonth === month.id ? null : month.id)}
                  className="w-full p-6 flex items-center justify-between text-left hover:bg-brand-50/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      'p-3 rounded-2xl transition-colors',
                      expandedMonth === month.id ? 'bg-brand-700 text-white' : 'bg-brand-100 text-brand-700',
                    )}>
                      <Calendar className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-serif font-bold text-brand-900 capitalize">{month.label}</h3>
                      <p className="text-sm text-brand-500 font-medium">
                        Receita: {formatMoney(month.revenue)} â€¢ Despesas: {formatMoney(month.expenses)} â€¢ Saldo: {formatMoney(month.net)}
                      </p>
                    </div>
                  </div>
                  <motion.div animate={{ rotate: expandedMonth === month.id ? 180 : 0 }} transition={{ duration: 0.2 }}>
                    <ChevronRight className="w-6 h-6 text-brand-300" />
                  </motion.div>
                </button>

                <AnimatePresence>
                  {expandedMonth === month.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: 'easeInOut' }}
                    >
                      <MonthDetails monthId={month.id} revenue={month.revenue} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const Despesas = () => {
  const [selectedMonth, setSelectedMonth] = useState(getLocalMonthKey());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [newExpense, setNewExpense] = useState({
    description: '',
    category: '',
    amount: '',
    expense_date: getLocalDateKey(),
    notes: '',
  });

  const fetchExpenses = async () => {
    try {
      const data = await apiFetch<Expense[]>(`/api/expenses?month=${encodeURIComponent(selectedMonth)}`);
      setExpenses(data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  useEffect(() => {
    void fetchExpenses();
  }, [selectedMonth]);

  const monthlyTotal = useMemo(() => expenses.reduce((acc, expense) => acc + Number(expense.amount), 0), [expenses]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      await apiFetch<{ id: number }>('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: newExpense.description,
          category: newExpense.category,
          amount: Number(newExpense.amount),
          expense_date: newExpense.expense_date,
          notes: newExpense.notes,
        }),
      });

      setNewExpense({
        description: '',
        category: '',
        amount: '',
        expense_date: getLocalDateKey(),
        notes: '',
      });
      await fetchExpenses();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteExpense = async (expense: Expense) => {
    const confirmed = window.confirm(
      `Excluir a despesa "${expense.description}"?`,
    );
    if (!confirmed) return;

    try {
      await apiFetch<{ success: boolean }>(`/api/expenses-delete?id=${encodeURIComponent(String(expense.id))}`, {
        method: 'DELETE',
      });
      await fetchExpenses();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-3xl sm:text-4xl font-serif font-bold text-brand-900">Despesas</h2>
        <p className="text-brand-500">Registre e acompanhe seus custos mensais.</p>
      </header>

      {error && (
        <div className="glass-card p-4 text-sm font-medium text-red-700 bg-red-50 border-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="glass-card p-6 lg:col-span-1 space-y-4">
          <h3 className="text-xl font-serif font-bold">Nova despesa</h3>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-sm font-bold text-brand-700 mb-1">DescriÃ§Ã£o *</label>
              <input
                required
                type="text"
                value={newExpense.description}
                onChange={(e) => setNewExpense((prev) => ({ ...prev, description: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-brand-700 mb-1">Categoria</label>
              <input
                type="text"
                value={newExpense.category}
                onChange={(e) => setNewExpense((prev) => ({ ...prev, category: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-bold text-brand-700 mb-1">Valor *</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  value={newExpense.amount}
                  onChange={(e) => setNewExpense((prev) => ({ ...prev, amount: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-brand-700 mb-1">Data *</label>
                <input
                  required
                  type="date"
                  value={newExpense.expense_date}
                  onChange={(e) => setNewExpense((prev) => ({ ...prev, expense_date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-brand-700 mb-1">Notas</label>
              <textarea
                rows={2}
                value={newExpense.notes}
                onChange={(e) => setNewExpense((prev) => ({ ...prev, notes: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
              />
            </div>
            <button type="submit" disabled={isSaving} className="w-full px-4 py-2 rounded-xl bg-brand-700 text-white font-bold hover:bg-brand-800 disabled:opacity-70">
              {isSaving ? 'Salvando...' : 'Adicionar despesa'}
            </button>
          </form>
        </div>

        <div className="glass-card p-6 lg:col-span-2 space-y-4">
          <div className="flex flex-wrap gap-3 items-end justify-between">
            <div>
              <p className="text-xs text-brand-500 font-bold uppercase tracking-wider">Filtro mensal</p>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="px-3 py-2 rounded-xl border border-brand-200 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
              />
            </div>
            <div className="text-right">
              <p className="text-xs text-brand-500 font-bold uppercase tracking-wider">Total de despesas</p>
              <p className="text-2xl font-serif font-bold text-brand-900">{formatMoney(monthlyTotal)}</p>
            </div>
          </div>

          <div className="space-y-3">
            {expenses.length === 0 ? (
              <p className="text-brand-400 italic py-6 text-center">Nenhuma despesa para este mÃªs.</p>
            ) : (
              expenses.map((expense) => (
                <div key={expense.id} className="p-4 rounded-xl border border-brand-100 bg-brand-50/40 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-bold text-brand-900">{expense.description}</p>
                    <p className="text-xs text-brand-500">{expense.category || 'Sem categoria'} â€¢ {format(parseISO(expense.expense_date), 'dd/MM/yyyy')}</p>
                    {expense.notes && <p className="text-xs text-brand-500 mt-1">{expense.notes}</p>}
                  </div>
                  <div className="text-right space-y-2">
                    <p className="font-serif text-xl font-bold text-red-700">{formatMoney(expense.amount)}</p>
                    <button
                      type="button"
                      onClick={() => void handleDeleteExpense(expense)}
                      className="text-xs font-bold text-red-600 hover:text-red-700"
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const Layout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="min-h-screen bg-brand-50">
      <div className="lg:hidden sticky top-0 z-30 border-b border-brand-200 bg-brand-50/95 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 px-4 py-3">
          <Sparkles className="h-5 w-5 text-brand-500" />
          <div>
            <p className="text-base font-serif font-bold text-brand-700 leading-none">Andressa Alana</p>
            <p className="text-[10px] uppercase tracking-wider text-brand-500">{'Gest\u00e3o de Est\u00e9tica'}</p>
          </div>
        </Link>
      </div>

      <div className="flex">
        <Sidebar />
        <main className="w-full flex-1 max-w-7xl mx-auto px-4 py-5 pb-24 sm:px-6 sm:py-6 lg:px-10 lg:py-10 lg:pb-10">
          {children}
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/clientes" element={<Clients />} />
          <Route path="/clientes/:id" element={<ClientDetail />} />
          <Route path="/agenda" element={<Agenda />} />
          <Route path="/procedimentos" element={<Procedures />} />
          <Route path="/despesas" element={<Despesas />} />
          <Route path="/financas" element={<Finances />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}


