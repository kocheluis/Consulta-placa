/* eslint-disable no-console */
import { SectionKind, SectionStatus, type Report, type IaAnalysis, type SectionResult } from '@app/shared';

/**
 * Análisis con IA del nivel ULTRA: Claude lee TODO el reporte y devuelve un veredicto de
 * compra, recomendación, banderas priorizadas y un comentario de precio. Llamada directa a la
 * Messages API por `fetch` (el motor ya usa fetch para todo lo externo; el deploy no corre
 * `npm install`, así que no se agrega el SDK). Structured output (`output_config.format`)
 * garantiza JSON válido; sin thinking (el esquema ya acota la salida → rápido y predecible).
 *
 * PRIVACIDAD: se envía un resumen DE-IDENTIFICADO (sin nombres ni DNI de terceros), solo
 * hechos de riesgo (marca/año, banderas, montos, fechas, estados). Menos PII y menos tokens.
 *
 * Detrás de env: si falta `ANTHROPIC_API_KEY` se OMITE (devuelve null) — el reporte ULTRA
 * sale sin la sección IA en vez de romperse; se activa agregando la clave (patrón "solo env").
 */
const API_KEY = () => process.env.ANTHROPIC_API_KEY ?? '';
const MODEL = () => process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';
const BASE = () => (process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/+$/, '');

const IA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['comprar', 'precaucion', 'evitar'] },
    summary: { type: 'string' },
    recommendation: { type: 'string' },
    priceComment: { type: 'string' },
    redFlags: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['alta', 'media', 'baja'] },
          detail: { type: 'string' },
        },
        required: ['title', 'severity', 'detail'],
      },
    },
    positives: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'summary', 'recommendation', 'priceComment', 'redFlags', 'positives'],
} as const;

const SYSTEM = `Eres un asesor experto en compra de vehículos usados en Perú. A partir de los datos de \
due-diligence de un vehículo (identidad registral, SOAT, siniestralidad, papeletas, orden de captura, \
revisión técnica, gravámenes e historial de transferencias), das una recomendación clara y honesta al \
comprador. Sé directo y prioriza lo que más impacta la decisión: siniestros/remates, gravámenes vigentes, \
orden de captura, muchas transferencias en poco tiempo, papeletas altas o revisión técnica vencida.
Reglas:
- Veredicto: "comprar" (sin señales relevantes), "precaucion" (señales que exigen verificación) o "evitar" \
(señales graves: siniestro/pérdida total, gravamen vigente, orden de captura).
- priceComment: comentario CUALITATIVO sobre el precio basado SOLO en los precios declarados del historial, \
la antigüedad y la ficha técnica (versión exacta, combustible, cilindrada — una versión tope/GNV o con más \
equipamiento no vale igual que la base). NO inventes una tasación de mercado; aclara que no es un avalúo y que \
se recomienda comparar con avisos del mercado.
- No inventes datos que no estén en la entrada. Si un dato falta o la fuente falló, dilo. Escribe en español, \
claro y conciso.`;

