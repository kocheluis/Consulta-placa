/**
 * Envío de correo transaccional vía Resend (REST API, sin SDK ni dependencias).
 * Server-only: usa `RESEND_API_KEY` (nunca `NEXT_PUBLIC_*`). Importar solo desde
 * route handlers / server actions / el worker — nunca desde un componente cliente.
 *
 * Reparto de responsabilidades (ver specs/.../email.md):
 *  - Confirmación de cuenta / reset → los envía **Supabase** con SMTP de Resend.
 *  - Entrega de reportes, recibos, avisos → los envía la app con `sendEmail()`.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Remitente de sistema y reply-to humano (buzón Zoho). Configurables por env. */
export const EMAIL_FROM = process.env.EMAIL_FROM ?? 'PlacaPe <no-reply@placape.pe>';
export const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO ?? 'soporte@placape.pe';

/** ¿Está configurado Resend? Si no, los envíos se omiten (no rompen el flujo). */
export const isEmailConfigured = RESEND_API_KEY.length > 0;

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  from?: string;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  /** true si se omitió por falta de API key (local/preview sin secretos). */
  skipped?: boolean;
  error?: string;
}

/**
 * Envía un correo con Resend. Nunca lanza: devuelve un resultado que el llamador
 * decide cómo tratar. `skipped:true` cuando no hay API key configurada.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!isEmailConfigured) {
    return { ok: false, skipped: true, error: 'RESEND_API_KEY no configurada' };
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: input.from ?? EMAIL_FROM,
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html: input.html,
        reply_to: input.replyTo ?? EMAIL_REPLY_TO,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `Resend ${res.status}: ${detail.slice(0, 300)}` };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'fallo de red' };
  }
}
