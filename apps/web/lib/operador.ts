/**
 * Cuentas internas de OPERADOR con cupo de consultas (hora/día/semana). El admin las habilita a
 * mano en Supabase (`profiles.consulta_enabled`); CONVIVE con el pago por reporte (no lo toca).
 * Server-only: cupo y conteo con el cliente admin (service_role) para que el usuario NO pueda
 * alterarlos. Fail-safe: si la migración 0009 aún no está aplicada, `getOperatorAccess` devuelve
 * null (acceso desactivado) sin romper. Ver migración 0009_operador_cuotas.sql.
 */
import { createAdminClient } from './supabase/admin';
import { createClient } from './supabase/server';

export type OperatorTier = 'PRO' | 'ULTRA';

export interface OperatorAccess {
  enabled: boolean;
  quotaHour: number;
  quotaDay: number;
  quotaWeek: number;
  tier: OperatorTier;
}
export interface QuotaWindows { hour: number; day: number; week: number }
export interface QuotaStatus {
  enabled: boolean;
  tier: OperatorTier;
  limits: QuotaWindows;
  used: QuotaWindows;
  remaining: QuotaWindows;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Acceso de operador por userId (cliente admin; ignora RLS). null si no hay perfil / sin migración. */
export async function getOperatorAccess(userId: string): Promise<OperatorAccess | null> {
  try {
    const sb = createAdminClient();
    const { data, error } = await sb
      .from('profiles')
      .select('consulta_enabled, quota_hour, quota_day, quota_week, consulta_tier')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return null; // columnas sin migrar (error) o sin perfil → sin acceso
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

/** Acceso de operador del usuario EN SESIÓN (o null si no hay sesión/perfil). */
export async function getSessionOperatorAccess(): Promise<{ userId: string; email: string | null; access: OperatorAccess } | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const access = await getOperatorAccess(user.id);
  return access ? { userId: user.id, email: user.email ?? null, access } : null;
}

/** Edades (ms) de los hits del usuario en la última semana (una sola query). */
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

/** Estado de cupo para la UI (NO consume). */
export async function getQuotaStatus(userId: string, access: OperatorAccess): Promise<QuotaStatus> {
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

export interface QuotaCheck {
  ok: boolean;
  window?: 'hora' | 'día' | 'semana';
  resetInMin?: number;
  remaining?: QuotaWindows;
}

/**
 * Verifica el cupo y, si hay, REGISTRA el hit (consume 1). Reporta qué ventana bloqueó y en
 * cuántos minutos se libera (cuando el hit más antiguo de esa ventana sale de ella). Cuenta-luego-
 * inserta como `freeConsultaRateOk`; bajo la baja concurrencia de cuentas internas la carrera es
 * despreciable.
 */
export async function checkAndRecordQuota(userId: string, access: OperatorAccess, placa: string): Promise<QuotaCheck> {
  const sb = createAdminClient();
  const ages = await hitAges(userId);
  const hour = countIn(ages, HOUR);
  const day = countIn(ages, DAY);
  const week = countIn(ages, WEEK);

  // Minutos hasta que se libere un cupo en la ventana: el hit MÁS ANTIGUO dentro de ella sale primero.
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

/** ¿El reporte guardado ya cubre el nivel del operador? (para no re-encolar de gusto). */
function reportCoversTier(report: unknown, tier: OperatorTier): boolean {
  const secs = ((report as { sections?: Array<{ kind?: string; status?: string }> })?.sections) ?? [];
  const coversPro = secs.some((s) => s.kind === 'CAPTURA' || s.kind === 'HISTORIAL' || s.kind === 'GRAVAMENES');
  if (tier === 'PRO') return coversPro;
  return coversPro && secs.some((s) => s.kind === 'IA' && s.status === 'AVAILABLE');
}

/**
 * Encola (si hace falta) el reporte del nivel del operador para una placa. Idempotente: 'ready' si
 * ya está, 'generating' si hay pedido activo, 'queued' si lo encola. NO cobra (el operador ya
 * consumió cupo). Reusa la cola `pedidos` del motor; marca `origin='operador_web'` para trazabilidad.
 */
export async function enqueueOperatorConsulta(
  userId: string,
  email: string | null,
  plateRaw: string,
  tier: OperatorTier,
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
    await sb.from('pedidos').insert({ placa, estado: 'pendiente', tier, user_id: userId, email, origin: 'operador_web' });
    return 'queued';
  } catch {
    return 'invalid';
  }
}
