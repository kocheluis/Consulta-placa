/**
 * Cupo de consultas para USUARIOS normales. Cualquiera se registra normal (Supabase Auth); el admin
 * le asigna a mano un cupo (`profiles.consulta_enabled` + límites) para consultar placas sin pagar por
 * reporte. CONVIVE con el pago por reporte. NO da acceso a la consola del operador (VPS, aparte).
 * Server-only: cupo y conteo con el cliente admin (service_role) para que el usuario NO pueda
 * alterarlos. Fail-safe: si la migración 0009 aún no está aplicada, devuelve null (cupo desactivado).
 */
import { createAdminClient } from './supabase/admin';
import { createClient } from './supabase/server';

export type CupoTier = 'PRO' | 'ULTRA';

export interface CupoAccess {
  enabled: boolean;
  quotaHour: number;
  quotaDay: number;
  quotaWeek: number;
  tier: CupoTier;
}
export interface CupoWindows { hour: number; day: number; week: number }
export interface CupoStatus {
  enabled: boolean;
  tier: CupoTier;
  limits: CupoWindows;
  used: CupoWindows;
  remaining: CupoWindows;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Cupo del usuario por userId (cliente admin; ignora RLS). null si no hay perfil / sin migración. */
export async function getUserCupo(userId: string): Promise<CupoAccess | null> {
  try {
    const sb = createAdminClient();
    const { data, error } = await sb
      .from('profiles')
      .select('consulta_enabled, quota_hour, quota_day, quota_week, consulta_tier')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return null; // columnas sin migrar (error) o sin perfil → sin cupo
    const d = data as Record<string, unknown>;
    return {
      enabled: Boolean(d.consulta_enabled),
      quotaHour: Number(d.quota_hour ?? 5),
      quotaDay: Number(d.quota_day ?? 20),
      quotaWeek: Number(d.quota_week ?? 100),
      tier: d.consulta_tier === 'ULTRA' ? 'ULTRA' : 'PRO',
    };
  } catch {
    return null;
  }
}

/** Cupo del usuario EN SESIÓN (o null si no hay sesión/perfil). */
export async function getSessionCupo(): Promise<{ userId: string; email: string | null; access: CupoAccess } | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const access = await getUserCupo(user.id);
  return access ? { userId: user.id, email: user.email ?? null, access } : null;
}

/** Edades (ms) de las consultas del usuario en la última semana (una sola query). */
async function hitAges(userId: string): Promise<number[]> {
  const sb = createAdminClient();
  const since = new Date(Date.now() - WEEK).toISOString();
  const { data } = await sb
    .from('consulta_hits')
    .select('created_at')
    .eq('user_id', userId)
    .gte('created_at', since);
  const now = Date.now();
  return ((data ?? []) as Array<{ created_at: string }>).map((r) => now - new Date(r.created_at).getTime());
}

const countIn = (ages: number[], windowMs: number): number => ages.filter((a) => a <= windowMs).length;

/** Estado del cupo para la UI (NO consume). */
export async function getCupoStatus(userId: string, access: CupoAccess): Promise<CupoStatus> {
  const ages = await hitAges(userId);
  const used = { hour: countIn(ages, HOUR), day: countIn(ages, DAY), week: countIn(ages, WEEK) };
  return {
    enabled: access.enabled,
    tier: access.tier,
    limits: { hour: access.quotaHour, day: access.quotaDay, week: access.quotaWeek },
    used,
    remaining: {
      hour: Math.max(0, access.quotaHour - used.hour),
      day: Math.max(0, access.quotaDay - used.day),
      week: Math.max(0, access.quotaWeek - used.week),
    },
  };
}

export interface CupoCheck {
  ok: boolean;
  window?: 'hora' | 'día' | 'semana';
  resetInMin?: number;
  remaining?: CupoWindows;
}

/**
 * Verifica el cupo y, si hay, REGISTRA la consulta (consume 1). Reporta qué ventana bloqueó y en
 * cuántos minutos se libera (cuando la consulta más antigua de esa ventana sale de ella). Cuenta-
 * luego-inserta como `freeConsultaRateOk`; bajo la baja concurrencia de estas cuentas la carrera es
 * despreciable.
 */
export async function checkAndRecordCupo(userId: string, access: CupoAccess, placa: string): Promise<CupoCheck> {
  const sb = createAdminClient();
  const ages = await hitAges(userId);
  const hour = countIn(ages, HOUR);
  const day = countIn(ages, DAY);
  const week = countIn(ages, WEEK);

  // Minutos hasta que se libere un cupo en la ventana: la consulta MÁS ANTIGUA dentro de ella sale primero.
  const resetMin = (windowMs: number): number => {
    const inWin = ages.filter((a) => a <= windowMs);
    const oldest = inWin.length ? Math.max(...inWin) : 0;
    return Math.max(1, Math.ceil((windowMs - oldest) / 60_000));
  };
  if (hour >= access.quotaHour) return { ok: false, window: 'hora', resetInMin: resetMin(HOUR) };
  if (day >= access.quotaDay) return { ok: false, window: 'día', resetInMin: resetMin(DAY) };
  if (week >= access.quotaWeek) return { ok: false, window: 'semana', resetInMin: resetMin(WEEK) };

  await sb.from('consulta_hits').insert({ user_id: userId, placa });
  return {
    ok: true,
    remaining: {
      hour: Math.max(0, access.quotaHour - hour - 1),
      day: Math.max(0, access.quotaDay - day - 1),
      week: Math.max(0, access.quotaWeek - week - 1),
    },
  };
}

/** ¿El reporte guardado ya cubre el nivel del cupo? (para no re-encolar de gusto). */
function reportCoversTier(report: unknown, tier: CupoTier): boolean {
  const secs = ((report as { sections?: Array<{ kind?: string; status?: string }> })?.sections) ?? [];
  const coversPro = secs.some((s) => s.kind === 'CAPTURA' || s.kind === 'HISTORIAL' || s.kind === 'GRAVAMENES');
  if (tier === 'PRO') return coversPro;
  return coversPro && secs.some((s) => s.kind === 'IA' && s.status === 'AVAILABLE');
}

/**
 * Encola (si hace falta) el reporte del nivel del cupo para una placa. Idempotente: 'ready' si ya
 * está, 'generating' si hay pedido activo, 'queued' si lo encola. NO cobra (ya consumió cupo). Reusa
 * la cola `pedidos` del motor; marca `origin='cupo'` para trazabilidad.
 */
export async function enqueueCupoConsulta(
  userId: string,
  email: string | null,
  plateRaw: string,
  tier: CupoTier,
): Promise<'queued' | 'generating' | 'ready' | 'invalid'> {
  const placa = (plateRaw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (placa.length < 6 || placa.length > 7) return 'invalid';
  try {
    const sb = createAdminClient();
    const { data: rep } = await sb.from('reportes').select('report').eq('placa', placa).maybeSingle();
    if (rep?.report && reportCoversTier(rep.report, tier)) return 'ready';
    const { data: ped } = await sb
      .from('pedidos').select('id').eq('placa', placa).in('estado', ['pendiente', 'procesando']).limit(1);
    if (ped && ped.length) return 'generating';
    await sb.from('pedidos').insert({ placa, estado: 'pendiente', tier, user_id: userId, email, origin: 'cupo' });
    return 'queued';
  } catch {
    return 'invalid';
  }
}