/** Construye un resumen DE-IDENTIFICADO del reporte para enviar a la IA (sin nombres ni DNI). */
function buildSummary(report: Report): Record<string, unknown> {
  const byKind = (k: string): SectionResult | undefined => report.sections.find((s) => s.kind === k && s.status === 'AVAILABLE');
  const p = (k: string): Record<string, unknown> => (byKind(k)?.payload ?? {}) as Record<string, unknown>;
  const v = report.vehicle;

  const seg = p('SEGUROS');
  const sin = p('SINIESTRALIDAD');
  const pap = p('PAPELETAS');
  const cap = p('CAPTURA');
  const rev = p('REVISION_TECNICA');
  const grav = p('GRAVAMENES');
  const hist = p('HISTORIAL');
  const especs = p('IDENTIDAD_ESPECIFICA');

  const auction = (sin.auction ?? null) as Record<string, unknown> | null;
  const gravItems = ((grav.items ?? []) as Array<Record<string, unknown>>).map((it) => ({
    tipo: it.type, acreedor: it.creditor, monto: it.amount, estado: it.status, fecha: it.date,
  }));
  // Historial SIN participantes (nombres/DNI): solo acto, fecha y precio declarado. Cada asiento
  // puede traer varias acciones (tracto sucesivo / cancelación + compra-venta): se aplanan, con la
  // fecha del asiento, para que la IA vea cada precio por separado (nunca sumados).
  const eventos = ((hist.events ?? []) as Array<{ date?: unknown; acciones?: Array<Record<string, unknown>> }>).flatMap((e) =>
    (e.acciones ?? []).map((a) => ({ fecha: e.date, acto: a.act, precio: a.price })),
  );

  return {
    vehiculo: v ? { marca: v.brand, modelo: v.model, anio: v.year, color: v.color, placa: v.plateDisplay, alertaRobo: v.stolenAlert } : null,
    // Ficha técnica del asiento registral (sin PII): versión exacta + características → afina el
    // comentario de precio (una versión GNV/tope de gama no vale igual que la base) y el uso.
    identidadEspecifica: byKind('IDENTIDAD_ESPECIFICA')
      ? { version: especs.version, categoria: especs.category, uso: especs.usage, carroceria: especs.bodywork, combustible: especs.fuel, cilindrada: especs.displacement, potencia: especs.power, asientos: especs.seats, pesoBruto: especs.grossWeight }
      : 'fuente no disponible',
    soat: byKind('SEGUROS') ? { vigente: seg.hasActiveSoat, compania: seg.insurer } : 'fuente no disponible',
    siniestralidad: byKind('SINIESTRALIDAD')
      ? { registraSiniestro: sin.hasSiniestro, accidentesSoat: sin.accidentes, periodoAnios: sin.periodYears, subasta: auction ? { tipo: auction.tipo, fuente: auction.fuente, estado: auction.estado } : null }
      : 'fuente no disponible',
    papeletas: byKind('PAPELETAS') ? { cantidad: pap.total, montoPendiente: pap.pendingAmount } : 'fuente no disponible',
    ordenCaptura: byKind('CAPTURA') ? { registra: cap.hasCapture } : 'fuente no disponible',
    revisionTecnica: byKind('REVISION_TECNICA') ? { vigente: rev.hasValid, estado: rev.status, vence: rev.validUntil } : 'fuente no disponible',
    gravamenes: byKind('GRAVAMENES') ? { registraVigente: grav.hasLiens, total: grav.total, items: gravItems } : 'fuente no disponible',
    historial: byKind('HISTORIAL')
      ? { transferencias: hist.transfers, totalAsientos: hist.totalAsientos, banderas: hist.flags, eventos }
      : 'fuente no disponible',
  };
}

/** Genera el análisis IA del reporte. Devuelve null si no hay API key o si la llamada falla. */
export async function analyzeReportWithAI(report: Report): Promise<IaAnalysis | null> {
  const key = API_KEY();
  if (!key) { console.log('[ia] ANTHROPIC_API_KEY no configurada → omito análisis IA'); return null; }
  const model = MODEL();
  const summary = buildSummary(report);

  // `effort` NO existe en Haiku 4.5 ni Sonnet 4.5 (devuelven 400). Se envía solo si el modelo
  // lo soporta (Opus 4.5+/4.6+/4.7/4.8, Sonnet 4.6, Fable 5) → así basta cambiar ANTHROPIC_MODEL
  // a claude-haiku-4-5 (más asequible) sin tocar código.
  const supportsEffort = !/haiku|sonnet-4-5/i.test(model);
  const outputConfig: Record<string, unknown> = { format: { type: 'json_schema', schema: IA_SCHEMA } };
  if (supportsEffort) outputConfig.effort = 'medium';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(`${BASE()}/v1/messages`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        output_config: outputConfig,
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: `Analiza este vehículo y devuelve tu recomendación de compra.\n\nDATOS (JSON):\n${JSON.stringify(summary, null, 2)}`,
        }],
      }),
    });
    if (!res.ok) { console.warn(`[ia] Messages API ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`); return null; }
    const data = (await res.json()) as { stop_reason?: string; content?: Array<{ type: string; text?: string }> };
    if (data.stop_reason === 'refusal') { console.warn('[ia] la IA declinó el análisis (refusal)'); return null; }
    const text = (data.content ?? []).find((b) => b.type === 'text')?.text ?? '';
    if (!text) { console.warn('[ia] respuesta sin bloque de texto'); return null; }
    const parsed = JSON.parse(text) as IaAnalysis;
    if (!parsed.verdict || !Array.isArray(parsed.redFlags)) { console.warn('[ia] JSON con forma inesperada'); return null; }
    return { ...parsed, model };
  } catch (e) {
    console.warn('[ia] análisis falló (no bloquea el reporte):', (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Adjunta la sección IA a un Report: devuelve una copia con la sección agregada. */
export function attachIaSection(report: Report, ia: IaAnalysis, at: string): Report {
  const section: SectionResult = { kind: SectionKind.IA, source: null, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: ia };
  return { ...report, sections: [...report.sections.filter((s) => s.kind !== SectionKind.IA), section] };
}
