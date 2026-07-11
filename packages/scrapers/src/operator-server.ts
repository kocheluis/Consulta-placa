/* eslint-disable no-console */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { runSingleSource, OPERATOR_SOURCES, buildBatchLanes, type OperatorSourceResult } from './operator/index.js';
import { orchestrateBatch, type OrchJob } from './operator/batch.js';
import { killEngineChrome } from './operator/chrome-path.js';
import { getQueue, type Pedido } from './operator/queue.js';
import { toWebReport } from './operator/report-transform.js';
import { publishReport, fetchReport, fetchReportsMeta } from './operator/report-store.js';
import { scrapeSunarpViaCdp } from './operator/cdp-sunarp.js';
import { analyzeReportWithAI, attachIaSection, attachValuationSection } from './operator/ai-analysis.js';
import { metaGet, metaSet } from './db/repo.js';
import type { Report } from '@app/shared';

// Carga secretos del VPS desde un archivo KEY=VALUE (Supabase, CapSolver…), sin hornearlos
// en pm2. Es la FUENTE DE VERDAD: el archivo GANA sobre el entorno de pm2 (así un valor
// viejo/truncado en pm2 no pisa el correcto). Corre antes de leer el entorno (getQueue/consts).
// Solo afecta a las claves presentes en el archivo. Default /root/placape.env
// (override con OPERATOR_ENV_FILE). Dev/Windows (sin archivo) → no-op.
(function loadEnvFile() {
  const f = process.env.OPERATOR_ENV_FILE ?? '/root/placape.env';
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[1]) process.env[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '');
    }
  } catch { /* sin archivo → nada */ }
})();

/**
 * Panel de control del operador PlacaPe. Servidor Node nativo. Dos modos conviven:
 *  - **Motor automático** (cableado central): un runner toma pedidos de la cola por
 *    orden de llegada y corre el reporte completo solo (SPRL ya es automático). Se
 *    enciende/apaga desde el panel; el estado se persiste. Una **marquesina** muestra
 *    los pedidos pendientes/en-proceso con su fecha y hora.
 *  - **Manual**: el operador pega una placa y corre el motor a mano (QA / reprocesos),
 *    con barra de progreso (SSE) y Cancelar.
 *
 * Uso:  CAPTCHA_API_KEY=... PLACAPE_DB=/root/data/placape.db npx tsx packages/scrapers/src/operator-server.ts
 */
const PORT = Number(process.env.OPERATOR_PORT ?? 3010);
const KEY = process.env.CAPTCHA_API_KEY ?? '';
const PROVIDER = process.env.CAPTCHA_PROVIDER ?? 'capsolver';
const N8N_WEBHOOK = process.env.N8N_WEBHOOK_URL ?? '';
const OUT_BASE = process.env.OPERATOR_OUT_BASE ?? 'd:/Jose/Proyecto_Consulta_placa/validacion-fuentes/operador';
// Fuentes que corre el motor automático por pedido (reporte completo; SPRL incluido).
const AUTO_SOURCES = process.env.AUTO_SOURCES?.split(',').map((s) => s.trim()).filter(Boolean)
  // 'atu' entra por CDP nativo (Chrome real + reCAPTCHA v3 nativo): pasa el score desde la IP
  // del VPS (validado en vivo jul-2026, ENCONTRADO y SIN_REGISTRO). Ver operator/atu-cdp.ts.
  // 'apeseg-soat' = SOAT en TIEMPO REAL (la SBS está congelada en may-2024). El transform prefiere
  // APESEG; SBS queda para la siniestralidad (accidentes) y para el CAT de taxis (APESEG solo trae SOAT).
  ?? ['sunarp', 'historial', 'superbid', 'sat-captura', 'sat-papeletas', 'callao-papeletas', 'mtc-citv', 'apeseg-soat', 'sbs-soat', 'atu', 'sigm'];
// Fuentes del reporte GRATUITO (pedido tier=BASIC): identidad + SOAT + revisión técnica.
// SOAT vía APESEG (tiempo real, 1 captcha, rápido). NO se corre SBS en BASIC: su escaneo de
// siniestralidad son 3 tipos = 3 reCAPTCHA (lento) y es un concepto PRO. El paywall hace lo demás.
const BASIC_SOURCES = process.env.BASIC_SOURCES?.split(',').map((s) => s.trim()).filter(Boolean)
  ?? ['sunarp', 'apeseg-soat', 'mtc-citv'];
// Para incrustar el reporte del cliente en la consola (pestaña "Reporte al usuario").
// WEB_REPORT_URL = base de la web (p. ej. https://placape.vercel.app); el token debe
// coincidir con OPERATOR_PREVIEW_TOKEN configurado en la web (Vercel).
const WEB_REPORT_URL = (process.env.WEB_REPORT_URL ?? '').replace(/\/+$/, '');
const OPERATOR_PREVIEW_TOKEN = process.env.OPERATOR_PREVIEW_TOKEN ?? '';
// Vida del enlace de preview firmado (opción B). Corto a propósito: es solo para que el operador
// vea el reporte del cliente en la consola; un enlace filtrado muere pronto. Default 10 min.
const PREVIEW_TTL_SEC = Math.max(60, Number(process.env.OPERATOR_PREVIEW_TTL_SEC ?? 600));
if (!KEY) { console.error('Falta CAPTCHA_API_KEY (CapSolver) en el entorno.'); process.exit(1); }

/**
 * Firma un token de preview EFÍMERO para una placa (opción B). El secreto compartido
 * (OPERATOR_PREVIEW_TOKEN) NUNCA sale al navegador ni a la URL — solo esta firma HMAC con
 * expiración, ligada a la placa. La web lo verifica (ver apps/web/lib/preview-token.ts).
 * Formato: `${exp}.${sigBase64url}`, exp en segundos UNIX. Devuelve null si no hay secreto.
 */
function signPreviewToken(placa: string): string | null {
  if (!OPERATOR_PREVIEW_TOKEN) return null;
  const p = placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const exp = Math.floor(Date.now() / 1000) + PREVIEW_TTL_SEC;
  const sig = createHmac('sha256', OPERATOR_PREVIEW_TOKEN).update(`${p}:${exp}`).digest('base64url');
  return `${exp}.${sig}`;
}

const queue = getQueue();
let autoEngine = metaGet<boolean>('auto_engine_enabled') ?? false; // persistido: sobrevive reinicios
let engineBusy = false; // un solo reporte a la vez (lo que aguanta el VPS); serializa auto + manual
let currentAutoJobId: string | null = null; // job del pedido que el motor automático atiende ahora

// Recuperación: pedidos que quedaron 'procesando' por un reinicio del motor (pm2 restart a
// medio reporte) → re-encolar a 'pendiente' para que el runner los retome (si no, quedan colgados).
void queue.requeueStuck()
  .then((n) => { if (n) console.log(`[cola] ${n} pedido(s) 'procesando' huérfano(s) → re-encolado(s) a 'pendiente'`); })
  .catch((e) => console.warn('[cola] requeueStuck:', (e as Error).message));

const plateDir = (plate: string) => join(OUT_BASE, plate.toUpperCase().replace(/[^A-Z0-9]/g, ''));
const baseOpts = (plate: string, source?: string) => ({
  outDir: plateDir(plate), captchaProvider: PROVIDER, captchaApiKey: KEY,
  ...(source && source !== 'sunarp' ? { headless: true } : {}),
});

// Pesos (segundos estimados) para que la barra avance de forma realista por fuente.
const WEIGHT: Record<string, number> = { sunarp: 25, historial: 240, superbid: 80 };
const weightOf = (id: string) => WEIGHT[id] ?? 30;
// Tope POR FUENTE (backstop de robustez). Muy por encima de lo normal: solo corta cuelgues
// reales. historial incluye margen para el failover de la 2ª cuenta SPRL. Override por env
// SRC_TIMEOUT_<FUENTE>_MS no es necesario hoy; ajustar aquí si hiciera falta.
const SRC_TIMEOUT_MS: Record<string, number> = { historial: 7 * 60_000, superbid: 45_000, sunarp: 120_000 };
const SRC_TIMEOUT_DEFAULT = 150_000; // 2.5 min para las fuentes de captcha (SAT/MTC/SBS/Callao)
// Fuentes en paralelo. DEFAULT 1 (secuencial) porque el VPS actual tiene 1 vCPU: con un
// solo núcleo, 2+ navegadores compiten por CPU y va MÁS LENTO (medido: 386s/6-8 vs ~330s
// secuencial). Sube OPERATOR_CONCURRENCY a 2-4 SOLO tras ampliar el VPS a más vCPUs.
const CONCURRENCY = Math.max(1, Number(process.env.OPERATOR_CONCURRENCY ?? 1));
// El reporte GRATIS (BASIC) son solo 3 fuentes ligeras (SUNARP + SBS + MTC) y el grueso de su
// tiempo es ESPERA de red (CapSolver + portales), no CPU. Además SUNARP corre en un Chrome CDP
// aparte, así que solaparlas con las otras dos casi no compite por el núcleo. Por eso el BASIC
// SÍ va en paralelo (default 3) aunque el reporte de pago (6-8 fuentes pesadas) siga secuencial
// en el VPS de 1 vCPU. Revertir con BASIC_CONCURRENCY=1 si hiciera falta.
const BASIC_CONCURRENCY = Math.max(1, Number(process.env.BASIC_CONCURRENCY ?? 3));
// Motor por LOTES: cuando hay ≥2 pedidos, se atienden juntos (historial en 2 hilos SPRL +
// fuentes ligeras transpuestas con reúso de navegador). BATCH_MAX = cuántos pedidos toma el
// lote; LANE_CONCURRENCY = cuántos carriles (navegadores) corren a la vez (tope de RAM: 4 GB).
const BATCH_MAX = Math.max(1, Number(process.env.BATCH_MAX ?? 8));
const LANE_CONCURRENCY = Math.max(1, Number(process.env.BATCH_LANE_CONCURRENCY ?? 2));
// Ventana de agrupación: al liberarse el motor, ESPERA este tiempo para que los pedidos que llegan
// casi juntos entren al MISMO lote (y corran en paralelo) en vez de que el primero arranque solo.
// 0 = desactivado. (Para un lote deliberado también sirve: apaga el motor, encola todo, prende.)
const BATCH_WINDOW_MS = Math.max(0, Number(process.env.BATCH_WINDOW_MS ?? 6000));
const srcDone = (job: Job, src: string) => job.results.some((r) => r.source.toLowerCase().replace(/_/g, '-') === src);

