/**
 * Configuración de Supabase leída de variables de entorno públicas.
 * Si faltan, la app sigue funcionando: el acceso cae al backend legado
 * (lib/auth.ts) y se muestra un aviso de "configura Supabase".
 *
 * Se normaliza la URL (quita espacios, comillas accidentales y barras al
 * final) para evitar el error "Invalid path specified in request URL" que
 * ocurre cuando la URL termina en "/" y produce rutas dobles "//auth/v1".
 */
function clean(value: string | undefined): string {
  return (value ?? '').trim().replace(/^['"]|['"]$/g, '').trim();
}

export const SUPABASE_URL = clean(process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
export const SUPABASE_ANON_KEY = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
