/* eslint-disable no-console */
import { SectionKind, SectionStatus, buildValuation, type Report, type IaAnalysis, type SectionResult, type Valuation } from '@app/shared';

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
const OPENAI_KEY = () => process.env.OPENAI_API_KEY ?? '';
const OPENAI_MODEL = () => process.env.OPENAI_MODEL ?? 'gpt-4o';
const OPENAI_BASE = () => (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com').replace(/\/+$/, '');

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
    valuation: {
      type: 'object',
      additionalProperties: false,
      properties: {
        baseMin: { type: 'number' },
        baseMax: { type: 'number' },
        confidence: { type: 'string', enum: ['alta', 'media', 'baja'] },
        basis: { type: 'string' },
      },
      required: ['baseMin', 'baseMax', 'confidence', 'basis'],
    },
  },
  required: ['verdict', 'summary', 'recommendation', 'priceComment', 'redFlags', 'positives', 'valuation'],
} as const;

const SYSTEM = `Eres un asesor experto en compra-venta de vehículos usados en Perú. Recibes el reporte de \
due-diligence COMPLETO de un vehículo (identidad registral y ficha técnica, SOAT/seguros, siniestralidad y \
remates, papeletas, orden de captura, revisión técnica, gravámenes, historial de asientos con transferencias \
y precios, cambios registrados y el último precio de compra). Tu análisis es el PLUS del reporte: integra TODO \
y das una recomendación clara, honesta y accionable al comprador.

Prioriza lo que más pesa en la decisión y CRÚZALO entre fuentes:
- Siniestro / pérdida total / remate por ASEGURADORA o por choque → castiga el precio y la reventa.
- Gravamen/carga VIGENTE u orden de captura → traban la transferencia; deben levantarse ANTES de comprar.
- Anotación de robo (vigente = no comprar; cancelada = verificar que quedó saneada).
- Cambio de MOTOR o de características/serie → posible adulteración/clonación: exige peritar el motor y el VIN \
físicos contra la tarjeta de identificación y el registro.
- Muchas transferencias en poco tiempo → auto potencialmente problemático o de reventa.
- Uso como taxi/servicio o conversión a GNV → mayor desgaste y menor valor.
- Papeletas pendientes y RTV vencida → deudas/gestiones a resolver antes de firmar.
- COHERENCIA DE PRECIO: compara el último precio de compra registrado + la antigüedad + la valorización estimada; \
si el precio de venta está muy por encima del mercado o del último precio, adviértelo.

Reglas de salida:
- verdict: "comprar" (sin señales relevantes), "precaucion" (señales que exigen verificación) o "evitar" (señales \
graves: siniestro/pérdida total, gravamen vigente, orden de captura, robo vigente).
- summary: 2-4 frases integrando lo más importante de TODAS las fuentes.
- recommendation: pasos CONCRETOS para el comprador. Incluye SIEMPRE que aplique: (1) exigir que el vendedor sea \
el TITULAR REGISTRAL (mismo DNI que figura en SUNARP) o tenga poder notarial vigente — nunca cerrar con un \
intermediario sin acreditar representación; (2) inspección mecánica independiente (y peritaje de motor/VIN si \
hubo cambio de motor); (3) transferir la propiedad de INMEDIATO tras la compra; (4) exigir el levantamiento de \
gravámenes y el pago de papeletas ANTES de firmar. Recuerda que las multas electorales del titular (aún no \
consultadas) pueden trabar la transferencia notarial: recomienda verificarlas.
- priceComment: comenta el precio frente a la valorización estimada y al último precio de compra; aclara que no \
es un avalúo y que conviene comparar con avisos del mercado (Neoauto, Mercado Libre).
- valuation: estima el PRECIO BASE de mercado en Perú, en SOLES (S/), para el MODELO por marca, modelo, VERSIÓN \
exacta y año, en BUEN estado y km PROMEDIO. IMPORTANTE: IGNORA la condición específica de ESTE vehículo \
(siniestros, remates, km, gravámenes, papeletas, uso taxi) — el sistema aplica esos descuentos APARTE sobre tu \
base. Devuelve baseMin y baseMax (venta ENTRE PARTICULARES, no de concesionario) usando el mercado peruano de \
usados, el tipo de cambio (~S/ 3.7/US$) y el último precio de compra como referencia. Devuelve baseMin=0, \
baseMax=0 SOLO si desconoces el precio del MODELO en sí (muy raro/importado sin referencia) — NUNCA por el mal \
estado del vehículo (un auto siniestrado igual tiene un precio base de mercado que el sistema luego castiga). \
confidence: "alta"/"media"/"baja". basis: 1 frase. El sistema añade luego las bandas por km y los descuentos.
- redFlags: prioriza por severidad (alta/media/baja) las señales anteriores que apliquen.
- positives: puntos a favor reales (sin siniestros, sin gravámenes vigentes, RTV vigente, pocos dueños, etc.).
- No inventes datos que no estén en la entrada. Si un dato falta o la fuente falló, dilo. Español claro y conciso.`;

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
  // Cambios registrales relevantes para la decisión (de los actos del historial).
  const actosHist = eventos.map((e) => String(e.acto ?? ''));
  const cambiosRegistrados = {
    motor: actosHist.some((a) => /cambio de motor|rectificaci[oó]n de (no\.?\s*)?motor/i.test(a)),
    color: actosHist.some((a) => /cambio de color/i.test(a)),
    caracteristicasOconversion: actosHist.some((a) => /cambio de caracter|conversi[oó]n/i.test(a)),
    aTaxiOservicio: actosHist.some((a) => /tipo de uso.*(taxi|servicio)|a\s*taxi/i.test(a)),
    anotacionRobo: actosHist.some((a) => /anotaci[oó]n de robo/i.test(a)),
  };
  // Último precio de compra: la compra-venta/adjudicación MÁS RECIENTE con precio (eventos van de
  // más antiguo a más reciente) → ancla para juzgar si el precio pedido es coherente.
  const compras = eventos.filter((e) => /compra\s*-?\s*venta|adjudicaci[oó]n/i.test(String(e.acto ?? '')) && e.precio);
  const ultimaCompra = compras[compras.length - 1] ?? null;

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
      ? { transferencias: hist.transfers, totalAsientos: hist.totalAsientos, banderas: hist.flags, cambiosRegistrados, eventos }
      : 'fuente no disponible',
    // Ancla de precio para la valorización y el veredicto.
    ultimoPrecioCompra: ultimaCompra ? { precio: ultimaCompra.precio, fecha: ultimaCompra.fecha } : null,
    // Para la recomendación "trato con el propietario": hay titular registral en SUNARP (sin exponer su identidad).
    titularRegistralEnSunarp: Boolean(report.vehicle?.owner),
    // Multas electorales del titular (por DNI): portal del JNE con anti-bot Imperva → aún no consultado.
    multasElectorales: 'no consultado (portal del JNE con anti-bot; pendiente)',
  };
}