interface Job {
  id: string; plate: string; sources: string[];
  results: OperatorSourceResult[]; percent: number; current: string; step: string;
  done: boolean; cancelled: boolean; error?: string;
  /** Fuentes concurrentes para ESTE job (BASIC va en paralelo; pago, secuencial). */
  concurrency?: number;
}
const jobs = new Map<string, Job>();
// Pedidos del lote EN CURSO (para la consola multi-barra: una barra por pedido).
const batchJobs = new Map<string, OrchJob>();
const newId = () => `j${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Última línea del log de la fuente (sin timestamp) → texto de "paso" en la barra. */
async function lastLogLine(plate: string, id: string): Promise<string> {
  try {
    const txt = await readFile(join(plateDir(plate), `${id}.log`), 'utf8');
    const lines = txt.trim().split('\n');
    return (lines[lines.length - 1] ?? '').replace(/^\S+\s/, '').slice(0, 90);
  } catch { return ''; }
}

// Tope duro por job: si una fuente se cuelga (p. ej. Síguelo sin responder), el motor
// no debe quedar bloqueado para siempre. Por defecto 15 min (override JOB_TIMEOUT_MS).
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS ?? 15 * 60 * 1000);

async function runJob(job: Job): Promise<void> {
  const total = job.sources.reduce((s, id) => s + weightOf(id), 0) || 1;
  let doneW = 0;
  const killer = setTimeout(() => {
    if (!job.done) { job.cancelled = true; job.error = 'timeout (job excedió el tope)'; killEngineChrome(); }
  }, JOB_TIMEOUT_MS);
  // Barra de progreso por peso completado (las fuentes corren en paralelo).
  const tick = setInterval(() => {
    job.percent = Math.min(99, Math.round((doneW / total) * 100));
    const running = job.sources.filter((s) => !srcDone(job, s));
    job.current = running[0] ?? '';
    if (running[0]) void lastLogLine(job.plate, running[0]).then((l) => { if (l) job.step = l; });
  }, 800);

  const pending = [...job.sources];
  const runOne = async (src: string): Promise<void> => {
    const t0 = Date.now();
    let result: OperatorSourceResult;
    // Tope POR FUENTE (backstop): ninguna fuente puede consumir todo el presupuesto del job.
    // Si una se pasa, se marca ERROR y el job sigue con las demás → reporte PARCIAL en vez de
    // que una fuente colgada tumbe todo. Muy por encima de lo normal (historial ~4min).
    const cap = SRC_TIMEOUT_MS[src] ?? SRC_TIMEOUT_DEFAULT;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      result = await Promise.race([
        runSingleSource(job.plate, src, baseOpts(job.plate, src)),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout de fuente (${Math.round(cap / 1000)}s)`)), cap); }),
      ]);
    } catch (e) {
      result = { source: src.toUpperCase(), label: src, category: 'OTRO', status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
    } finally {
      if (timer) clearTimeout(timer);
    }
    doneW += weightOf(src);
    job.results.push(result);
  };
  // Pool de workers: hasta CONCURRENCY fuentes a la vez.
  const worker = async (): Promise<void> => {
    while (pending.length && !job.cancelled) {
      const src = pending.shift();
      if (src) await runOne(src);
    }
  };
  const conc = Math.max(1, job.concurrency ?? CONCURRENCY);
  await Promise.all(Array.from({ length: Math.min(conc, job.sources.length) }, worker));

  clearInterval(tick);
  clearTimeout(killer);
  killEngineChrome(); // libera el Chrome del motor UNA vez, ya que todas las fuentes terminaron
  job.step = '';
  job.current = '';
  job.done = true;
  if (!job.cancelled) {
    job.percent = 100;
    try {
      await mkdir(plateDir(job.plate), { recursive: true });
      await writeFile(join(plateDir(job.plate), 'reporte.json'),
        JSON.stringify({ plate: job.plate, generatedAt: new Date().toISOString(), results: job.results }, null, 2), 'utf8');
    } catch { /* noop */ }
  }
}

// ── REÚSO de reporte (dedup) ────────────────────────────────────────────────────
// Evita re-correr TODAS las fuentes (~3-10 min) cuando ya hay un reporte reciente del MISMO
// dueño. Regla (pedida por el usuario): si existe un reporte de nivel suficiente, con menos de
// REPORT_REUSE_HOURS (48h) y una consulta SUNARP rápida confirma que el propietario NO cambió,
// se reutiliza lo guardado en DB. Si el dueño cambió (se vendió) o no se pudo verificar → regenera.
const REUSE_MS = Math.max(0, Number(process.env.REPORT_REUSE_HOURS ?? 48)) * 3600 * 1000;
// Debajo de esta antigüedad NI SIQUIERA se consulta el dueño: se muestra lo guardado de frente
// (el auto no cambia de dueño de un día para otro). Entre TRUST y REUSE sí se verifica en SUNARP.
const TRUST_MS = Math.max(0, Number(process.env.REPORT_TRUST_HOURS ?? 24)) * 3600 * 1000;
// Pedidos que el operador re-generó a mano (botón "Re-generar") → saltan el reúso.
const forceReprocess = new Set<string>();
const normOwner = (s: string): string =>
  s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
/** ¿El reporte guardado corrió las fuentes PRO (no solo el combo BASIC)? Se infiere por secciones. */
function storedIsFull(report: Report): boolean {
  return report.sections.some((s) =>
    s.kind === 'CAPTURA' || s.kind === 'HISTORIAL' || s.kind === 'GRAVAMENES' ||
    (s.kind === 'PAPELETAS' && s.status !== 'COMING_SOON'));
}
/**
 * Intenta reutilizar el reporte guardado. Devuelve true si lo reutilizó (ya marcó el pedido
 * `listo`). Precondición: el pedido ya está en 'procesando'.
 */
async function tryReuseReport(p: Pedido, tier: string): Promise<boolean> {
  const existing = await fetchReport(p.placa);
  const storedOwner = existing?.report?.vehicle?.owner?.name;
  if (!existing || !storedOwner) return false;
  // Nivel suficiente: si piden PRO/ULTRA, el guardado debe ser "full" (no solo BASIC).
  if (tier !== 'BASIC' && !storedIsFull(existing.report)) return false;
  // ULTRA exige que el reporte guardado YA tenga el análisis IA (un reporte PRO no lo tiene).
  if (tier === 'ULTRA' && !existing.report.sections.some((s) => s.kind === 'IA' && s.status === 'AVAILABLE')) return false;
  // Frescura: dentro de la ventana de reúso.
  const ageMs = Date.now() - new Date(existing.updatedAt).getTime();
  if (!(ageMs >= 0 && ageMs < REUSE_MS)) return false;
  const hrs = (ageMs / 3600000).toFixed(1);
  const reportPath = join(plateDir(p.placa), 'reporte.json');

  // < TRUST_HOURS (24h): muy reciente → mostrar lo guardado DE FRENTE, sin consultar SUNARP.
  if (ageMs < TRUST_MS) {
    console.log(`[dedup] ${p.placa}: reporte de hace ${hrs}h (< ${TRUST_MS / 3600000}h) → REUTILIZO directo, sin verificar dueño`);
    await queue.setDone(p.id, reportPath);
    return true;
  }

  // TRUST..REUSE (24-48h): verifica en SUNARP que el propietario no cambió (consulta rápida).
  console.log(`[dedup] ${p.placa}: reporte de hace ${hrs}h → verificando propietario en SUNARP…`);
  const dir = plateDir(p.placa);
  await mkdir(dir, { recursive: true }).catch(() => {});
  const sun = await scrapeSunarpViaCdp(p.placa, { shotPath: join(dir, 'sunarp.png') }).catch(() => null);
  if (!sun?.ok || !sun.ownerName) {
    console.log(`[dedup] ${p.placa}: no pude verificar el propietario (SUNARP) → regenero completo`);
    return false;
  }
  if (normOwner(sun.ownerName) !== normOwner(storedOwner)) {
    console.log(`[dedup] ${p.placa}: el propietario cambió → regenero completo`);
    return false;
  }
  console.log(`[dedup] ${p.placa}: mismo propietario y < ${REUSE_MS / 3600000}h → REUTILIZO el reporte guardado (no re-corro fuentes)`);
  killEngineChrome();
  await queue.setDone(p.id, reportPath);
  return true;
}

/**
 * ENTREGA: avisa a la web que el reporte de este pedido quedó listo → correo + WhatsApp al
 * cliente (la web resuelve el contacto y las plantillas). Marca el pedido 'entregado' si el
 * aviso salió. No-op si falta WEB_REPORT_URL / OPERATOR_PREVIEW_TOKEN. Nunca rompe el flujo.
 */
