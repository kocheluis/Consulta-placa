import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from './config';

/**
 * Cliente de Supabase con `service_role` — SOLO server-side (route handlers,
 * webhooks). Salta el RLS y la guardia de tier: nunca debe exponerse al cliente
 * ni usar `NEXT_PUBLIC_`. La clave viene de `SUPABASE_SERVICE_ROLE_KEY`.
 */
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const isAdminConfigured = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

export function createAdminClient() {
  if (!isAdminConfigured) {
    throw new Error('Supabase admin no configurado: falta SUPABASE_SERVICE_ROLE_KEY.');
  }
  return createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
