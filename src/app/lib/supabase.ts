import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

export function getSupabaseUrl() {
  return import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
}

export function getSupabaseAnonKey() {
  return (
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ??
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY?.trim() ??
    import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ??
    ''
  );
}

export function isSupabaseConfigured() {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

export function getSupabaseBrowserClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (!browserClient) {
    browserClient = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return browserClient;
}