async function notifyReady(p: Pedido, tier: string): Promise<void> {
  if (!WEB_REPORT_URL || !OPERATOR_PREVIEW_TOKEN) return;
  try {
    const r = await fetch(`${WEB_REPORT_URL}/api/notify-ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-operator-token': OPERATOR_PREVIEW_TOKEN },
      body: JSON.stringify({ placa: p.placa, email: p.email ?? undefined, whatsapp: p.whatsapp ?? undefined, tier }),
    });
    console.log(`[entrega] notify-ready ${p.placa}: HTTP ${r.status}`);
    if (r.ok) await queue.setDelivered(p.id);
  } catch (e) {
    console.warn('[entrega] notify-ready falló (no bloquea):', (e as Error).message);
  }
}

/** Atiende un pedido de la cola: corre el reporte completo y actualiza su estado. */
async function processPedido(p: Pedido): Promise<void> {
  const sources = p.tier === 'BASIC' ? BASIC_SOURCES : AUTO_SOURCES;
  const tier = (p.tier as string) ?? 'PRO';
  const force = forceReprocess.delete(String(p.id));
  console.log(`[motor-auto] atendiendo pedido ${p.id} · ${p.placa} · tier=${tier}${force ? ' · FORCE' : ''} · ${sources.length} fuentes`);
  await queue.setProcessing(p.id);
  // Reúso: si ya hay un reporte reciente del mismo dueño, no re-corremos todas las fuentes.
  if (!force) {
    try {
      if (await tryReuseReport(p, tier)) {
        console.log(`[motor-auto] pedido ${p.id} LISTO (reutilizado, sin re-correr fuentes)`);
        await notifyReady(p, tier);
        return;
      }
    } catch (e) {
      console.warn('[dedup] verificación falló, regenero:', (e as Error).message);
    }
  }
  const job: Job = { id: newId(), plate: p.placa, sources, results: [], percent: 0, current: sources[0] ?? 'sunarp', step: 'auto', done: false, cancelled: false, concurrency: tier === 'BASIC' ? BASIC_CONCURRENCY : CONCURRENCY };
  jobs.set(job.id, job);
  currentAutoJobId = job.id;
  try {
    await runJob(job);
    const ok = job.results.filter((r) => r.status === 'ENCONTRADO' || r.status === 'SIN_REGISTRO').length;
    // Degradación elegante: solo es ERROR si NINGUNA fuente respondió. Si el job se pasó de
    // tiempo (job.error) pero algunas fuentes SÍ respondieron, publicamos el reporte PARCIAL
    // en vez de descartar todo → el cliente igual recibe identidad/SOAT/etc. que sí salieron.
    if (ok === 0) {
      await queue.setError(p.id, job.error ?? 'ninguna fuente respondió');
      console.log(`[motor-auto] pedido ${p.id} ERROR${job.error ? ` (${job.error})` : ''}`);
    } else {
      // Publica el reporte en Supabase ANTES de marcar el pedido 'listo'. Si se hiciera al revés,
      // habría una carrera: `generating` pasa a false (pedido listo) pero el reporte aún no está
      // publicado → la web recibe el stub vacío y muestra "Generar consulta gratis" (y deja de
      // sondear). Publicando primero, cuando `generating` cae a false el reporte YA está visible.
      try {
        let report = toWebReport(p.placa, job.results, new Date().toISOString(), String(p.id));
        // ULTRA: análisis con IA sobre el reporte completo (recomendación + banderas + precio).
        if (tier === 'ULTRA') {
          const ia = await analyzeReportWithAI(report);
          if (ia) {
            const at = new Date().toISOString();
            report = attachIaSection(report, ia, at);
            // Valorización: precio base de la IA + bandas de km + ajustes por condición del reporte.
            report = attachValuationSection(report, ia, at, new Date().getFullYear());
            console.log(`[ia] análisis IA agregado a ${p.placa} · veredicto=${ia.verdict}${ia.valuation?.baseMax ? ` · base ~S/${ia.valuation.baseMax}` : ''}`);
          }
        }
        const pub = await publishReport(p.placa, report, { userId: p.userId ?? null, pedidoId: String(p.id) });
        console.log(`[reportes] publicado para ${p.placa}: ${pub ? 'sí' : 'no (¿Supabase sin configurar?)'}`);
      } catch (e) { console.warn('[reportes] transform/publish falló:', (e as Error).message); }
      await queue.setDone(p.id, join(plateDir(p.placa), 'reporte.json'));
      console.log(`[motor-auto] pedido ${p.id} LISTO${job.error ? ` (PARCIAL: ${job.error})` : ''} (${ok}/${job.results.length} fuentes)`);
      // Entrega al cliente: correo + WhatsApp con el enlace del reporte listo.
      await notifyReady(p, tier);
      if (N8N_WEBHOOK) {
        try {
          await fetch(N8N_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plate: p.placa, whatsapp: p.whatsapp, email: p.email, results: job.results, at: new Date().toISOString() }) });
          await queue.setDelivered(p.id);
          console.log(`[motor-auto] pedido ${p.id} ENTREGADO (n8n)`);
        } catch (e) { console.warn('[motor-auto] entrega n8n falló:', (e as Error).message); }
      }
    }
  } catch (e) {
    await queue.setError(p.id, (e as Error).message);
  } finally {
    currentAutoJobId = null;
    setTimeout(() => jobs.delete(job.id), 60000);
  }
}

/** Publica + entrega un pedido del LOTE (ULTRA agrega IA + valorización). Espejo del cierre de processPedido. */
async function finalizeJob(p: Pedido, job: OrchJob): Promise<void> {
  const ok = job.results.filter((r) => r.status === 'ENCONTRADO' || r.status === 'SIN_REGISTRO').length;
  if (ok === 0) { await queue.setError(p.id, 'ninguna fuente respondió'); console.log(`[motor-lote] ${p.placa} ERROR (ninguna fuente respondió)`); return; }
  try {
    let report = toWebReport(p.placa, job.results, new Date().toISOString(), job.id);
    if (job.tier === 'ULTRA') {
      const ia = await analyzeReportWithAI(report);
      if (ia) {
        const at = new Date().toISOString();
        report = attachIaSection(report, ia, at);
        report = attachValuationSection(report, ia, at, new Date().getFullYear());
      }
    }
    await publishReport(p.placa, report, { userId: p.userId ?? null, pedidoId: job.id });
    await writeFile(join(plateDir(p.placa), 'reporte.json'), JSON.stringify({ plate: p.placa, generatedAt: new Date().toISOString(), results: job.results }, null, 2), 'utf8');
  } catch (e) { console.warn('[reportes] transform/publish falló:', (e as Error).message); }
  await queue.setDone(p.id, join(plateDir(p.placa), 'reporte.json'));
  await notifyReady(p, job.tier);
}

/**
 * Atiende un LOTE de pedidos (≥2) juntos: historial en 2 hilos SPRL + fuentes ligeras
 * transpuestas (reúso de navegador), con tope de carriles por RAM. Entrega cada reporte apenas
 * su pedido tiene TODAS sus fuentes (ASAP), sin esperar al resto del lote. Aplica reúso (dedup)
 * por placa antes de correr. `engineBusy` sigue serializando: un lote a la vez.
 */
async function processBatch(pedidos: Pedido[]): Promise<void> {
  console.log(`[motor-lote] ${pedidos.length} pedidos: ${pedidos.map((p) => p.placa).join(', ')}`);
  const pedidoById = new Map<string, Pedido>();
  const orchJobs: OrchJob[] = [];
  for (const p of pedidos) {
    const tier = (p.tier as string) ?? 'PRO';
    pedidoById.set(String(p.id), p);
    const force = forceReprocess.delete(String(p.id));
    if (!force) {
      try {
        if (await tryReuseReport(p, tier)) { console.log(`[motor-lote] ${p.placa} reutilizado (sin re-correr)`); await notifyReady(p, tier); continue; }
      } catch (e) { console.warn('[dedup] verificación falló, regenero:', (e as Error).message); }
    }
    const sources = tier === 'BASIC' ? BASIC_SOURCES : AUTO_SOURCES;
    orchJobs.push({ id: String(p.id), plate: p.placa, tier, sources: [...sources], outDir: plateDir(p.placa), results: [], percent: 0, done: false });
  }
  if (!orchJobs.length) return; // todos reutilizados
  for (const j of orchJobs) { batchJobs.set(j.id, j); await mkdir(plateDir(j.plate), { recursive: true }).catch(() => {}); }
  try {
    await orchestrateBatch(orchJobs, {
      laneConcurrency: LANE_CONCURRENCY,
      lanes: buildBatchLanes({ captchaApiKey: KEY, captchaProvider: PROVIDER, headless: true }),
      onJobDone: async (job) => {
        const p = pedidoById.get(job.id)!;
        console.log(`[motor-lote] ${p.placa} LISTO (${job.results.length}/${job.sources.length} fuentes)`);
        await finalizeJob(p, job);
      },
    });
  } catch (e) { console.warn('[motor-lote] orquestación falló:', (e as Error).message); }
  finally {
    for (const j of orchJobs) setTimeout(() => batchJobs.delete(j.id), 60000);
    killEngineChrome(); // libera RAM al final del lote (el pool de historial cierra sus propios Chrome)
  }
}

/**
 * Bucle del motor automático: si está encendido y libre, reclama un LOTE (FIFO, atómico). 1 pedido
 * → ruta single de siempre; ≥2 → motor por lotes (2 hilos historial + ligeras transpuestas).
 */
function startRunner(): void {
  setInterval(() => {
    if (!autoEngine || engineBusy) return;
    engineBusy = true; // toma el lock sincrónicamente para evitar carreras con /api/run
    void (async () => {
      try {
        // ¿Hay algo pendiente? (lectura, no reclama todavía).
        if (!(await queue.next())) return;
        // Ventana de agrupación: deja que los pedidos casi-simultáneos se acumulen antes de reclamar
        // → entran al MISMO lote y corren en paralelo (en vez de que el primero arranque solo).
        if (BATCH_WINDOW_MS > 0) await new Promise((r) => setTimeout(r, BATCH_WINDOW_MS));
        const batch = await queue.claimBatch(BATCH_MAX);
        if (batch.length === 0) return;
        if (batch.length === 1) await processPedido(batch[0]!); // ya está 'procesando' (claim)
        else await processBatch(batch);
      } catch (e) { console.warn('[motor-auto] ciclo:', (e as Error).message); }
      finally { engineBusy = false; }
    })();
  }, 5000);
}

function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}
const sendJson = (res: import('node:http').ServerResponse, code: number, obj: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const path = url.pathname;

    if (path === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(HTML);
    }
    if (path === '/api/sources' && req.method === 'GET') return sendJson(res, 200, OPERATOR_SOURCES);

    // Motor automático: estado + encender/apagar (persistido en meta).
    if (path === '/api/engine' && req.method === 'GET') {
      const cj = currentAutoJobId ? jobs.get(currentAutoJobId) : null;
      const current = cj
        ? { jobId: cj.id, placa: cj.plate, percent: cj.percent, step: cj.step, source: cj.current, done: cj.done,
            // Estado por fuente (para el % de carga individual en la consola): hecha (su status),
            // corriendo (la actual) o en cola.
            sources: cj.sources.map((s) => {
              const r = cj.results.find((x) => x.source.toLowerCase().replace(/_/g, '-') === s);
              return { source: s, status: r ? r.status : (s === cj.current ? 'RUNNING' : 'PENDING') };
            }) }
        : null;
      // Tarjeta por pedido para la consola multi-barra: estado por fuente (✓ hecha / ⟳ corriendo / en cola).
      const cardOf = (plate: string, srcs: string[], results: OperatorSourceResult[], percent: number, running: string, jobId?: string) => ({
        jobId, placa: plate, percent,
        sources: srcs.map((s) => {
          const r = results.find((x) => x.source.toLowerCase().replace(/_/g, '-') === s);
          return { source: s, status: r ? r.status : (s === running ? 'RUNNING' : 'PENDING') };
        }),
      });
      // Pedidos EN PROCESO: los del lote (batchJobs) + el del path single (si hay). Una barra por cada uno.
      const currentJobs = [
        ...[...batchJobs.values()].filter((j) => !j.done).map((j) => cardOf(j.plate, j.sources, j.results, j.percent, '')),
        ...(cj ? [cardOf(cj.plate, cj.sources, cj.results, cj.percent, cj.current, cj.id)] : []),
      ];
      // Ya NO se envía el token crudo al navegador (opción B): solo si hay secreto configurado.
      // El preview se firma por placa y bajo demanda en /api/preview-token.
      return sendJson(res, 200, { enabled: autoEngine, busy: engineBusy, queue: queue.kind, autoSources: AUTO_SOURCES, current, currentJobs, web: { base: WEB_REPORT_URL, hasToken: !!OPERATOR_PREVIEW_TOKEN } });
    }
    if (path === '/api/engine/toggle' && req.method === 'POST') {
      autoEngine = !autoEngine; metaSet('auto_engine_enabled', autoEngine);
      console.log(`[motor-auto] ${autoEngine ? 'ENCENDIDO' : 'APAGADO'} por el operador`);
      return sendJson(res, 200, { enabled: autoEngine });
    }
    // Cola: tablero (marquesina) + encolar pedido (lo usa la web/Supabase; aquí también para QA).
    if (path === '/api/pedidos' && req.method === 'GET') return sendJson(res, 200, await queue.board());
    // Historial de pedidos (todos los estados) para la tabla de la consola, enriquecido con el
    // "índice" del reporte VIVO de cada placa (id + fecha de generación + si ESTE pedido lo produjo).
    // Así el operador ve qué versión del reporte está publicada aunque regenerar sobrescriba la fila.
    if (path === '/api/pedidos/history' && req.method === 'GET') {
      const list = await queue.history(300);
      const meta = await fetchReportsMeta(list.map((p) => p.placa));
      const enriched = list.map((p) => {
        const m = meta.get(String(p.placa).toUpperCase().replace(/[^A-Z0-9]/g, ''));
        return {
          ...p,
          reportId: m?.reportId ?? null,
          reportGeneratedAt: m?.generatedAt ?? null,
          // ¿El reporte publicado para esta placa lo generó ESTE pedido? (marca la fila "viva").
          isLiveReport: !!m?.pedidoId && String(m.pedidoId) === String(p.id),
        };
      });
      return sendJson(res, 200, enriched);
    }
    // Resultados crudos de un pedido (reporte.json de su placa) para ver fuentes + logs.
    if (path === '/api/pedido-report' && req.method === 'GET') {
      const placa = (url.searchParams.get('placa') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!placa) return sendJson(res, 400, { error: 'falta placa' });
      try {
        const txt = await readFile(join(plateDir(placa), 'reporte.json'), 'utf8');
        return sendJson(res, 200, JSON.parse(txt));
      } catch { return sendJson(res, 200, { plate: placa, results: [], missing: true }); }
    }
    // Reporte NORMALIZADO (lo que ve el cliente): aplica toWebReport a los resultados crudos.
    if (path === '/api/pedido-webreport' && req.method === 'GET') {
      const placa = (url.searchParams.get('placa') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!placa) return sendJson(res, 400, { error: 'falta placa' });
      try {
        const raw = JSON.parse(await readFile(join(plateDir(placa), 'reporte.json'), 'utf8')) as { generatedAt?: string; results?: OperatorSourceResult[] };
        const report = toWebReport(placa, raw.results ?? [], raw.generatedAt ?? new Date().toISOString(), placa);
        return sendJson(res, 200, report);
      } catch { return sendJson(res, 200, { missing: true }); }
    }
    // Token de preview FIRMADO y efímero (opción B) para incrustar el reporte del cliente en la
    // consola. El secreto no sale al navegador; solo esta firma con expiración, ligada a la placa.
    if (path === '/api/preview-token' && req.method === 'GET') {
      const placa = (url.searchParams.get('placa') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!placa) return sendJson(res, 400, { error: 'falta placa' });
      return sendJson(res, 200, { token: signPreviewToken(placa), ttl: PREVIEW_TTL_SEC, base: WEB_REPORT_URL });
    }
    if (path === '/api/pedido' && req.method === 'POST') {
      const body = await readBody(req);
      const placa = String(body.placa ?? '').trim();
      if (!placa) return sendJson(res, 400, { error: 'falta placa' });
      // Nivel elegido en la consola (BASIC/PRO/ULTRA); default PRO. Decide las fuentes que corre el motor.
      const tier = ['BASIC', 'PRO', 'ULTRA'].includes(String(body.tier)) ? String(body.tier) : 'PRO';
      // Marca de origen: los pedidos creados en la consola son del OPERADOR (los de la web quedan
      // en 'servicio' por el DEFAULT de la columna). Permite distinguirlos en el historial.
      const p = await queue.enqueue({ placa, tier, whatsapp: String(body.whatsapp ?? '') || undefined, email: String(body.email ?? '') || undefined, origin: 'operador' });
      forceReprocess.add(String(p.id)); // pedidos de la consola (incl. "Re-generar") → datos FRESCOS, sin reúso
      console.log(`[cola] pedido encolado ${p.id} · ${p.placa} · tier=${tier} · origen=operador`);
      return sendJson(res, 200, p);
    }
    // Re-generar un pedido existente: lo vuelve a 'pendiente' (el runner lo retoma si el motor está ON).
    if (path === '/api/pedido/requeue' && req.method === 'POST') {
      const body = await readBody(req);
      const id = body.id;
      if (id === undefined || id === null || id === '') return sendJson(res, 400, { error: 'falta id' });
      await queue.requeue(id as string | number);
      forceReprocess.add(String(id)); // re-generación manual → salta el reúso (datos frescos sí o sí)
      console.log(`[cola] pedido ${id} re-encolado por el operador (force: regenera sin reúso)`);
      return sendJson(res, 200, { ok: true });
    }

    // Inicia un job y devuelve su id (el progreso se sigue por SSE).
    if (path === '/api/run' && req.method === 'POST') {
      const body = await readBody(req);
      const plate = String(body.placa ?? '').trim();
      if (!plate) return sendJson(res, 400, { error: 'falta placa' });
      if (engineBusy) return sendJson(res, 409, { error: 'motor ocupado (otro reporte en curso), intenta en un momento' });
      const sources = Array.isArray(body.sources) && body.sources.length ? (body.sources as string[]) : ['sunarp'];
      const job: Job = { id: newId(), plate, sources, results: [], percent: 0, current: sources[0] ?? 'sunarp', step: 'iniciando…', done: false, cancelled: false };
      jobs.set(job.id, job);
      engineBusy = true;
      console.log(`[operador] run ${plate} (${sources.join(',')}) job=${job.id}`);
      void runJob(job).catch((e) => { job.error = (e as Error).message; job.done = true; }).finally(() => { engineBusy = false; });
      return sendJson(res, 200, { jobId: job.id });
    }

    // Progreso en vivo (Server-Sent Events).
    if (path.startsWith('/api/progress/') && req.method === 'GET') {
      const job = jobs.get(path.split('/').pop() ?? '');
      if (!job) return sendJson(res, 404, { error: 'job no encontrado' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const send = () => res.write(`data: ${JSON.stringify({ percent: job.percent, current: job.current, step: job.step, results: job.results, done: job.done, cancelled: job.cancelled, error: job.error })}\n\n`);
      send();
      const iv = setInterval(() => {
        send();
        if (job.done) { clearInterval(iv); res.end(); setTimeout(() => jobs.delete(job.id), 60000); }
      }, 700);
      req.on('close', () => clearInterval(iv));
      return;
    }

    // Cancela un job: marca cancelado y mata el Chrome del motor → la fuente en curso aborta.
    if (path.startsWith('/api/cancel/') && req.method === 'POST') {
      const job = jobs.get(path.split('/').pop() ?? '');
      if (job && !job.done) { job.cancelled = true; killEngineChrome(); console.log(`[operador] cancel job=${job.id}`); }
      return sendJson(res, 200, { cancelled: true });
    }

    if (path === '/api/retry' && req.method === 'POST') {
      const body = await readBody(req);
      const plate = String(body.placa ?? '').trim();
      const source = String(body.source ?? '').trim();
      if (!plate || !source) return sendJson(res, 400, { error: 'falta placa o source' });
      console.log(`[operador] retry ${plate} · ${source}`);
      const result = await runSingleSource(plate, source, baseOpts(plate, source));
      return sendJson(res, 200, result);
    }

    if (path === '/api/send' && req.method === 'POST') {
      const body = await readBody(req);
      const payload = {
        plate: body.placa, whatsapp: body.whatsapp, email: body.email,
        sprl: body.sprl, precioCompra: body.precioCompra, results: body.results, at: new Date().toISOString(),
      };
      let sent = false;
      if (N8N_WEBHOOK) {
        try {
          const r = await fetch(N8N_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          sent = r.ok;
          console.log(`[operador] enviado a n8n (${r.status})`);
        } catch (e) { console.warn('[operador] n8n falló:', (e as Error).message); }
      } else {
        console.log('[operador] N8N_WEBHOOK_URL no configurado → pedido marcado listo localmente');
      }
      return sendJson(res, 200, { sent, n8n: !!N8N_WEBHOOK });
    }

    if (path.startsWith('/log/') && req.method === 'GET') {
      const parts = path.split('/').filter(Boolean);
      const plate = (parts[1] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const id = (parts[2] ?? '').replace(/[^a-z0-9-]/gi, '');
      if (!plate || !id) return sendJson(res, 404, { error: 'no encontrado' });
      try {
        const buf = await readFile(join(OUT_BASE, plate, `${id}.log`));
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(buf);
      } catch { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('(sin log todavía)'); }
    }

    if (path.startsWith('/shot/') && req.method === 'GET') {
      const parts = path.split('/').filter(Boolean);
      const plate = (parts[1] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const file = (parts[2] ?? '').replace(/[^A-Za-z0-9._-]/g, '');
      if (!plate || !file.endsWith('.png')) return sendJson(res, 404, { error: 'no encontrado' });
      try {
        const buf = await readFile(join(OUT_BASE, plate, file));
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(buf);
      } catch { return sendJson(res, 404, { error: 'screenshot no encontrado' }); }
    }

    sendJson(res, 404, { error: 'ruta no encontrada' });
  } catch (e) {
    console.error('[operador] error:', (e as Error).message);
    sendJson(res, 500, { error: (e as Error).message });
  }
});

// Si el puerto sigue ocupado por la instancia anterior (reinicio de pm2), sal con código
// !=0 para que pm2 reintente; no dejes el proceso colgado emitiendo 'error'.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[operador] puerto ${PORT} ocupado (la instancia anterior aún no soltó el puerto). Saliendo para que pm2 reintente.`);
    process.exit(1);
  }
  throw err;
});

