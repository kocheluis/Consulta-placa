/**
 * Capa de servicio del BOT de WhatsApp (n8n). n8n NO habla directo con Supabase ni reimplementa
 * cupo/paywall: llama a `/api/bot/*` con un token de servicio (`BOT_API_TOKEN`) y esta capa reusa
 * la lógica que ya vive en `lib/cupo` y `lib/payments`. Así toda la seguridad (RLS, tier, cupo)
 * queda en un solo lugar. Server-only: usa el cliente admin (service_role).
 *
 * Identidad: un número de WhatsApp se mapea a una cuenta en `bot_users` (migración 0010). Vinculado
 * → usa su cupo; sin vincular → paga por reporte (Fase 1). La columna `whatsapp` de `pedidos` lleva
 * el número para que la entrega (VPS → N8N_WEBHOOK_URL → WhatsApp) llegue a quien pidió.
 *
 * Los helpers PUROS (normPhone/normPlaca/reportSummary) viven en `bot-format.ts` (testeables sin
 * Supabase/Next) y se re-exportan aquí para que el resto importe todo desde '@/lib/bot'.
 */
import crypto from 'node:crypto';
import { createAdminClient } from './supabase/admin';
import { getUserCupo } from './cupo';
import { normPhone } from './bot-format';

export { normPhone, normPlaca, reportSummary, type ReportSummary } from './bot-format';

/** ¿La petición trae el token de servicio del bot? (header `x-bot-token` == `BOT_API_TOKEN`). */
export function botAuthOk(req: Request): boolean {
  const expected = process.env.BOT_API_TOKEN ?? '';
  const got = req.headers.get('x-bot-token') ?? '';
  if (!expected || !got) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface BotUser {
  phone: string;
  userId: string | null;
  email: string | null;
  verified: boolean;
  lastPlaca: string | null;
}

/** Lee (o crea vacío) el registro del número. Devuelve null si el backend no está configurado. */
export async function getBotUser(phone: string): Promise<BotUser | null> {
  const ph = normPhone(phone);
  if (!ph) return null;
  try {
    const sb = createAdminClient();
    const { data } = await sb
      .from('bot_users')
      .select('phone, user_id, email, verified, last_placa')
      .eq('phone', ph)
      .maybeSingle();
    if (!data) return { phone: ph, userId: null, email: null, verified: false, lastPlaca: null };
    const d = data as Record<string, unknown>;
    return {
      phone: ph,
      userId: (d.user_id as string | null) ?? null,
      email: (d.email as string | null) ?? null,
      verified: Boolean(d.verified),
      lastPlaca: (d.last_placa as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Nivel que el número tiene DERECHO a ver de una placa. Vinculado + con cupo → su nivel (PRO/ULTRA);
 * si no, BASIC. (El pago por reporte —purchases— se suma en la Fase 1.) Se usa para recortar el reporte
 * antes de resumirlo: así un número BASIC no ve el resumen PRO/ULTRA que otro usuario ya generó.
 */
export async function entitledBotTier(userId: string | null): Promise<'BASIC' | 'PRO' | 'ULTRA'> {
  if (!userId) return 'BASIC';
  const access = await getUserCupo(userId);
  return access?.enabled ? access.tier : 'BASIC';
}

/** Registra/actualiza el número (upsert). Sirve para dejar rastro del contacto y su contexto. */
export async function upsertBotUser(phone: string, patch: Partial<{ email: string | null; lastPlaca: string | null }>): Promise<void> {
  const ph = normPhone(phone);
  if (!ph) return;
  try {
    const sb = createAdminClient();
    const row: Record<string, unknown> = { phone: ph, updated_at: new Date().toISOString() };
    if (patch.email !== undefined) row.email = patch.email;
    if (patch.lastPlaca !== undefined) row.last_placa = patch.lastPlaca;
    await sb.from('bot_users').upsert(row, { onConflict: 'phone' });
  } catch { /* fail-safe: no romper el flujo del bot por el rastro de contacto */ }
}
