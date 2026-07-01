/**
 * Envío de WhatsApp por la Meta Cloud API (Graph). Server-only. Detrás de env: si no está
 * configurado (faltan WHATSAPP_TOKEN / WHATSAPP_PHONE_ID / WHATSAPP_TEMPLATE) se OMITE
 * (`skipped`) sin romper el flujo — así el correo funciona ya y WhatsApp se activa al
 * completar el onboarding de Meta, solo agregando env (sin tocar código).
 *
 * IMPORTANTE: un mensaje PROACTIVO ("tu reporte está listo") exige una **plantilla
 * aprobada** por Meta (no se puede texto libre fuera de la ventana de 24 h). Crea una
 * plantilla con 2 variables de cuerpo — {{1}} = placa, {{2}} = enlace del reporte — y pon su
 * nombre en WHATSAPP_TEMPLATE (idioma en WHATSAPP_TEMPLATE_LANG, por defecto es_PE/es).
 */
const TOKEN = process.env.WHATSAPP_TOKEN ?? '';
const PHONE_ID = process.env.WHATSAPP_PHONE_ID ?? '';
const TEMPLATE = process.env.WHATSAPP_TEMPLATE ?? '';
const LANG = process.env.WHATSAPP_TEMPLATE_LANG ?? 'es';
const GRAPH = process.env.WHATSAPP_GRAPH_VERSION ?? 'v21.0';

/** ¿Está configurado el envío de WhatsApp? */
export const isWhatsAppConfigured = Boolean(TOKEN && PHONE_ID && TEMPLATE);

export interface WhatsAppResult {
  ok: boolean;
  id?: string;
  /** true si se omitió por falta de configuración o número inválido. */
  skipped?: boolean;
  error?: string;
}

/** Normaliza a MSISDN internacional de Perú (51XXXXXXXXX) desde 9 dígitos o con prefijos. */
function normalizePeMsisdn(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 9 && d.startsWith('9')) return `51${d}`; // celular peruano local
  if (d.startsWith('51') && d.length === 11) return d; // ya internacional
  if (d.length >= 11) return d; // otro país, ya internacional
  return null;
}

/** Envía el aviso "tu reporte está listo" por WhatsApp (plantilla aprobada). */
export async function sendWhatsAppReportReady(input: {
  to: string;
  plate: string;
  reportUrl: string;
}): Promise<WhatsAppResult> {
  if (!isWhatsAppConfigured) return { ok: false, skipped: true, error: 'WhatsApp no configurado' };
  const to = normalizePeMsisdn(input.to);
  if (!to) return { ok: false, skipped: true, error: 'número de WhatsApp inválido' };
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH}/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: TEMPLATE,
          language: { code: LANG },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: input.plate },
                { type: 'text', text: input.reportUrl },
              ],
            },
          ],
        },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `WhatsApp ${res.status}: ${detail.slice(0, 300)}` };
    }
    const data = (await res.json()) as { messages?: Array<{ id?: string }> };
    return { ok: true, id: data.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'fallo de red' };
  }
}