// Apagado ordenado: al reiniciar/parar (pm2 manda SIGINT/SIGTERM) cierra el servidor
// —liberando el puerto al instante— y mata el Chrome del motor. Evita el EADDRINUSE.
let shuttingDown = false;
function shutdown(sig: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[operador] ${sig} recibido → cerrando servidor y Chrome…`);
  try { killEngineChrome(); } catch { /* noop */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref(); // forzar salida si close() se cuelga
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Escucha SOLO en loopback: el panel no tiene auth propia, su seguridad ES el túnel SSH /
// el reverse proxy. (Acceso: ssh -L 3010:localhost:3010 root@VPS). No exponer al internet.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🛠  Panel del operador PlacaPe → http://localhost:${PORT}`);
  console.log(`   CapSolver: ${PROVIDER} · entrega n8n: ${N8N_WEBHOOK ? 'configurada' : 'sin webhook (modo local)'}`);
  console.log(`   Cola: ${queue.kind} · motor automático: ${autoEngine ? 'ENCENDIDO' : 'APAGADO'} · fuentes auto: ${AUTO_SOURCES.join(',')}\n`);
  startRunner();
});

const HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Consola del operador · PlacaPe</title>
<style>
  :root{--azul:#1E3A8A;--teal:#0C6F64;--bg:#F1F5F9;--card:#fff;--bd:#E2E8F0;--mut:#64748B;--ok:#15803D;--err:#B91C1C;--warn:#B45309}
  *{box-sizing:border-box} body{margin:0;font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:#0F172A}
  header{background:var(--azul);color:#fff;padding:14px 20px;display:flex;align-items:center;gap:12px}
  header b{font-size:18px} header span{opacity:.8;font-size:13px}
  main{max-width:1040px;margin:0 auto;padding:20px}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  input,textarea{font:inherit;padding:10px 12px;border:1px solid var(--bd);border-radius:10px;background:#fff}
  input#placa{font:600 18px ui-monospace,monospace;letter-spacing:2px;text-transform:uppercase;width:160px}
  button{font:600 14px inherit;padding:10px 16px;border:0;border-radius:10px;background:var(--azul);color:#fff;cursor:pointer}
  button.sec{background:#fff;color:var(--azul);border:1px solid var(--bd)}
  button.ok{background:var(--teal)} button.danger{background:#fff;color:var(--err);border:1px solid #FCA5A5} button:disabled{opacity:.5;cursor:not-allowed}
  .src{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--mut);margin-right:8px}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;margin-top:16px}
  .card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px}
  .card h3{margin:0 0 6px;font-size:15px} .badge{font:700 11px ui-monospace,monospace;padding:2px 8px;border-radius:999px}
  .b-ENCONTRADO{background:#DCFCE7;color:var(--ok)} .b-SIN_REGISTRO{background:#E2E8F0;color:#475569}
  .b-ERROR{background:#FEE2E2;color:var(--err)} .b-REQUIERE_DNI{background:#FEF3C7;color:var(--warn)}
  .sum{font-size:13px;color:#334155;margin:6px 0} .meta{font-size:12px;color:var(--mut)}
  .card img{width:100%;border:1px solid var(--bd);border-radius:8px;margin-top:8px;cursor:zoom-in}
  .panel{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:16px;margin-top:18px}
  .panel h2{margin:0 0 10px;font-size:16px} textarea{width:100%;min-height:90px;font:13px ui-monospace,monospace}
  #log{font:12px ui-monospace,monospace;background:#0F172A;color:#cbd5e1;border-radius:10px;padding:10px;max-height:160px;overflow:auto;margin-top:14px;white-space:pre-wrap}
  label{display:block;font-size:12px;color:var(--mut);margin:8px 0 3px}
  .card.wide{grid-column:1/-1}
  .flag-banner{background:#FEE2E2;color:#B91C1C;font-weight:700;padding:8px 12px;border-radius:8px;margin:8px 0}
  .ok-banner{background:#DCFCE7;color:#15803D;font-weight:600;padding:8px 12px;border-radius:8px;margin:8px 0}
  .tl{margin:10px 0;border-left:3px solid var(--bd);padding-left:14px}
  .tl-i{margin:0 0 12px}
  .tl-d{font:700 12px ui-monospace,monospace;color:var(--azul)}
  .tl-b{font-size:13px;color:#334155}
  .tl-p{color:#0C6F64;font-weight:700}
  .tl-o{font-size:12px;color:var(--mut);margin-top:2px}
  .barwrap{height:12px;background:#E2E8F0;border-radius:999px;overflow:hidden;margin-top:10px}
  #bar{height:100%;width:0;background:linear-gradient(90deg,var(--teal),var(--azul));transition:width .4s ease}
  #prog .row{justify-content:space-between;align-items:center}
  #step{font-size:13px;color:var(--mut)} #pct{font:700 15px ui-monospace,monospace;color:var(--azul)}
  .ctlbar{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:12px 14px;margin-bottom:16px}
  .ctl-lbl{font-weight:700;margin-right:4px}
  .sw{min-width:104px} .sw.on{background:var(--ok)} .sw.off{background:#94A3B8}
  .ctlbar input{padding:8px 10px}
  .marquee{overflow:hidden;white-space:nowrap;background:#0F172A;color:#cbd5e1;border-radius:10px;padding:9px 0;margin-top:11px}
  .marquee .track{display:inline-block;padding-left:100%;animation:mq 28s linear infinite}
  .marquee:hover .track{animation-play-state:paused}
  @keyframes mq{from{transform:translateX(0)}to{transform:translateX(-100%)}}
  .mq-i{margin:0 22px;font:13px ui-monospace,monospace}
  .mq-proc{color:#FCD34D;font-weight:700} .mq-pend{color:#93C5FD} .mq-empty{color:#64748B}
  .tabs{display:flex;gap:6px;margin:18px 0 12px;border-bottom:1px solid var(--bd)}
  .tab{padding:9px 18px;background:transparent;color:var(--mut);border:1px solid transparent;border-bottom:0;border-radius:10px 10px 0 0;cursor:pointer;font-weight:700;font-size:14px;margin-bottom:-1px}
  .tab.active{background:var(--card);color:var(--azul);border-color:var(--bd);border-bottom:1px solid var(--card)}
  table.ped{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--bd);border-radius:12px;overflow:hidden;font-size:13.5px}
  table.ped th{text-align:left;padding:9px 12px;background:#F8FAFC;color:var(--mut);font-size:11.5px;text-transform:uppercase;letter-spacing:.04em}
  table.ped td{padding:9px 12px;border-top:1px solid var(--bd)}
  table.ped tbody tr{cursor:pointer} table.ped tbody tr:hover td{background:#F1F5F9}
  table.ped tr.sel td{background:#EFF6FF;box-shadow:inset 3px 0 0 var(--azul)}
  table.ped tr.subrow td{background:#F8FAFC;color:#475569;font-size:12.5px} table.ped tr.subrow:hover td{background:#EEF2F7}
  .gtoggle{cursor:pointer;color:var(--azul);font-weight:800;display:inline-block;width:14px;text-align:center;user-select:none}
  .tg{font:700 10.5px ui-monospace,monospace;padding:2px 7px;border-radius:999px;white-space:nowrap}
  .tg-BASIC{background:#E2E8F0;color:#475569} .tg-PRO{background:#DBEAFE;color:#1D4ED8} .tg-ULTRA{background:#EDE9FE;color:#6D28D9}
  .og-operador{background:#FEF3C7;color:#92400E} .og-servicio{background:#DCFCE7;color:#15803D}
  .ridx{font:600 12px ui-monospace,monospace;color:#334155} .ridx .liv{color:var(--teal);font-weight:800} .ridx .dead{color:#CBD5E1}
  .pager{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px;font-size:13px;color:var(--mut)}
  .pager button{padding:6px 12px;font-size:13px;background:#fff;color:var(--azul);border:1px solid var(--bd)}
  .pager button:disabled{opacity:.4} .pager select{padding:6px 8px;border:1px solid var(--bd);border-radius:8px;background:#fff;font:inherit}
  .pill{font:700 11px ui-monospace,monospace;padding:2px 8px;border-radius:999px;white-space:nowrap}
  .p-listo,.p-entregado{background:#DCFCE7;color:var(--ok)} .p-procesando{background:#FEF9C3;color:var(--warn)}
  .p-pendiente{background:#E0F2FE;color:#0369A1} .p-error{background:#FEE2E2;color:var(--err)}
  .prog2{margin-top:11px;background:#0F172A;color:#E2E8F0;border-radius:10px;padding:11px 14px}
  .prog2 .top{display:flex;justify-content:space-between;align-items:center;font-size:13px}
  .prog2 .pl{font:700 14px ui-monospace,monospace;color:#fff}
  .prog2 .pc{font:700 15px ui-monospace,monospace;color:#7DD3FC}
  .prog2 .st{color:#94A3B8;font-size:12.5px;margin-top:4px;min-height:16px}
  .prog2 .bw{height:10px;background:#1E293B;border-radius:999px;overflow:hidden;margin-top:8px}
  .prog2 .bf{height:100%;width:0;background:linear-gradient(90deg,var(--teal),#3B82F6);transition:width .5s ease}
  .prog2.idle{background:#F1F5F9;color:var(--mut)} .prog2.idle .pl{color:#334155}
  .prog2 .chip{display:inline-block;font-size:11px;margin-right:7px;color:#94A3B8}
  #engBars .prog2+.prog2{margin-top:8px}
  .pmeta{font-size:13px;color:var(--mut);margin:6px 0 12px;display:flex;gap:14px;flex-wrap:wrap}
  .pdetail h2{font-size:16px;margin:4px 0 2px}
</style></head><body>
<header><b>🛠 Consola del operador · PlacaPe</b><span>scraping · VPS Perú</span></header>
<main>
  <div class="ctlbar">
    <div class="row" style="justify-content:space-between">
      <div class="row">
        <span class="ctl-lbl">Motor automático</span>
        <button id="engBtn" class="sw off" onclick="toggleEngine()">…</button>
        <span id="engInfo" class="meta"></span>
      </div>
      <div class="row">
        <input id="qplaca" placeholder="placa" maxlength="8" style="width:120px;text-transform:uppercase">
        <select id="qtier" title="Nivel del reporte" style="padding:8px 10px;border:1px solid var(--bd);border-radius:10px;background:#fff;font:inherit">
          <option value="BASIC">BASIC (gratis)</option>
          <option value="PRO" selected>PRO</option>
          <option value="ULTRA">ULTRA (con IA)</option>
        </select>
        <input id="qwa" placeholder="WhatsApp" style="width:130px">
        <input id="qmail" placeholder="correo" style="width:160px">
        <button class="sec" onclick="enqueue()">Encolar pedido</button>
      </div>
    </div>
    <div id="engBars"><div class="prog2 idle"><div class="top"><span class="pl">Motor libre</span><span class="pc"></span></div><div class="st">Sin pedidos en proceso</div><div class="bw"><div class="bf"></div></div></div></div>
  </div>

  <div class="tabs">
    <button class="tab active" id="tab-b-hist" onclick="showTab('hist')">Historial de pedidos</button>
    <button class="tab" id="tab-b-manual" onclick="showTab('manual')">Manual / QA</button>
  </div>

  <section id="tab-hist">
    <table class="ped"><thead><tr><th>Placa</th><th>Origen</th><th>Nivel</th><th>Usuario</th><th>Reporte</th><th>Estado</th><th>Creado</th><th>Terminado</th><th>Duración</th></tr></thead><tbody id="histbody"><tr><td colspan="9" style="color:#64748B">Cargando…</td></tr></tbody></table>
    <div class="pager" id="histpager"></div>
    <div class="pdetail" id="pdetail"></div>
  </section>

  <section id="tab-manual" style="display:none">

  <div class="row">
    <input id="placa" placeholder="ABC123" maxlength="8">
    <button id="go" onclick="run()">Generar reporte (manual)</button>
    <button class="sec" onclick="toggleSrc()">Fuentes ▾</button>
  </div>
  <div id="srcbox" class="row" style="display:none;margin-top:10px"></div>

  <div class="panel" id="prog" style="display:none">
    <div class="row">
      <b id="step">…</b>
      <div class="row"><span id="pct">0%</span><button class="danger" onclick="cancelRun()">Cancelar</button></div>
    </div>
    <div class="barwrap"><div id="bar"></div></div>
  </div>

  <div id="cards" class="cards"></div>

  <div class="panel" id="sprlPanel" style="display:none">
    <h2>Historial de propietarios (SPRL · manual)</h2>
    <div class="meta">Pega aquí el JSON de asientos descifrado (snippet de consola del SPRL). Es el dato premium.</div>
    <textarea id="sprl" placeholder='{"asientos":[...]}'></textarea>
    <label>Precio de compra del último propietario (Síguelo Plus · manual · gratis)</label>
    <input id="precio" placeholder="ej. US$ 18,881 (CONTADO)" style="width:100%">
    <h2 style="margin-top:14px">Entrega</h2>
    <div class="row">
      <div><label>WhatsApp</label><input id="wa" placeholder="9XXXXXXXX"></div>
      <div><label>Correo</label><input id="mail" placeholder="cliente@correo.com"></div>
      <div style="align-self:flex-end"><button class="ok" onclick="send()">Marcar listo y enviar</button></div>
    </div>
  </div>
  </section>
  <div id="log"></div>
</main>
<script>
var SOURCES=[], LAST=null, ES=null, JOB=null, WEB_BASE='', WEB_HASTOKEN=false;
function log(m){var l=document.getElementById('log');l.textContent+= (new Date().toLocaleTimeString())+'  '+m+'\\n';l.scrollTop=l.scrollHeight;}
function plate(){return document.getElementById('placa').value.toUpperCase().replace(/[^A-Z0-9]/g,'');}
fetch('/api/sources').then(function(r){return r.json()}).then(function(s){SOURCES=s;var b=document.getElementById('srcbox');
  b.innerHTML=s.map(function(x){return '<label class="src"><input type="checkbox" '+(x.default?'checked':'')+' value="'+x.id+'"> '+x.label+'</label>'}).join('');});
function toggleSrc(){var b=document.getElementById('srcbox');b.style.display=b.style.display==='none'?'flex':'none';}
function chosen(){var c=[].slice.call(document.querySelectorAll('#srcbox input:checked'));return c.map(function(i){return i.value})}
function badge(s){return '<span class="badge b-'+s+'">'+s+'</span>'}
function esc(x){return String(x==null?'':x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function flagBanner(f){if(!f)return'';var b=[];if(f.aseguradora)b.push('ASEGURADORA');if(f.remate)b.push('CASA DE REMATE');if(f.financiera)b.push('FINANCIERA');if(f.gravamen)b.push('GRAVAMEN');if(f.embargo)b.push('EMBARGO');
  if(!b.length)return '<div class="ok-banner">✓ Sin banderas — no pasó por aseguradora ni remate</div>';
  return '<div class="flag-banner">🚩 REVISAR: '+b.join(' · ')+'</div>';}
function timelineHtml(r){if(!r.data||!r.data.timeline)return'';
  return flagBanner(r.data.flags)+'<div class="tl">'+r.data.timeline.slice().reverse().map(function(a){
    return '<div class="tl-i"><div class="tl-d">'+esc((a.fechaPresentacion||'').slice(0,10))+'</div>'+
    '<div class="tl-b"><b>'+esc(a.acto||a.tipo||'')+'</b>'+(a.precio?' · <span class="tl-p">'+esc(a.precio)+'</span>':'')+
    (a.formaPago?' · '+esc(a.formaPago):'')+'<div class="tl-o">'+esc((a.participantes||'').slice(0,100))+'</div></div></div>';
  }).join('')+'</div>';}
function srcId(code){return code.toLowerCase().replace(/_/g,'-');}
function card(r,pl,withRetry,pfx){pl=pl||plate();pfx=pfx||'c';var cid=pfx+'-'+r.source;
  var logLink='<a href="/log/'+pl+'/'+srcId(r.source)+'" target="_blank" style="font-size:13px;color:#0C6F64;margin-left:8px">ver log</a>';
  var actions='<div style="margin-top:8px">'+(withRetry?'<button class="sec" onclick="retry(\\''+r.source+'\\',\\''+pl+'\\',\\''+pfx+'\\')">Reintentar</button> ':'')+logLink+'</div>';
  if(r.source==='HISTORIAL'&&r.data&&r.data.timeline){
    return '<div class="card wide" id="'+cid+'"><h3>'+r.label+' '+badge(r.status)+'</h3><div class="sum">'+esc(r.summary||'')+'</div>'+
    timelineHtml(r)+'<div class="meta">'+(r.ms/1000).toFixed(1)+'s · sede '+esc((r.data.sede||''))+'</div>'+actions+'</div>';}
  var img=r.screenshot?'<img src="/shot/'+pl+'/'+srcId(r.source)+'.png?t='+Date.now()+'" onclick="window.open(this.src)">':'';
  var capTxt=(r.data&&r.data.captcha)?' · captcha: '+esc(r.data.captcha):'';
  return '<div class="card" id="'+cid+'"><h3>'+r.label+' '+badge(r.status)+'</h3><div class="sum">'+esc(r.summary||'')+'</div>'+
  '<div class="meta">'+(r.ms/1000).toFixed(1)+'s'+capTxt+'</div>'+img+actions+'</div>';}
function renderCards(results,pl,cont,withRetry,pfx){cont=cont||'cards';pfx=pfx||'c';var box=document.getElementById(cont);if(!box)return;
  box.innerHTML=(results&&results.length)?results.map(function(r){return card(r,pl,withRetry,pfx)}).join(''):'<div class="meta">Sin resultados de fuentes para esta placa.</div>';}
function showProg(on){document.getElementById('prog').style.display=on?'block':'none';}
function setBar(pct,txt){document.getElementById('bar').style.width=pct+'%';document.getElementById('pct').textContent=pct+'%';document.getElementById('step').textContent=txt||'';}
function run(){var p=plate();if(!p){alert('Pon una placa');return;}
  var go=document.getElementById('go');go.disabled=true;go.textContent='Corriendo…';
  document.getElementById('cards').innerHTML='';document.getElementById('sprlPanel').style.display='none';LAST=null;
  showProg(true);setBar(0,'iniciando…');log('▶ generando '+p+' …');
  fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({placa:p,sources:chosen()})})
   .then(function(r){return r.json()}).then(function(o){
     if(!o.jobId){throw new Error(o.error||'sin jobId');}
     JOB=o.jobId; ES=new EventSource('/api/progress/'+JOB);
     ES.onmessage=function(ev){var s=JSON.parse(ev.data);
       setBar(s.percent, esc(s.current||'')+(s.step?' · '+esc(s.step):''));
       renderCards(s.results, plate(), 'cards', true, 'm');
       if(s.done){ES.close();ES=null;finish(s);}
     };
     ES.onerror=function(){/* el SSE cierra al terminar; si no terminó, reintenta el navegador */};
   }).catch(function(e){log('✖ '+e);endRun();});}
function finish(s){endRun();
  if(s.error){log('✖ '+s.error);return;}
  if(s.cancelled){log('⏹ cancelado por el operador');renderCards(s.results, plate(), 'cards', true, 'm');return;}
  LAST={results:s.results};renderCards(s.results, plate(), 'cards', true, 'm');
  document.getElementById('sprlPanel').style.display='block';
  var ok=s.results.filter(function(x){return x.status==='ENCONTRADO'||x.status==='SIN_REGISTRO'}).length;
  log('✔ '+ok+'/'+s.results.length+' fuentes respondieron');}
function endRun(){var go=document.getElementById('go');go.disabled=false;go.textContent='Generar reporte';showProg(false);if(ES){ES.close();ES=null;}}
function cancelRun(){if(!JOB)return;log('⏹ cancelando…');fetch('/api/cancel/'+JOB,{method:'POST'});}
function retry(code,pl,pfx){pl=pl||plate();pfx=pfx||'c';var id=srcId(code);log('↻ reintentando '+code+' ('+pl+') …');
  fetch('/api/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({placa:pl,source:id})})
   .then(function(r){return r.json()}).then(function(res){var el=document.getElementById(pfx+'-'+res.source);
     if(el){el.outerHTML=card(res,pl,true,pfx);}
     log('↻ '+res.source+' → '+res.status);}).catch(function(e){log('✖ '+e)});}
function send(){if(!LAST){alert('Genera el reporte primero');return;}
  var body={placa:plate(),whatsapp:document.getElementById('wa').value,email:document.getElementById('mail').value,sprl:document.getElementById('sprl').value,precioCompra:document.getElementById('precio').value,results:LAST.results};
  log('✉ marcando listo / enviando …');
  fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
   .then(function(r){return r.json()}).then(function(x){log(x.sent?'✉ enviado por n8n':'✓ marcado listo (n8n sin configurar)');}).catch(function(e){log('✖ '+e)});}
document.getElementById('placa').addEventListener('keydown',function(e){if(e.key==='Enter')run();});

// ── Motor automático + progreso + historial ──────────────────────────────────
function loadEngine(){fetch('/api/engine').then(function(r){return r.json()}).then(function(s){
  if(s.web){WEB_BASE=s.web.base||'';WEB_HASTOKEN=!!s.web.hasToken;}
  var b=document.getElementById('engBtn');
  b.textContent=s.enabled?'ENCENDIDO':'APAGADO'; b.className='sw '+(s.enabled?'on':'off');
  document.getElementById('engInfo').textContent=(s.busy?'· atendiendo un pedido ':'· libre ')+'· cola: '+esc(s.queue);
  // Panel del motor = UNA barra por pedido en proceso (lote o single). Vacío → "Esperando pedidos".
  var wrap=document.getElementById('engBars'); var jobs=s.currentJobs||[];
  if(jobs.length){
    wrap.innerHTML=jobs.map(function(c){
      var chips=(c.sources||[]).map(function(x){
        var m=(x.status==='ENCONTRADO'||x.status==='SIN_REGISTRO')?'✓ ':(x.status==='RUNNING'?'⟳ ':(x.status==='ERROR'?'✕ ':'· '));
        return '<span class="chip">'+m+esc(x.source)+'</span>';
      }).join('');
      var pct=c.percent||0;
      return '<div class="prog2"><div class="top"><span class="pl">⚙ '+esc(c.placa)+'</span><span class="pc">'+pct+'%</span></div>'+
        '<div class="st">'+(chips||'procesando…')+'</div>'+
        '<div class="bw"><div class="bf" style="width:'+pct+'%"></div></div></div>';
    }).join('');
  }else{
    wrap.innerHTML='<div class="prog2 idle"><div class="top"><span class="pl">Motor '+(s.enabled?'encendido':'apagado')+'</span><span class="pc"></span></div>'+
      '<div class="st">'+(s.enabled?'Esperando pedidos…':'Motor apagado')+'</div><div class="bw"><div class="bf" style="width:0%"></div></div></div>';
  }
}).catch(function(){});}
function toggleEngine(){fetch('/api/engine/toggle',{method:'POST'}).then(function(r){return r.json()}).then(function(s){
  log(s.enabled?'⚙ motor automático ENCENDIDO':'⚙ motor automático APAGADO');loadEngine();});}
function cancelAuto(jid){if(!confirm('¿Cancelar el reporte en proceso? Se guardará lo que ya se obtuvo.'))return;
  log('⏹ cancelando job '+jid+' …');
  fetch('/api/cancel/'+jid,{method:'POST'}).then(function(){log('⏹ cancelado');loadEngine();loadHistory();}).catch(function(e){log('✖ '+e)});}
function fmtTime(iso){if(!iso)return'—';try{var d=new Date(iso);return d.toLocaleDateString()+' '+d.toTimeString().slice(0,5);}catch(e){return esc(iso);}}
function fmtDur(a,b){if(!a||!b)return'—';try{var ms=new Date(b)-new Date(a);if(ms<0)return'—';var s=Math.round(ms/1000);return s<60?s+'s':(Math.floor(s/60)+'m '+(s%60)+'s');}catch(e){return'—';}}
function showTab(t){
  document.getElementById('tab-hist').style.display=t==='hist'?'block':'none';
  document.getElementById('tab-manual').style.display=t==='manual'?'block':'none';
  document.getElementById('tab-b-hist').className='tab'+(t==='hist'?' active':'');
  document.getElementById('tab-b-manual').className='tab'+(t==='manual'?' active':'');
}
var SELECTED=null, SELECTED_ID=null, DTAB='fuentes', HISTSEEN=false;
var HISTLIST=[], HISTPAGE=0, HISTPER=25;
function pestado(e){return '<span class="pill p-'+esc(e)+'">'+esc(e)+'</span>';}
// Badge de nivel (BASIC/PRO/ULTRA) y de origen (operador/servicio).
function otier(t){var v=String(t||'PRO').toUpperCase();return '<span class="tg tg-'+esc(v)+'">'+esc(v)+'</span>';}
function oorigen(o){var v=(String(o||'servicio').toLowerCase()==='operador')?'operador':'servicio';return '<span class="tg og-'+esc(v)+'">'+esc(v)+'</span>';}
// Índice del reporte VIVO de la placa: id (= pedido que lo generó) + hora de generación + si ESTE
// pedido es el que produjo el reporte publicado (● vivo · ○ lo generó otro pedido de la placa). La
// hora cambia en cada regeneración → así se distingue una versión nueva aunque se sobrescriba la fila.
function oreporte(p){
  if(!p.reportId)return '<span class="meta">—</span>';
  var dot=p.isLiveReport
    ?'<span class="liv" title="Este pedido generó el reporte publicado">●</span>'
    :'<span class="dead" title="El reporte publicado lo generó otro pedido de esta placa">○</span>';
  var t=p.reportGeneratedAt?fmtTime(p.reportGeneratedAt):'';
  return '<span class="ridx">'+dot+' #'+esc(String(p.reportId).slice(0,8))+(t?' · '+esc(t):'')+'</span>';
}
function loadHistory(){fetch('/api/pedidos/history').then(function(r){return r.json()}).then(function(list){
  HISTLIST=list||[];
  renderHistory();
  if(!HISTSEEN&&HISTLIST[0]){HISTSEEN=true; selectPedido(HISTLIST[0].placa,HISTLIST[0].id);}  // por defecto: el último pedido
}).catch(function(){});}
// Usuario que generó el pedido: operador (consola) o, en servicio, su email/id/whatsapp.
function ousuario(p){
  if(String(p.origin||'').toLowerCase()==='operador')return '<span class="tg og-operador">operador</span>';
  var u=p.email||p.userId||p.whatsapp||'';
  if(!u)return '<span class="meta">—</span>';
  var s=String(u), sh=s.length>22?s.slice(0,20)+'…':s;
  return '<span class="meta" title="'+esc(s)+'">'+esc(sh)+'</span>';
}
// Agrupa los pedidos por placa (HISTLIST viene desc por creado → cada grupo queda desc, y el orden
// de grupos es por su generación más reciente). El grupo tiene un "registro principal" (el más
// reciente, en la tabla) y sub-registros (generaciones anteriores, indexadas, expandibles).
function groupHistory(){
  var m={},order=[];
  for(var i=0;i<HISTLIST.length;i++){var p=HISTLIST[i],k=p.placa;if(!m[k]){m[k]={placa:k,list:[]};order.push(k);}m[k].list.push(p);}
  return order.map(function(k){return m[k];});
}
function histRow(p,isMain,tog,nSubs,groupPlaca){
  var placaCell=isMain
    ?('<span>'+(tog||'<span style="display:inline-block;width:14px"></span>')+' <b style="font:700 13px ui-monospace,monospace">'+esc(p.placa)+'</b>'+(nSubs?' <span class="meta" title="'+nSubs+' generación(es) anterior(es)">+'+nSubs+'</span>':'')+'</span>')
    :('<span style="padding-left:22px;color:#94A3B8">↳ <span style="font:600 12px ui-monospace,monospace">'+esc(p.placa)+'</span></span>');
  return '<tr'+(groupPlaca?' class="subrow" data-group="'+esc(groupPlaca)+'" style="display:none"':'')+' data-placa="'+esc(p.placa)+'" onclick="selectPedido(\\''+esc(p.placa)+'\\',\\''+esc(p.id)+'\\')">'+
    '<td>'+placaCell+'</td>'+
    '<td>'+oorigen(p.origin)+'</td>'+
    '<td>'+otier(p.tier)+'</td>'+
    '<td>'+ousuario(p)+'</td>'+
    '<td>'+oreporte(p)+'</td>'+
    '<td>'+pestado(p.estado)+(p.error?'<div style="color:#B91C1C;font-size:11px;margin-top:2px">'+esc((p.error||'').slice(0,42))+'</div>':'')+'</td>'+
    '<td>'+esc(fmtTime(p.createdAt))+'</td>'+
    '<td>'+esc(fmtTime(p.finishedAt))+'</td>'+
    '<td style="font:600 12px ui-monospace,monospace;color:#0C6F64">'+fmtDur(p.startedAt||p.createdAt,p.finishedAt)+'</td></tr>';
}
function renderHistory(){
  var tb=document.getElementById('histbody');
  var groups=groupHistory(), total=groups.length;
  if(!total){tb.innerHTML='<tr><td colspan="9" style="color:#64748B">Sin pedidos todavía</td></tr>';renderPager(0,1,0);return;}
  var pages=Math.max(1,Math.ceil(total/HISTPER));
  if(HISTPAGE>=pages)HISTPAGE=pages-1; if(HISTPAGE<0)HISTPAGE=0;
  var start=HISTPAGE*HISTPER, slice=groups.slice(start,start+HISTPER);
  var html='';
  slice.forEach(function(g){
    var main=g.list[0], subs=g.list.slice(1), n=subs.length;
    var tog=n?'<span class="gtoggle" onclick="event.stopPropagation();toggleGroup(this,\\''+esc(g.placa)+'\\')" title="Ver generaciones anteriores">▸</span>':'<span style="display:inline-block;width:14px"></span>';
    html+=histRow(main,true,tog,n,null);
    for(var j=0;j<subs.length;j++)html+=histRow(subs[j],false,'',0,g.placa);
  });
  tb.innerHTML=html;
  renderPager(total,pages,start+slice.length);
  markSel();
}
// Expande/colapsa los sub-registros (generaciones anteriores) de una placa.
function toggleGroup(el,placa){
  var open=el.textContent.indexOf('▾')>=0; el.textContent=open?'▸':'▾';
  var rows=document.querySelectorAll('#histbody tr.subrow[data-group="'+placa+'"]');
  for(var i=0;i<rows.length;i++)rows[i].style.display=open?'none':'table-row';
}
function renderPager(total,pages,shownEnd){
  var el=document.getElementById('histpager'); if(!el)return;
  if(!total){el.innerHTML='';return;}
  var opts=[10,25,50,100].map(function(n){return '<option value="'+n+'"'+(n===HISTPER?' selected':'')+'>'+n+'</option>';}).join('');
  el.innerHTML='<span>Filas por página:</span>'+
    '<select onchange="setPerPage(this.value)">'+opts+'</select>'+
    '<button onclick="histPage(-1)"'+(HISTPAGE<=0?' disabled':'')+'>‹ Anterior</button>'+
    '<span>Página '+(HISTPAGE+1)+' de '+pages+'</span>'+
    '<button onclick="histPage(1)"'+(HISTPAGE>=pages-1?' disabled':'')+'>Siguiente ›</button>'+
    '<span style="margin-left:auto">'+(HISTPAGE*HISTPER+1)+'–'+shownEnd+' de '+total+'</span>';
}
function setPerPage(v){HISTPER=parseInt(v,10)||25;HISTPAGE=0;renderHistory();}
function histPage(d){HISTPAGE+=d;renderHistory();}
function markSel(){var rows=document.querySelectorAll('#histbody tr');for(var i=0;i<rows.length;i++){var sub=rows[i].getAttribute('data-group')?'subrow':'';var sel=(rows[i].getAttribute('data-placa')===SELECTED)?'sel':'';rows[i].className=(sub&&sel)?sub+' '+sel:(sub||sel);}}
function hHeader(pl){return '<h2>'+esc(pl)+' <button class="sec" style="font-size:13px;padding:6px 12px" onclick="requeuePedido()">↻ Re-generar reporte</button></h2>';}
function detailTabs(){return '<div class="tabs" style="margin:10px 0 12px">'+
  '<button class="tab'+(DTAB==='fuentes'?' active':'')+'" onclick="showDetailTab(\\'fuentes\\')">Fuentes</button>'+
  '<button class="tab'+(DTAB==='reporte'?' active':'')+'" onclick="showDetailTab(\\'reporte\\')">Reporte al usuario</button></div>';}
function selectPedido(pl,id){SELECTED=pl;SELECTED_ID=id;DTAB='fuentes';markSel();showDetailTab('fuentes');}
function showDetailTab(t){DTAB=t;if(t==='reporte')loadWebReport();else loadFuentes();}
// ── Pestaña FUENTES: tarjetas crudas por fuente (debug) ──
function loadFuentes(){var pl=SELECTED,d=document.getElementById('pdetail');
  d.innerHTML=hHeader(pl)+detailTabs()+'<div class="pmeta">Cargando…</div>';
  fetch('/api/pedido-report?placa='+encodeURIComponent(pl)).then(function(r){return r.json()}).then(function(rep){
    var results=rep.results||[];
    if(!results.length){return showLiveLogs(pl,rep);}
    var ok=results.filter(function(x){return x.status==='ENCONTRADO'||x.status==='SIN_REGISTRO'}).length;
    var err=results.filter(function(x){return x.status==='ERROR'}).length;
    d.innerHTML=hHeader(pl)+detailTabs()+
      '<div class="pmeta"><span>'+results.length+' fuentes</span><span style="color:#15803D">'+ok+' ok</span>'+(err?'<span style="color:#B91C1C">'+err+' con error</span>':'')+(rep.generatedAt?'<span>generado '+esc(fmtTime(rep.generatedAt))+'</span>':'')+'</div>'+
      '<div id="hcards" class="cards"></div>';
    renderCards(results, pl, 'hcards', true, 'h');
  }).catch(function(e){d.innerHTML=hHeader(pl)+detailTabs()+'<div class="pmeta">✖ '+esc(e)+'</div>';});}
// ── Pestaña REPORTE AL USUARIO: el Report normalizado (lo que ve el cliente) ──
// Render NATIVO local por defecto: lee el reporte.json del propio VPS (/api/pedido-webreport)
// con TODOS los payloads, sin candado ni token ni Vercel → nunca se rompe. El iframe con la web
// REAL del cliente queda como opción bajo demanda (botón "Ver como lo ve el cliente"), útil para
// QA visual pero dependiente de que el OPERATOR_PREVIEW_TOKEN del VPS coincida con el de Vercel.
function loadWebReport(){var pl=SELECTED,d=document.getElementById('pdetail');
  d.innerHTML=hHeader(pl)+detailTabs()+'<div class="pmeta">Cargando reporte…</div>';
  fetch('/api/pedido-webreport?placa='+encodeURIComponent(pl)).then(function(r){return r.json()}).then(function(rep){
    var webBtn=WEB_BASE?'<button class="sec" onclick="toggleClientWeb()">Ver como lo ve el cliente (web) ↗</button>':'';
    d.innerHTML=hHeader(pl)+detailTabs()+
      '<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:10px">'+
        '<span class="meta">Vista nativa · datos del VPS, sin candado (no depende de Vercel ni del token).</span>'+webBtn+'</div>'+
      ((rep&&!rep.missing)?renderWebReport(rep):'<div class="pmeta">Aún sin reporte consolidado (el pedido no ha terminado).</div>')+
      '<div id="clientWebBox"></div>';
  }).catch(function(e){d.innerHTML=hHeader(pl)+detailTabs()+'<div class="pmeta">✖ '+esc(e)+'</div>';});}
// Muestra/oculta el iframe con la web REAL del cliente (?preview=TOKEN). Si falta el token, avisa
// (se vería con candado, que fue justo el bug: token del VPS ≠ token de Vercel → secciones vacías).
function toggleClientWeb(){var box=document.getElementById('clientWebBox');if(!box)return;
  if(box.innerHTML){box.innerHTML='';return;}
  var pl=SELECTED;
  box.innerHTML='<div class="meta" style="margin:14px 0 8px">Generando enlace firmado…</div>';
  // Pide un token de preview FIRMADO y efímero (opción B): el secreto no viaja en la URL, solo la
  // firma con expiración. Un enlace filtrado muere pronto y solo abre esta placa. NO se embebe en
  // iframe: la web pone X-Frame-Options: DENY / CSP frame-ancestors 'none' (anti-clickjacking, a
  // propósito) → un iframe siempre daría "rechazó la conexión". Se abre en una pestaña nueva.
  fetch('/api/preview-token?placa='+encodeURIComponent(pl)).then(function(r){return r.json()}).then(function(o){
    var tok=o&&o.token, mins=Math.round(((o&&o.ttl)||600)/60);
    var url=WEB_BASE+'/reporte/'+encodeURIComponent(pl)+(tok?'?preview='+encodeURIComponent(tok):'');
    box.innerHTML='<div class="card wide" style="margin-top:14px">'+
      '<div class="sum">La web se abre en una <b>pestaña nueva</b> (no embebida): placape.pe bloquea el iframe por seguridad anti-clickjacking (X-Frame-Options / CSP). El enlace es el reporte tal como lo ve el cliente.</div>'+
      '<div style="margin-top:10px"><a href="'+url+'" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:var(--teal);color:#fff;font-weight:600;padding:10px 16px;border-radius:10px;text-decoration:none">Abrir el reporte del cliente ↗</a></div>'+
      '<div class="meta" style="margin-top:8px">'+(tok?('Enlace firmado · expira en '+mins+' min · válido solo para esta placa'):'<b style="color:#B45309">⚠ sin OPERATOR_PREVIEW_TOKEN: se verá con candado</b>')+'</div>'+
    '</div>';
  }).catch(function(e){box.innerHTML='<div class="meta">✖ '+esc(e)+'</div>';});}
function showLiveLogs(pl){var d=document.getElementById('pdetail');
  fetch('/api/engine').then(function(r){return r.json()}).then(function(s){
    var proc=s.current&&s.current.placa===pl;var srcs=s.autoSources||[];
    var pct=proc?(s.current.percent||0):0;
    var links=srcs.map(function(x){return '<a href="/log/'+encodeURIComponent(pl)+'/'+x+'" target="_blank" style="margin:0 12px 6px 0;display:inline-block;color:#0C6F64">'+esc(x)+'</a>';}).join('');
    // Barra de % de carga de la tarea → se ve el avance en vivo (no parece "colgado").
    var bar=proc
      ?'<div class="prog2"><div class="top"><span class="pl">⏳ '+esc(pl)+'</span><span class="pc">'+pct+'%</span></div><div class="st">'+esc(s.current.source||'procesando fuentes…')+'</div><div class="bw"><div class="bf" style="width:'+pct+'%"></div></div></div>'
      :'<div class="prog2 idle"><div class="top"><span class="pl">'+esc(pl)+'</span><span class="pc">—</span></div><div class="st">⚠ aún sin reporte.json (¿en proceso en otra máquina o pedido viejo?)</div></div>';
    // % de carga POR FUENTE: hecha=100% (verde/rojo según status), corriendo=parcial (azul), en cola=0%.
    var ss=(proc&&s.current.sources)||[];
    var perSrc=ss.length?('<div style="margin:12px 0 4px">'+ss.map(function(x){
      var st=x.status||'PENDING', done=(st!=='PENDING'&&st!=='RUNNING');
      var col=(st==='ENCONTRADO'||st==='SIN_REGISTRO')?'#15803D':((st==='RUNNING')?'#2563EB':(done?'#B91C1C':'#94A3B8'));
      var w=done?100:((st==='RUNNING')?55:0), lab=(st==='RUNNING')?'corriendo…':((st==='PENDING')?'en cola':esc(st));
      return '<div style="display:flex;align-items:center;gap:10px;margin:5px 0">'+
        '<span style="width:120px;font:600 12px ui-monospace,monospace;color:#334155">'+esc(x.source)+'</span>'+
        '<div style="flex:1;height:8px;background:#E2E8F0;border-radius:999px;overflow:hidden"><div style="height:100%;width:'+w+'%;background:'+col+';transition:width .5s ease"></div></div>'+
        '<span style="width:95px;text-align:right;font:600 11px ui-monospace,monospace;color:'+col+'">'+lab+'</span></div>';
    }).join('')+'</div>'):'';
    d.innerHTML=hHeader(pl)+detailTabs()+bar+perSrc+
      '<div class="pmeta" style="display:block;margin-top:12px">Logs en vivo por fuente:<br>'+(links||'—')+'</div>';
    // Auto-refresco mientras procesa ESTA placa y sigues en la pestaña Fuentes → el % avanza solo.
    if(proc&&DTAB==='fuentes'&&SELECTED===pl)setTimeout(function(){if(DTAB==='fuentes'&&SELECTED===pl)loadFuentes();},4000);
  }).catch(function(){d.innerHTML=hHeader(pl)+detailTabs()+'<div class="pmeta">⚠ aún sin reporte.json</div>';});}
// Render compacto del reporte normalizado (lo que recibe el cliente).
var KIND_LABEL={REGISTRAL:'Identidad',IDENTIDAD_ESPECIFICA:'Identidad específica y características',SEGUROS:'SOAT',SINIESTRALIDAD:'Siniestralidad',PAPELETAS:'Papeletas e infracciones',CAPTURA:'Orden de captura',REVISION_TECNICA:'Revisión técnica',TRANSPORTE:'Uso como taxi/transporte',GRAVAMENES:'Gravámenes/prendas',HISTORIAL:'Historial de registros',MULTAS_ELECTORALES:'Multas electorales',IA:'Análisis con IA'};
// Badge de estado por sección: verde=AVAILABLE, rojo=UNAVAILABLE/ERROR (fuente falló → re-generar), gris=el resto.
function secBadge(st){var c=st==='AVAILABLE'?'b-ENCONTRADO':((st==='UNAVAILABLE'||st==='ERROR')?'b-ERROR':'b-SIN_REGISTRO');
  return '<span class="badge '+c+'" style="float:right">'+esc(st||'')+'</span>';}
function defRows(items){var rows=items.filter(function(x){return x[1]!=null&&x[1]!==''});if(!rows.length)return'';
  return '<div style="font-size:13px;line-height:1.7">'+rows.map(function(x){return '<div><span style="color:#64748B">'+x[0]+':</span> '+esc(x[1])+'</div>'}).join('')+'</div>';}
function sectionSummary(s){var p=s.payload;if(s.status!=='AVAILABLE')return '('+String(s.status||'').toLowerCase()+')';if(!p)return '—';
  switch(s.kind){
    case 'SEGUROS':return (p.hasActiveSoat?'SOAT vigente':'Sin SOAT vigente')+(p.insurer?' · '+esc(p.insurer):'');
    case 'SINIESTRALIDAD':return (p.hasSiniestro?'Registra siniestralidad':'Sin siniestros')+(p.auction?' · subasta: '+esc(p.auction.subasta||p.auction.fuente||''):'');
    case 'PAPELETAS':return (p.count||p.total||0)+' papeleta(s)'+(p.pendingAmount?' · S/ '+Number(p.pendingAmount).toFixed(2):'')+(p.benefitAmount?' · beneficio S/ '+Number(p.benefitAmount).toFixed(2)+(p.benefitUntil?' hasta '+esc(p.benefitUntil):''):'');
    case 'CAPTURA':return p.hasCapture?'CON orden de captura':'Sin orden de captura';
    case 'REVISION_TECNICA':return (p.hasValid?'Vigente':'Vencida/sin registro')+(p.validUntil?' hasta '+esc(p.validUntil):'');
    case 'TRANSPORTE':return p.isPublicTransport?('Taxi/transporte: '+esc(p.modality||'sí')+(p.detail?' · '+esc(p.detail):'')):'No figura como taxi';
    case 'GRAVAMENES':return (p.hasLiens?'Registra gravamen/carga':'Sin gravámenes')+(p.items&&p.items.length?' ('+p.items.length+')':'');
    case 'IDENTIDAD_ESPECIFICA':return 'Versión: '+esc(p.version||'—')+(p.bodywork?' · '+esc(p.bodywork):'')+(p.fuel?' · '+esc(p.fuel):'')+(p.displacement?' · '+esc(p.displacement):'');
    case 'HISTORIAL':return (p.transfers||0)+' transferencia(s) · '+(p.totalAsientos||0)+' asientos'+(p.flags&&(p.flags.aseguradora||p.flags.remate)?' · ⚠ banderas':'');
    case 'IA':return 'Veredicto: '+esc(p.verdict||'—')+((p.redFlags&&p.redFlags.length)?' · '+p.redFlags.length+' bandera(s)':'')+(p.summary?' · '+esc(String(p.summary).slice(0,80)):'');
    default:return '—';
  }
}
function renderWebReport(rep){var v=rep.vehicle,html='';
  if(v&&v.stolenAlert)html+='<div class="flag-banner">🚩 ALERTA DE ROBO — verificar con SUNARP/PNP</div>';
  if(v){html+='<div class="card wide"><h3>Identidad básica del vehículo</h3>'+
    defRows([['Placa',v.plateDisplay],['Marca',v.brand],['Modelo',v.model],['Año',v.year],['Color',v.color],['Serie',v.serie],['VIN',v.vin],['Motor',v.engineNumber],['Placa anterior',v.platePrevious],['Estado',v.registralStatus],['Sede',v.sede]])+
    (v.owner?'<div style="margin-top:8px;font-size:13px"><span style="color:#64748B">Propietario(s):</span> '+esc(v.owner.name)+'</div>':'')+'</div>';}
  var secs=(rep.sections||[]).filter(function(s){return s.kind!=='REGISTRAL'&&s.status!=='COMING_SOON'});
  html+='<div class="cards">'+secs.map(function(s){return '<div class="card"><h3>'+esc(KIND_LABEL[s.kind]||s.kind)+secBadge(s.status)+'</h3><div class="sum">'+sectionSummary(s)+'</div></div>';}).join('')+'</div>';
  return '<div class="meta" style="margin-bottom:10px">Vista de lo que recibe el cliente. (BASIC: identidad/propietarios/SOAT · PRO/ULTRA: el resto.)</div>'+html;
}
// Re-generar = CREAR UN NUEVO pedido (sub-registro) de la misma placa/nivel, NO reusar la fila:
// así cada generación queda con su propio creado/terminado/duración y su usuario (operador).
function requeuePedido(){if(!SELECTED){alert('Selecciona un pedido');return;}
  var cur=null;for(var i=0;i<HISTLIST.length;i++){if(String(HISTLIST[i].id)===String(SELECTED_ID)){cur=HISTLIST[i];break;}}
  var tier=(cur&&cur.tier)||'PRO';
  log('↻ re-generando '+SELECTED+' ('+tier+') — nuevo registro …');
  fetch('/api/pedido',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({placa:SELECTED,tier:tier})})
   .then(function(r){return r.json()}).then(function(x){if(x.error){log('✖ '+x.error);return;}log('↻ nuevo pedido #'+esc(x.id)+' ('+esc(x.tier||tier)+') — el motor lo tomará si está ENCENDIDO');loadHistory();}).catch(function(e){log('✖ '+e)});}
function enqueue(){var p=document.getElementById('qplaca').value.toUpperCase().replace(/[^A-Z0-9]/g,'');if(!p){alert('Pon una placa');return;}
  var tier=document.getElementById('qtier').value;
  fetch('/api/pedido',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({placa:p,tier:tier,whatsapp:document.getElementById('qwa').value,email:document.getElementById('qmail').value})})
   .then(function(r){return r.json()}).then(function(x){log('＋ pedido '+esc(x.tier||tier)+' encolado: '+esc(x.placa)+' (#'+esc(x.id)+')');document.getElementById('qplaca').value='';loadHistory();}).catch(function(e){log('✖ '+e)});}
showTab('hist');loadEngine();loadHistory();setInterval(loadEngine,3000);setInterval(loadHistory,6000);
</script></body></html>`;
