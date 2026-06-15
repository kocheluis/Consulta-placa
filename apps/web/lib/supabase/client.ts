import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

/**
 * Cliente de Supabase para componentes del navegador.
 * Llamar solo cuando `isSupabaseConfigured` es true.
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
