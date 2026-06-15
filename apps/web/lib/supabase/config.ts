/**
 * Configuración de Supabase leída de variables de entorno públicas.
 * Si faltan, la app sigue funcionando: el acceso cae al backend legado
 * (lib/auth.ts) y se muestra un aviso de "configura Supabase".
 *
 * Se normaliza la URL para evitar el error "Invalid path specified in request
 * URL": se quitan espacios, comillas, barras finales y los sufijos de la
 * "Data API URL" (`/rest/v1`) o de auth (`/auth/v1`) si se pegaron por error.
 * La librería necesita la URL base: https://<ref>.supabase.co
 */
function clean(value: string | undefined): string {
  return (value ?? '').trim().replace(/^['"]|['"]$/g, '').trim();
}

function normalizeUrl(value: string | undefined): string {
  return clean(value)
    .replace(/\/+$/, '') // barras finales
    .replace(/\/(rest|auth|storage|realtime)\/v1$/, '') // sufijos de API pegados por error
    .replace(/\/+$/, '');
}

export const SUPABASE_URL = normalizeUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON_KEY = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