/** Llama a Anthropic (Messages API) con structured output. Devuelve el texto JSON + el modelo. */
async function callAnthropic(userText: string, signal: AbortSignal): Promise<{ text: string; model: string }> {
  const model = MODEL();
  // `effort` NO existe en Haiku 4.5 ni Sonnet 4.5 (devuelven 400). Se envía solo si el modelo
  // lo soporta (Opus 4.5+/4.6+/4.7/4.8, Sonnet 4.6, Fable 5) → basta cambiar ANTHROPIC_MODEL.
  const outputConfig: Record<string, unknown> = { format: { type: 'json_schema', schema: IA_SCHEMA } };
  if (!/haiku|sonnet-4-5/i.test(model)) outputConfig.effort = 'medium';
  const res = await fetch(`${BASE()}/v1/messages`, {
    method: 'POST', signal,
    headers: { 'x-api-key': API_KEY(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 4000, output_config: outputConfig, system: SYSTEM, messages: [{ role: 'user', content: userText }] }),
  });
  if (!res.ok) { console.warn(`[ia] Anthropic ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`); return { text: '', model }; }
  const data = (await res.json()) as { stop_reason?: string; content?: Array<{ type: string; text?: string }> };
  if (data.stop_reason === 'refusal') { console.warn('[ia] la IA declinó el análisis (refusal)'); return { text: '', model }; }
  return { text: (data.content ?? []).find((b) => b.type === 'text')?.text ?? '', model };
}

