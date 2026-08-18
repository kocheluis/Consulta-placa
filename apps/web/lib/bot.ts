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
import { TIER_RANK, type ReportTier } from '@app/shared';
import { createAdminClient } from './supabase/admin';
import { getUserCupo } from './cupo';
import { getPaidTierByUserId } from './payments';
import { sendEmail } from './email';
import { normPhone, genOtp, hashOtp } from './bot-format';

export { normPhone, normPlaca, reportSummary, type ReportSummary } from './bot-format';

const OTP_TTL_MS = 10 * 60 * 1000; // el OTP vive 10 minutos
const OTP_MAX_ATTEMPTS = 5;

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
 * Nivel que el número tiene DERECHO a ver de una placa. Toma el MAYOR entre: su cupo (si está vinculado
 * y habilitado) y lo que haya PAGADO para esa placa. Si no, BASIC. Se usa para recortar el reporte antes
 * de resumirlo: así un número BASIC no ve el resumen PRO/ULTRA que otro usuario ya generó.
 */
export async function entitledBotTier(userId: string | null, placa?: string): Promise<'BASIC' | 'PRO' | 'ULTRA'> {
  if (!userId) return 'BASIC';
  let tier: 'BASIC' | 'PRO' | 'ULTRA' = 'BASIC';
  const access = await getUserCupo(userId);
  if (access?.enabled) tier = access.tier;
  if (placa) {
    const paid = await getPaidTierByUserId(userId, placa);
    if (TIER_RANK[paid as ReportTier] > TIER_RANK[tier as ReportTier]) tier = paid;
  }
  return tier;
}

/** Busca una cuenta por correo (perfiles, case-insensitive). null si no existe. */
async function findUserByEmail(emailRaw: string): Promise<{ id: string; email: string | null } | null> {
  const email = (emailRaw ?? '').trim().toLowerCase();
  if (!email) return null;
  const sb = createAdminClient();
  const { data } = await sb.from('profiles').select('id, email').ilike('email', email).limit(1);
  const row = (data ?? [])[0] as { id: string; email: string | null } | undefined;
  return row ?? null;
}

function otpEmailHtml(code: string): string {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:440px;margin:0 auto;color:#12201b">
      <h2 style="margin:0 0 8px">Código para vincular tu WhatsApp</h2>
      <p style="color:#5b6b64;margin:0 0 16px">Ingresa este código en el chat de PlacaPe para conectar tu número a tu cuenta.</p>
      <div style="font-size:30px;font-weight:800;letter-spacing:8px;background:#f0f4f2;border:1px solid #dde5e0;border-radius:10px;padding:16px;text-align:center">${code}</div>
      <p style="color:#5b6b64;font-size:13px;margin:16px 0 0">Vence en 10 minutos. Si no lo pediste, ignora este correo.</p>
    </div>`;
}

export type StartLinkStatus = 'otp_sent' | 'no_account' | 'invalid' | 'error';

/**
 * Inicia la vinculación del número: valida que exista una cuenta con ese correo, genera un OTP (guarda
 * su HASH + caducidad) y lo envía por correo (Resend). NO vincula todavía (eso ocurre al verificar).
 */
export async function startLink(phone: string, emailRaw: string): Promise<{ status: StartLinkStatus }> {
  const ph = normPhone(phone);
  const email = (emailRaw ?? '').trim().toLowerCase();
  if (!ph || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { status: 'invalid' };
  try {
    const user = await findUserByEmail(email);
    if (!user) return { status: 'no_account' };
    const code = genOtp();
    const sb = createAdminClient();
    await sb.from('bot_users').upsert({
      phone: ph, email,
      otp_code: hashOtp(code),
      otp_expires: new Date(Date.now() + OTP_TTL_MS).toISOString(),
      otp_attempts: 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone' });
    await sendEmail({ to: email, subject: 'Tu código de PlacaPe', html: otpEmailHtml(code) });
    return { status: 'otp_sent' };
  } catch {
    return { status: 'error' };
  }
}

export type VerifyLinkStatus = 'linked' | 'expired' | 'invalid_code' | 'too_many' | 'no_pending' | 'error';

/**
 * Verifica el OTP y, si es correcto, VINCULA el número a la cuenta (set user_id + verified, limpia el
 * OTP). Anti-fuerza-bruta: cuenta intentos fallidos y bloquea tras OTP_MAX_ATTEMPTS.
 */
export async function verifyLink(phone: string, codeRaw: string): Promise<{ status: VerifyLinkStatus; tier?: 'BASIC' | 'PRO' | 'ULTRA'; remaining?: number }> {
  const ph = normPhone(phone);
  const code = (codeRaw ?? '').replace(/\D/g, '');
  if (!ph || code.length !== 6) return { status: 'invalid_code' };
  try {
    const sb = createAdminClient();
    const { data } = await sb
      .from('bot_users').select('email, otp_code, otp_expires, otp_attempts').eq('phone', ph).maybeSingle();
    const row = data as { email: string | null; otp_code: string | null; otp_expires: string | null; otp_attempts: number | null } | null;
    if (!row || !row.otp_code || !row.otp_expires) return { status: 'no_pending' };
    if (new Date(row.otp_expires).getTime() < Date.now()) return { status: 'expired' };
    const attempts = Number(row.otp_attempts ?? 0);
    if (attempts >= OTP_MAX_ATTEMPTS) return { status: 'too_many' };
    if (hashOtp(code) !== row.otp_code) {
      await sb.from('bot_users').update({ otp_attempts: attempts + 1 }).eq('phone', ph);
      return { status: 'invalid_code', remaining: Math.max(0, OTP_MAX_ATTEMPTS - attempts - 1) };
    }
    const user = row.email ? await findUserByEmail(row.email) : null;
    if (!user) return { status: 'no_pending' }; // la cuenta ya no existe
    await sb.from('bot_users').update({
      user_id: user.id, verified: true, otp_code: null, otp_expires: null, otp_attempts: 0,
      updated_at: new Date().toISOString(),
    }).eq('phone', ph);
    const tier = await entitledBotTier(user.id);
    return { status: 'linked', tier };
  } catch {
    return { status: 'error' };
  }
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
