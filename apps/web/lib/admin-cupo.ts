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
}

const COLS = 'id, email, full_name, consulta_enabled, consulta_tier, quota_hour, quota_day, quota_week';

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
  };
}

/**
 * Sin `q`: lista las cuentas con cupo ACTIVO (para gestionarlas). Con `q`: busca por correo (ILIKE)
 * cualquier cuenta (tenga o no cupo) para poder asignárselo. `migrated:false` si falta la migración 0009.
 */
export async function listCupoUsers(q?: string): Promise<{ migrated: boolean; users: CupoUser[] }> {
  const sb = createAdminClient();
  const term = (q ?? '').trim();
  const query = term
    ? sb.from('profiles').select(COLS).ilike('email', `%${term}%`).order('email', { ascending: true }).limit(50)
    : sb.from('profiles').select(COLS).eq('consulta_enabled', true).order('email', { ascending: true }).limit(100);
  const { data, error } = await query;
  if (error) return { migrated: false, users: [] }; // columnas sin migrar u otro error
  return { migrated: true, users: ((data ?? []) as Record<string, unknown>[]).map(toCupoUser) };
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