/** Llama a OpenAI (Chat Completions) con structured output (json_schema strict). */
async function callOpenai(userText: string, signal: AbortSignal): Promise<{ text: string; model: string }> {
  const model = OPENAI_MODEL();
  const res = await fetch(`${OPENAI_BASE()}/v1/chat/completions`, {
    method: 'POST', signal,
    headers: { authorization: `Bearer ${OPENAI_KEY()}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userText }],
      response_format: { type: 'json_schema', json_schema: { name: 'reporte_vehicular', strict: true, schema: IA_SCHEMA } },
    }),
  });
  if (!res.ok) { console.warn(`[ia] OpenAI ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`); return { text: '', model }; }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string; refusal?: string } }> };
  const msg = data.choices?.[0]?.message;
  if (msg?.refusal) { console.warn('[ia] OpenAI declinó (refusal):', msg.refusal.slice(0, 150)); return { text: '', model }; }
  return { text: msg?.content ?? '', model };
}

/**
 * Genera el análisis IA del reporte. Usa Anthropic si hay `ANTHROPIC_API_KEY`; si no, OpenAI con
 * `OPENAI_API_KEY` (mismo esquema JSON) → la valorización y la recomendación funcionan con cualquiera
 * de las dos. Devuelve null si no hay ninguna clave o si la llamada falla (no bloquea el reporte).
 */
export async function analyzeReportWithAI(report: Report): Promise<IaAnalysis | null> {
  const anthropic = !!API_KEY();
  const openai = !!OPENAI_KEY();
  if (!anthropic && !openai) { console.log('[ia] sin ANTHROPIC_API_KEY ni OPENAI_API_KEY → omito análisis IA'); return null; }
  const summary = buildSummary(report);
  const userText = `Analiza este vehículo y devuelve tu recomendación de compra.\n\nDATOS (JSON):\n${JSON.stringify(summary, null, 2)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const { text, model } = anthropic ? await callAnthropic(userText, controller.signal) : await callOpenai(userText, controller.signal);
    if (!text) { console.warn('[ia] respuesta vacía'); return null; }
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

/** Extrae del reporte las señales de condición que ajustan el precio (siniestro, taxi, GNV, etc.). */
function extractCondition(report: Report, currentYear: number) {
  const byKind = (k: string): SectionResult | undefined => report.sections.find((s) => s.kind === k && s.status === 'AVAILABLE');
  const p = (k: string): Record<string, unknown> => (byKind(k)?.payload ?? {}) as Record<string, unknown>;
  const sin = p('SINIESTRALIDAD'), grav = p('GRAVAMENES'), pap = p('PAPELETAS'), hist = p('HISTORIAL');
  const especs = p('IDENTIDAD_ESPECIFICA'), rev = p('REVISION_TECNICA'), trans = p('TRANSPORTE');
  const year = report.vehicle?.year ?? null;

  const gravMonto = ((grav.items ?? []) as Array<Record<string, unknown>>)
    .filter((it) => it.status !== 'LEVANTADO')
    .reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const actos = ((hist.events ?? []) as Array<{ acciones?: Array<Record<string, unknown>> }>)
    .flatMap((e) => (e.acciones ?? []).map((a) => String(a.act ?? '')));
  const roboVigente = Boolean(report.vehicle?.stolenAlert)
    || (actos.some((a) => /anotaci[oó]n de robo/i.test(a)) && !actos.some((a) => /cancelaci[oó]n de anotaci[oó]n robo/i.test(a)));

  return {
    siniestro: Boolean(sin.hasSiniestro),
    usoTaxi: Boolean(trans.isPublicTransport) || /taxi|transporte|servicio|colectiv|mercanc/i.test(String(rev.serviceType ?? '')),
    gnv: /gnv|glp|gas natural|bi-?combustible/i.test(String(especs.fuel ?? '')),
    gravamenVigente: Boolean(grav.hasLiens),
    gravamenMonto: gravMonto > 0 ? gravMonto : null,
    papeletasPendientes: Number(pap.pendingAmount) || 0,
    transfers: Number(hist.transfers) || 0,
    roboVigente,
    revisionVencida: Boolean(byKind('REVISION_TECNICA')) && !rev.hasValid && !!year && currentYear - (year as number) >= 4,
  };
}

/**
 * Arma la sección VALORIZACION a partir del precio base que estimó la IA + la condición del reporte,
 * y la adjunta al Report. Si la IA no devolvió base (o no hubo IA), no agrega la sección.
 */
export function attachValuationSection(report: Report, ia: IaAnalysis, at: string, currentYear: number): Report {
  if (!ia.valuation) return report;
  const cond = extractCondition(report, currentYear);
  const valuation: Valuation = buildValuation({
    baseMin: ia.valuation.baseMin, baseMax: ia.valuation.baseMax,
    confidence: ia.valuation.confidence, basis: ia.valuation.basis,
    year: report.vehicle?.year ?? null, currentYear, ...cond,
  });
  const section: SectionResult = { kind: SectionKind.VALORIZACION, source: null, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: valuation };
  return { ...report, sections: [...report.sections.filter((s) => s.kind !== SectionKind.VALORIZACION), section] };
}
