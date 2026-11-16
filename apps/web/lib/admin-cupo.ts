/**
 * Gestión (admin) del CUPO de consultas de los usuarios: listar/buscar cuentas y asignarles nivel +
 * cupo. Server-only: escribe con el cliente admin (service_role), que es el ÚNICO que el guard
 * `prevent_tier_change` (migración 0009) deja modificar estos campos. Solo debe llamarse desde rutas
 * ya validadas con `isAdminEmail`. Ver lib/cupo.ts (lado usuario) y lib/admin.ts (gating).
 */
import { createAdminClient } from './supabase/admin';

export interface CupoUser {
  id: string;
  email: string | null;
  fullName: string | null;
  enabled: boolean;
  tier: 'PRO' | 'ULTRA';
  quotaHour: number;
  quotaDay: number;
  quotaWeek: number;
  /** Paquete mensual (migración 0012). null = sin paquete. */
  pack: { name: string; total: number; startsAt: string | null; expiresAt: string | null } | null;
}

const BASE_COLS = 'id, email, full_name, consulta_enabled, consulta_tier, quota_hour, quota_day, quota_week';
const COLS = `${BASE_COLS}, pack_name, pack_total, pack_starts_at, pack_expires_at`;

function toCupoUser(d: Record<string, unknown>): CupoUser {
  return {
    id: String(d.id),
    email: (d.email as string) ?? null,
    fullName: (d.full_name as string) ?? null,
    enabled: Boolean(d.consulta_enabled),
    tier: d.consulta_tier === 'ULTRA' ? 'ULTRA' : 'PRO',
    quotaHour: Number(d.quota_hour ?? 5),
    quotaDay: Number(d.quota_day ?? 20),
    quotaWeek: Number(d.quota_week ?? 100),
    pack: Number(d.pack_total ?? 0) > 0
      ? { name: String(d.pack_name ?? ''), total: Number(d.pack_total), startsAt: (d.pack_starts_at as string) ?? null, expiresAt: (d.pack_expires_at as string) ?? null }
      : null,
  };
}

/**
 * Sin `q`: lista las cuentas con cupo ACTIVO (para gestionarlas). Con `q`: busca por correo (ILIKE)
 * cualquier cuenta (tenga o no cupo) para poder asignárselo. `migrated:false` si falta la migración 0009.
 */
export async function listCupoUsers(q?: string): Promise<{ migrated: boolean; users: CupoUser[] }> {
  const sb = createAdminClient();
  const term = (q ?? '').trim();
  const run = (cols: string) => (term
    ? sb.from('profiles').select(cols).ilike('email', `%${term}%`).order('email', { ascending: true }).limit(50)
    : sb.from('profiles').select(cols).eq('consulta_enabled', true).order('email', { ascending: true }).limit(100));
  let { data, error } = await run(COLS);
  if (error) ({ data, error } = await run(BASE_COLS)); // 0012 aún sin migrar → sin datos de paquete
  if (error) return { migrated: false, users: [] }; // columnas sin migrar u otro error
  return { migrated: true, users: ((data ?? []) as unknown as Record<string, unknown>[]).map(toCupoUser) };
}

export interface SetCupoInput {
  userId: string;
  enabled: boolean;
  tier: 'PRO' | 'ULTRA';
  quotaHour: number;
  quotaDay: number;
  quotaWeek: number;
}

/** Asigna nivel + cupo a una cuenta (service_role → pasa el guard). Devuelve la fila actualizada. */
export async function setCupo(input: SetCupoInput): Promise<{ ok: boolean; error?: string; user?: CupoUser }> {
  const sb = createAdminClient();
  const clamp = (n: number): number => Math.max(0, Math.min(100_000, Math.floor(Number(n) || 0)));
  const { data, error } = await sb
    .from('profiles')
    .update({
      consulta_enabled: Boolean(input.enabled),
      consulta_tier: input.tier === 'ULTRA' ? 'ULTRA' : 'PRO',
      quota_hour: clamp(input.quotaHour),
      quota_day: clamp(input.quotaDay),
      quota_week: clamp(input.quotaWeek),
    })
    .eq('id', input.userId)
    .select(COLS)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Usuario no encontrado.' };
  return { ok: true, user: toCupoUser(data as Record<string, unknown>) };
}

/**
 * Activa un PAQUETE MENSUAL de consultas Completo (lo pidió por WhatsApp y pagó). NO se acumula:
 * reemplaza cualquier paquete anterior y el conteo empieza de cero; vence a los 30 días. Topes por
 * hora/día como freno anti-abuso (un paquete no debe gastarse en ráfagas automáticas).
 */
export async function activatePack(userId: string, consultas: number, dias = 30): Promise<{ ok: boolean; error?: string; user?: CupoUser }> {
  const n = Math.max(1, Math.min(1000, Math.floor(consultas)));
  const now = new Date();
  const { data, error } = await createAdminClient()
    .from('profiles')
    .update({
      consulta_enabled: true,
      consulta_tier: 'ULTRA',
      pack_name: `${n} consultas`,
      pack_total: n,
      pack_starts_at: now.toISOString(),
      pack_expires_at: new Date(now.getTime() + dias * 86_400_000).toISOString(),
      quota_hour: Math.min(n, 10),
      quota_day: n,
      quota_week: n,
    })
    .eq('id', userId)
    .select(COLS)
    .maybeSingle();
  if (error) return { ok: false, error: /pack_/.test(error.message) ? 'Falta aplicar la migración 0012 en Supabase.' : error.message };
  if (!data) return { ok: false, error: 'Usuario no encontrado.' };
  return { ok: true, user: toCupoUser(data as Record<string, unknown>) };
}
