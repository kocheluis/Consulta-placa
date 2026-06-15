/**
 * Configuración de Supabase leída de variables de entorno públicas.
 * Si faltan, la app sigue funcionando: el acceso cae al backend legado
 * (lib/auth.ts) y se muestra un aviso de "configura Supabase".
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
