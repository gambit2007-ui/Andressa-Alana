import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { KeyRound, LoaderCircle, LockKeyhole, Mail, ShieldCheck, Smartphone } from 'lucide-react';
import { isSupabaseConfigured, missingSupabaseEnv, supabase } from './lib/supabase';
import type { Profile } from './types';

type AuthContextValue = {
  session: Session;
  profile: Profile;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthGate.');
  return context;
}

const authErrorMessage = (message: string): string => {
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) return 'Email ou senha incorretos.';
  if (normalized.includes('email not confirmed')) return 'Confirme o email antes de entrar.';
  if (normalized.includes('password should be')) return 'A senha deve ter pelo menos 6 caracteres.';
  if (normalized.includes('rate limit')) return 'Muitas tentativas. Aguarde alguns minutos.';
  return message;
};

function BrandPanel() {
  return (
    <section className="auth-brand-panel">
      <div className="relative z-10 flex h-full flex-col justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-400/20">
            <span className="font-display text-xl">GR</span>
          </div>
          <div>
            <p className="font-display text-2xl leading-none text-white">GR Solution</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-cyan-300">Rental Operations</p>
          </div>
        </div>

        <div className="max-w-md space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300">
            <ShieldCheck className="h-4 w-4 text-cyan-300" />
            Operacao protegida por Supabase Auth
          </div>
          <h1 className="font-display text-5xl leading-[1.02] text-white sm:text-6xl">
            Sua frota sob controle. Do IMEI ao caixa.
          </h1>
          <p className="max-w-sm text-sm leading-6 text-slate-400">
            Contratos, cobranca, rentabilidade e MDM em uma unica operacao auditavel.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 text-xs text-slate-400">
          {['Frota', 'Financeiro', 'MDM'].map((item) => (
            <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <Smartphone className="mb-2 h-4 w-4 text-cyan-300" />
              {item}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AuthForm({ onRecovery }: { onRecovery: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [forgotMode, setForgotMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);

    if (forgotMode) {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/?recovery=1`,
      });
      if (resetError) setError(authErrorMessage(resetError.message));
      else setMessage('Enviamos o link de recuperacao para o seu email.');
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) setError(authErrorMessage(signInError.message));
    }
    setSubmitting(false);
  };

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('recovery')) onRecovery();
  }, [onRecovery]);

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-700">Area segura</p>
        <h2 className="mt-2 font-display text-4xl text-slate-950">
          {forgotMode ? 'Recuperar acesso' : 'Bem-vindo de volta'}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {forgotMode
            ? 'Informe o email para receber o link de redefinicao.'
            : 'Entre com as credenciais cadastradas no Supabase.'}
        </p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}

      <div className="space-y-4">
        <label className="form-field">
          <span>Email</span>
          <div className="relative">
            <Mail className="input-icon" />
            <input className="input pl-11" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@grsolution.com" />
          </div>
        </label>

        {!forgotMode && (
          <label className="form-field">
            <span>Senha</span>
            <div className="relative">
              <LockKeyhole className="input-icon" />
              <input className="input pl-11" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha" />
            </div>
          </label>
        )}
      </div>

      <button className="btn-primary w-full" disabled={submitting} type="submit">
        {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        {forgotMode ? 'Enviar link' : 'Entrar na operacao'}
      </button>

      <button type="button" className="w-full text-sm font-semibold text-slate-500 transition hover:text-cyan-700" onClick={() => {
        setForgotMode((current) => !current);
        setError(null);
        setMessage(null);
      }}>
        {forgotMode ? 'Voltar para o login' : 'Esqueci minha senha'}
      </button>
    </form>
  );
}

function PasswordRecovery({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) setError(authErrorMessage(updateError.message));
    else onDone();
  };

  return (
    <form onSubmit={submit} className="w-full max-w-md space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-700">Recuperacao</p>
        <h2 className="mt-2 font-display text-4xl text-slate-950">Crie uma nova senha</h2>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <label className="form-field">
        <span>Nova senha</span>
        <input className="input" type="password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      <button className="btn-primary w-full" disabled={submitting} type="submit">
        {submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
        Atualizar senha
      </button>
    </form>
  );
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);

  const loadProfile = async () => {
    if (!supabase) return;
    setProfileLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setProfileLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id,organization_id,full_name,role,active,organization:organizations(id,name,slug)')
      .eq('id', sessionData.session.user.id)
      .maybeSingle();

    if (error) {
      setProfileError(error.message);
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    if (!data) {
      setProfileError('Seu usuario ainda nao possui perfil na organizacao. Aplique a migration Rental no Supabase.');
      setProfileLoading(false);
      return;
    }
    setProfile(data as unknown as Profile);
    setProfileError(null);
    setProfileLoading(false);
  };

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) void loadProfile();
    else setProfile(null);
  }, [session]);

  const context = useMemo<AuthContextValue | null>(() => {
    if (!session || !profile || !supabase) return null;
    const client = supabase;
    return {
      session,
      profile,
      signOut: async () => { await client.auth.signOut(); },
      refreshProfile: loadProfile,
    };
  }, [profile, session]);

  if (!isSupabaseConfigured) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white">
        <div className="max-w-lg rounded-3xl border border-amber-400/20 bg-amber-400/10 p-8">
          <h1 className="font-display text-3xl">Configuracao do Supabase ausente</h1>
          <p className="mt-3 text-sm text-slate-300">Adicione na Vercel e em `.env.local`:</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-200">
            {missingSupabaseEnv.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </main>
    );
  }

  if (loading) return <main className="grid min-h-screen place-items-center bg-slate-950 text-cyan-300"><LoaderCircle className="h-8 w-8 animate-spin" /></main>;

  if (session && profileLoading && !profile) return <main className="grid min-h-screen place-items-center bg-slate-950 text-cyan-300"><LoaderCircle className="h-8 w-8 animate-spin" /></main>;

  if (!session || recoveryMode) {
    return (
      <main className="auth-layout">
        <BrandPanel />
        <section className="grid min-h-screen place-items-center bg-stone-50 p-6 sm:p-10">
          {recoveryMode ? <PasswordRecovery onDone={() => setRecoveryMode(false)} /> : <AuthForm onRecovery={() => setRecoveryMode(true)} />}
        </section>
      </main>
    );
  }

  if (profileError || !context) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white">
        <div className="max-w-xl rounded-3xl border border-red-400/20 bg-red-400/10 p-8">
          <h1 className="font-display text-3xl">Perfil organizacional indisponivel</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">{profileError ?? 'Carregando perfil...'}</p>
          <button className="btn-secondary mt-6" type="button" onClick={() => void supabase?.auth.signOut()}>Sair</button>
        </div>
      </main>
    );
  }

  return <AuthContext.Provider value={context}>{children}</AuthContext.Provider>;
}
