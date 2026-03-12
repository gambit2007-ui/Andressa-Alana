import React, { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Sparkles } from 'lucide-react';
import {
  isSupabaseClientConfigured,
  missingSupabaseClientEnv,
  supabase,
} from './supabaseClient';

type AuthGateProps = {
  children: React.ReactNode;
};

export default function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }

    let mounted = true;

    void supabase.auth.getSession().then(({ data, error: getSessionError }) => {
      if (!mounted) return;
      if (getSessionError) {
        setError(getSessionError.message);
      }
      setSession(data.session ?? null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) {
      setError('Supabase Auth nao configurado.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(signInError.message);
    } else {
      setPassword('');
    }

    setIsSubmitting(false);
  };

  if (!isSupabaseClientConfigured) {
    return (
      <div className="min-h-screen bg-brand-50 flex items-center justify-center p-6">
        <div className="w-full max-w-xl bg-white border border-red-300 rounded-3xl p-8 space-y-4">
          <h1 className="text-2xl font-serif font-bold text-red-700">Configuracao de Auth ausente</h1>
          <p className="text-sm text-brand-700">
            Defina as variaveis abaixo em <code>.env.local</code> e na Vercel:
          </p>
          <ul className="list-disc pl-6 text-sm text-brand-700 space-y-1">
            {missingSupabaseClientEnv.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (!authReady) {
    return (
      <div className="min-h-screen bg-brand-50 flex items-center justify-center text-brand-700">
        Carregando autenticacao...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-brand-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white border border-brand-300 rounded-3xl p-8 shadow-sm space-y-6">
          <div className="text-center space-y-2">
            <Sparkles className="h-8 w-8 text-brand-700 mx-auto" />
            <h1 className="text-3xl font-serif font-bold text-brand-900">Andressa Alana</h1>
            <p className="text-sm text-brand-700">Entre com email e senha para acessar.</p>
          </div>

          {error && (
            <div className="rounded-xl border border-red-300 bg-red-100 text-red-800 px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-brand-900 mb-1">Email</label>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-brand-300 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-brand-900 mb-1">Senha</label>
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-brand-300 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-brand-700 text-white px-6 py-3 rounded-2xl font-bold hover:bg-brand-800 transition-all disabled:opacity-70"
            >
              {isSubmitting ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <p className="text-xs text-brand-700 text-center">
            O acesso exige login sempre que o app for aberto.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
