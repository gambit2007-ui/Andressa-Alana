import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const supabasePublishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  ?? import.meta.env.VITE_SUPABASE_ANON_KEY
  ?? ''
).trim();

export const missingSupabaseEnv = [
  !supabaseUrl ? 'VITE_SUPABASE_URL' : null,
  !supabasePublishableKey ? 'VITE_SUPABASE_PUBLISHABLE_KEY' : null,
].filter(Boolean) as string[];

export const isSupabaseConfigured = missingSupabaseEnv.length === 0;

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        // Mantem a sessao entre recarregamentos e renova o token automaticamente.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
