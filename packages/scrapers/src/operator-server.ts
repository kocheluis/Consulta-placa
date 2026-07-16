/* eslint-disable no-console */
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { runSingleSource, OPERATOR_SOURCES, buildBatchLanes, buildContinuousLanes, type OperatorSourceResult } from './operator/index.js';
import { orchestrateBatch, type OrchJob } from './operator/batch.js';
import { Pipeline, type PipelineJob } from './operator/pipeline.js';
import { killEngineChrome } from './operator/chrome-path.js';
import { getQueue, type Pedido } from './operator/queue.js';
import { toWebReport } from './operator/report-transform.js';
import { publishReport, fetchReport, fetchReportsMeta } from './operator/report-store.js';
import { scrapeSunarpViaCdp } from './operator/cdp-sunarp.js';
import { analyzeReportWithAI, attachIaSection, attachValuationSection } from './operator/ai-analysis.js';
import { metaGet, metaSet } from './db/repo.js';
import { SectionKind, SectionStatus, type Report } from '@app/shared';

// Carga secretos del VPS desde un archivo KEY=VALUE (Supabase, CapSolver…), sin hornearlos
// en pm2. Es la FUENTE DE VERDAD: el archivo GANA sobre el entorno de pm2 (así un valor
// viejo/truncado en pm2 no pisa el correcto). Corre antes de leer el entorno (getQueue/consts).
// Solo afecta a las claves presentes en el archivo. Default /root/placape.env
// (override con OPERATOR_ENV_FILE). Dev/Windows (sin archivo) → no-op.
(function loadEnvFile() {
  const f = process.env.OPERATOR_ENV_FILE ?? '/root/placape.env';
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m || !m[1]) continue;
      let v = m[2] ?? '';
      // Comentario inline (" # …") SOLO si el valor NO está entrecomillado: un '#' pegado (p. ej.
      // un password "pa#ss") se conserva; uno tras espacio se trata como comentario (estilo dotenv).
      // Evita el footgun de "ENGINE_CONTINUOUS=1   # …" quedando como valor "1   # …" (≠ "1").
      if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '');
      process.env[m[1]] = v.trim().replace(/^["']|["']$/g, '');
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
// Cache del endpoint de métricas (escanea reporte.json por placa → costoso). TTL corto.
let metricsCache: { at: number; data: unknown } | null = null;
let autoEngine = metaGet<boolean>('auto_engine_enabled') ?? false; // persistido: sobrevive reinicios
// Fuentes activas del motor automático, elegibles desde la consola. Si hay override, reemplaza
// AUTO_SOURCES para los pedidos PRO/ULTRA nuevos (BASIC sigue con BASIC_SOURCES). Persistido.
let autoSourcesOverride: string[] | null = metaGet<string[]>('auto_sources_override') ?? null;
const activeAuto = (): string[] => (autoSourcesOverride && autoSourcesOverride.length ? autoSourcesOverride : AUTO_SOURCES);
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
// ── MOTOR CONTINUO (streaming, opt-in ENGINE_CONTINUOUS=1) ────────────────────────────────────
// En vez del lote cerrado (reclama N, corre a completitud, libera el lock), el dispatcher reclama
// pedidos DE A UNO en bucle mientras haya cupo (ENGINE_MAX_INFLIGHT) y los inyecta a carriles de
// vida larga (pool de historial + carril ligero) → un pedido nuevo NO espera a que termine el
// anterior. El motor por lotes queda como fallback (flag off) para revertir sin tocar código.
const ENGINE_CONTINUOUS = process.env.ENGINE_CONTINUOUS === '1';
const ENGINE_MAX_INFLIGHT = Math.max(1, Number(process.env.ENGINE_MAX_INFLIGHT ?? 4));
// Workers globales del carril ligero (fuentes NO-historial en paralelo). Son I/O-bound (esperan
// CapSolver + portales), así que 4 corren bien aun en 2 vCPU. Baja si el VPS aprieta RAM / CapSolver 400.
const ENGINE_LIGHT_CONCURRENCY = Math.max(1, Number(process.env.ENGINE_LIGHT_CONCURRENCY ?? 4));
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
  const sources = p.tier === 'BASIC' ? BASIC_SOURCES : activeAuto();
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
    const sources = tier === 'BASIC' ? BASIC_SOURCES : activeAuto();
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

// ── MOTOR CONTINUO: pipeline de vida larga + dispatcher que reclama sin frontera de lote ─────────
let pipeline: Pipeline | null = null;
let dispatching = false; // evita solapar dos bucles de claim (como engineBusy, pero solo para el claim)
const contJobs = new Map<string, PipelineJob>();     // pedidos en vuelo (para la consola multi-barra)
const contPedidoById = new Map<string, Pedido>();    // id → Pedido (para finalizeJob)

/** Construye (perezoso) el pipeline continuo: pool de historial persistente + carril ligero. Se
 *  arma la 1ª vez que el motor está encendido y hay trabajo; los Chrome SPRL quedan calientes. */
function getPipeline(): Pipeline {
  if (pipeline) return pipeline;
  pipeline = new Pipeline({
    lanes: buildContinuousLanes({ captchaApiKey: KEY, captchaProvider: PROVIDER, headless: true, lightConcurrency: ENGINE_LIGHT_CONCURRENCY }),
    jobTimeoutMs: JOB_TIMEOUT_MS, // historial colgado / ambos slots bloqueados → cierre parcial
    onProgress: (job) => { const j = contJobs.get(job.id); if (j) { j.results = job.results; j.percent = job.percent; } },
    onJobDone: async (job) => {
      const p = contPedidoById.get(job.id);
      try {
        if (p) { console.log(`[motor-cont] ${p.placa} LISTO (${job.results.length}/${job.sources.length} fuentes)`); await finalizeJob(p, job); }
      } finally {
        contPedidoById.delete(job.id);
        setTimeout(() => contJobs.delete(job.id), 60000);
      }
    },
  });
  console.log(`[motor-cont] pipeline continuo iniciado · maxInflight=${ENGINE_MAX_INFLIGHT} · light=${ENGINE_LIGHT_CONCURRENCY}`);
  return pipeline;
}

/**
 * Bucle del MOTOR CONTINUO: mientras haya cupo (inFlight < MAX), reclama pedidos DE A UNO y los
 * inyecta al pipeline SIN esperar a que terminen los anteriores. Aplica reúso (dedup) por placa.
 * Un pedido nuevo entra al pipeline apenas hay cupo → "encolar y atender casi de inmediato".
 */
function startContinuousRunner(): void {
  setInterval(() => {
    if (!autoEngine || dispatching) return;
    dispatching = true;
    void (async () => {
      const pl = getPipeline();
      while (autoEngine && pl.inFlight() < ENGINE_MAX_INFLIGHT) {
        const [p] = await queue.claimBatch(1); // claim atómico → ya queda 'procesando'
        if (!p) break;
        const tier = (p.tier as string) ?? 'PRO';
        const force = forceReprocess.delete(String(p.id));
        if (!force) {
          try {
            if (await tryReuseReport(p, tier)) { console.log(`[motor-cont] ${p.placa} reutilizado (sin re-correr)`); await notifyReady(p, tier); continue; }
          } catch (e) { console.warn('[dedup] verificación falló, regenero:', (e as Error).message); }
        }
        const sources = tier === 'BASIC' ? BASIC_SOURCES : activeAuto();
        const job: PipelineJob = { id: String(p.id), plate: p.placa, tier, sources: [...sources], outDir: plateDir(p.placa), results: [], percent: 0, done: false };
        await mkdir(plateDir(p.placa), { recursive: true }).catch(() => {});
        contPedidoById.set(job.id, p);
        contJobs.set(job.id, job);
        if (!pl.submit(job)) {
          // Esa placa ya está en vuelo (otra corrida en curso) → suelto el claim y la re-encolo.
          console.log(`[motor-cont] ${p.placa} ya en vuelo → re-encolo`);
          contPedidoById.delete(job.id); contJobs.delete(job.id);
          await queue.requeue(p.id);
        }
      }
    })().catch((e) => console.warn('[motor-cont] ciclo:', (e as Error).message)).finally(() => { dispatching = false; });
  }, 2000);
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

/**
 * Persiste un RETRY exitoso: reemplaza el resultado de esa fuente en el `reporte.json` de la placa
 * y RE-PUBLICA el reporte del usuario, preservando IA/valorización ya calculadas (para no re-correr
 * la IA). Así el reintento "pisa" el error tanto en la consola (al refrescar) como en el reporte del cliente.
 */
async function mergeRetryIntoReport(plate: string, result: OperatorSourceResult): Promise<void> {
  const norm = (s: string) => s.toLowerCase().replace(/_/g, '-');
  const file = join(plateDir(plate), 'reporte.json');
  let raw: { generatedAt?: string; results?: OperatorSourceResult[] } = {};
  try { raw = JSON.parse(await readFile(file, 'utf8')) as typeof raw; } catch { /* reporte.json nuevo */ }
  const results = raw.results ?? [];
  const i = results.findIndex((r) => norm(r.source) === norm(result.source));
  if (i >= 0) results[i] = result; else results.push(result);
  const generatedAt = raw.generatedAt ?? new Date().toISOString();
  await mkdir(plateDir(plate), { recursive: true }).catch(() => {});
  await writeFile(file, JSON.stringify({ plate, generatedAt, results }, null, 2), 'utf8');

  // Re-publica: reconstruye desde los resultados y CONSERVA IA/VALORIZACION del reporte vivo.
  const existing = await fetchReport(plate);
  let report = toWebReport(plate, results, generatedAt, existing?.pedidoId ?? String(Date.now()));
  if (existing?.report) {
    const keep = (k: unknown) => k === SectionKind.IA || k === SectionKind.VALORIZACION;
    const preserved = existing.report.sections.filter((s) => keep(s.kind) && s.status === SectionStatus.AVAILABLE);
    if (preserved.length) {
      const kinds = new Set(preserved.map((s) => s.kind));
      report = { ...report, sections: [...report.sections.filter((s) => !kinds.has(s.kind)), ...preserved] };
    }
  }
  await publishReport(plate, report, { userId: existing?.userId ?? null, pedidoId: existing?.pedidoId ?? null });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const path = url.pathname;

    if (path === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(HTML);
    }
    if (path === '/api/sources' && req.method === 'GET') return sendJson(res, 200, OPERATOR_SOURCES);
    // Fuentes activas del motor automático (elegibles desde la consola). GET → catálogo + activas;
    // POST {sources:[ids]} → fija el override (vacío = volver al default AUTO_SOURCES). Solo afecta PRO/ULTRA.
    if (path === '/api/auto-sources' && req.method === 'GET') {
      return sendJson(res, 200, { all: OPERATOR_SOURCES, active: activeAuto(), default: AUTO_SOURCES, overridden: !!autoSourcesOverride });
    }
    if (path === '/api/auto-sources' && req.method === 'POST') {
      const body = await readBody(req);
      const arr = Array.isArray(body.sources) ? [...new Set((body.sources as unknown[]).map((s) => String(s)))].filter(Boolean) : [];
      autoSourcesOverride = arr.length ? arr : null;
      metaSet('auto_sources_override', autoSourcesOverride);
      console.log(`[motor] fuentes activas → ${autoSourcesOverride ? autoSourcesOverride.join(',') : '(default) ' + AUTO_SOURCES.join(',')}`);
      return sendJson(res, 200, { active: activeAuto(), overridden: !!autoSourcesOverride });
    }

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
      const cardOf = (plate: string, srcs: string[], results: OperatorSourceResult[], percent: number, running: string, jobId?: string, contMode = false) => ({
        jobId, placa: plate, percent,
        sources: srcs.map((s) => {
          const r = results.find((x) => x.source.toLowerCase().replace(/_/g, '-') === s);
          // Continuo: las fuentes aún sin resultado están corriendo/en-cola en el pool PARALELO → se
          // marcan RUNNING (muestran actividad en las barras). Batch/single: solo la 'current' corre.
          return { source: s, status: r ? r.status : ((contMode || s === running) ? 'RUNNING' : 'PENDING') };
        }),
      });
      // Pedidos EN PROCESO: los del lote (batchJobs) + los del motor continuo (contJobs) + el del
      // path single (si hay). Una barra por cada uno.
      const currentJobs = [
        ...[...batchJobs.values()].filter((j) => !j.done).map((j) => cardOf(j.plate, j.sources, j.results, j.percent, '')),
        ...[...contJobs.values()].filter((j) => !j.done).map((j) => cardOf(j.plate, j.sources, j.results, j.percent, '', j.id, true)),
        ...(cj ? [cardOf(cj.plate, cj.sources, cj.results, cj.percent, cj.current, cj.id)] : []),
      ];
      const busy = ENGINE_CONTINUOUS ? (pipeline?.inFlight() ?? 0) > 0 : engineBusy;
      // Ya NO se envía el token crudo al navegador (opción B): solo si hay secreto configurado.
      // El preview se firma por placa y bajo demanda en /api/preview-token.
      return sendJson(res, 200, { enabled: autoEngine, busy, queue: queue.kind, autoSources: activeAuto(), current, currentJobs, web: { base: WEB_REPORT_URL, hasToken: !!OPERATOR_PREVIEW_TOKEN } });
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
      const list = await queue.history(2000);
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
    // Métricas del dashboard: lista de "eventos" (un pedido = un evento) derivada de la cola +
    // el reporte.json de cada placa (para saber qué fuentes fallaron). El front hace el bucketing,
    // KPIs, heatmap, conversión, etc. NOTA: `fails` sale del ÚLTIMO reporte de la placa (proxy) hasta
    // que se persista un resumen por pedido (sources_summary). Cache 30s (el escaneo de disco es caro).
    if (path === '/api/metrics' && req.method === 'GET') {
      if (metricsCache && Date.now() - metricsCache.at < 30_000) return sendJson(res, 200, metricsCache.data);
      const list = await queue.history(3000);
      const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const placas = [...new Set(list.map((p) => norm(String(p.placa))))];
      const failMap = new Map<string, string[]>();
      await Promise.all(placas.map(async (pl) => {
        try {
          const raw = JSON.parse(await readFile(join(plateDir(pl), 'reporte.json'), 'utf8')) as { results?: OperatorSourceResult[] };
          failMap.set(pl, (raw.results ?? []).filter((r) => r.status === 'ERROR').map((r) => r.source.toLowerCase().replace(/_/g, '-')));
        } catch { /* placa sin reporte.json todavía */ }
      }));
      const events = list.map((p) => {
        const pl = norm(String(p.placa));
        const ts = p.createdAt ? Date.parse(p.createdAt) : Date.now();
        const st = p.startedAt ? Date.parse(p.startedAt) : 0;
        const fin = p.finishedAt ? Date.parse(p.finishedAt) : 0;
        const dur = st && fin && fin > st ? Math.round((fin - st) / 1000) : 0;
        const origin = String(p.origin ?? 'servicio').toLowerCase() === 'operador' ? 'operador' : 'servicio';
        const user = origin === 'operador' ? 'operador (consola)' : String(p.email || p.userId || p.whatsapp || '—');
        return { ts, placa: pl, tier: p.tier ?? 'PRO', origin, user, estado: p.estado, dur, fails: failMap.get(pl) ?? [] };
      });
      metricsCache = { at: Date.now(), data: { events, generatedAt: new Date().toISOString() } };
      return sendJson(res, 200, metricsCache.data);
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

    // Cancela un pedido en proceso. Single/lote: marca cancelado + mata el Chrome del motor.
    // CONTINUO: lo saca del pipeline SIN matar el Chrome (para no tumbar los demás pedidos ni la
    // sesión SPRL caliente) y lo marca 'error' en la cola. Las fuentes en curso terminan solas.
    if (path.startsWith('/api/cancel/') && req.method === 'POST') {
      const id = path.split('/').pop() ?? '';
      const job = jobs.get(id);
      if (job && !job.done) { job.cancelled = true; killEngineChrome(); console.log(`[operador] cancel job=${job.id}`); }
      const cj = contJobs.get(id);
      if (cj && !cj.done && pipeline) {
        pipeline.cancel(cj.plate);
        contJobs.delete(id); contPedidoById.delete(id);
        try { await queue.setError(id, 'cancelado por el operador'); } catch { /* noop */ }
        console.log(`[motor-cont] cancelado por el operador: ${cj.plate} (#${id})`);
      }
      return sendJson(res, 200, { cancelled: true });
    }

    if (path === '/api/retry' && req.method === 'POST') {
      const body = await readBody(req);
      const plate = String(body.placa ?? '').trim();
      const source = String(body.source ?? '').trim();
      if (!plate || !source) return sendJson(res, 400, { error: 'falta placa o source' });
      console.log(`[operador] retry ${plate} · ${source}`);
      const result = await runSingleSource(plate, source, baseOpts(plate, source));
      // Persiste el retry EXITOSO: pisa el error en reporte.json + RE-PUBLICA el reporte del usuario
      // (así el reintento "chanca" el error tanto en la consola como en el reporte del cliente).
      if (result.status === 'ENCONTRADO' || result.status === 'SIN_REGISTRO') {
        try { await mergeRetryIntoReport(plate, result); console.log(`[retry] ${plate}/${source} persistido + republicado`); }
        catch (e) { console.warn('[retry] persistencia falló:', (e as Error).message); }
      }
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
  try { void pipeline?.close(); } catch { /* noop */ } // motor continuo: cierra canales → workers salen
  try { killEngineChrome(); } catch { /* noop */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref(); // forzar salida si close() se cuelga
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Escucha SOLO en loopback: el panel no tiene auth propia, su seguridad ES el túnel SSH /
// el reverse proxy. (Acceso: ssh -L 3010:localhost:3010 root@VPS). No exponer al internet.
/** Libera el puerto matando el proceso HUÉRFANO que lo tenga (p. ej. un Node que `tsx` no cerró al
 *  reiniciar a mitad de pedido). Evita el crash-loop EADDRINUSE sin intervención manual. Best-effort:
 *  usa `ss` para hallar el PID y lo mata; si no hay `ss`, cae a `fuser`. Nunca se mata a sí mismo. */
function freePort(port: number): void {
  try {
    const out = execSync(`ss -ltnp 'sport = :${port}'`, { encoding: 'utf8' });
    const pids = [...new Set([...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])))].filter((p) => p && p !== process.pid);
    for (const pid of pids) { console.warn(`[operador] puerto ${port} tomado por huérfano pid=${pid} → lo mato`); try { process.kill(pid, 'SIGKILL'); } catch { /* ya murió */ } }
  } catch { try { execSync(`fuser -k ${port}/tcp`); } catch { /* sin ss/fuser */ } }
}

let listenTries = 0;
const onListen = (): void => {
  console.log(`\n🛠  Panel del operador PlacaPe → http://localhost:${PORT}`);
  console.log(`   CapSolver: ${PROVIDER} · entrega n8n: ${N8N_WEBHOOK ? 'configurada' : 'sin webhook (modo local)'}`);
  console.log(`   Cola: ${queue.kind} · motor automático: ${autoEngine ? 'ENCENDIDO' : 'APAGADO'} · modo: ${ENGINE_CONTINUOUS ? `CONTINUO (maxInflight=${ENGINE_MAX_INFLIGHT})` : 'LOTES'} · fuentes auto: ${AUTO_SOURCES.join(',')}\n`);
  if (ENGINE_CONTINUOUS) startContinuousRunner(); else startRunner();
};
// Auto-arreglo del EADDRINUSE: si el puerto quedó tomado por un huérfano (reinicio a mitad de pedido),
// lo libera y reintenta hasta 3 veces en vez de crash-loopear indefinidamente.
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE' && listenTries < 3) {
    listenTries++;
    console.error(`[operador] EADDRINUSE en :${PORT} (intento ${listenTries}/3) → libero el puerto y reintento…`);
    freePort(PORT);
    setTimeout(() => server.listen(PORT, '127.0.0.1'), 1500);
  } else {
    console.error(`[operador] no pude escuchar en :${PORT}: ${e.message}`);
    process.exit(1);
  }
});
server.once('listening', onListen);
server.listen(PORT, '127.0.0.1');

const HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Consola del operador · PlacaPe</title>
<style>
  :root{--azul:#2563EB;--teal:#0D9488;--bg:#EEF1F6;--card:#fff;--bd:#DCE2EC;--mut:#5D6B7E;--ok:#15803D;--err:#B91C1C;--warn:#B45309;--ink:#1F2733;--shadow:0 1px 2px rgba(24,39,75,.05),0 6px 18px rgba(24,39,75,.06)}
  *{box-sizing:border-box} body{margin:0;font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
  header{background:#fff;color:var(--ink);border-bottom:1px solid var(--bd);padding:12px 24px;display:flex;align-items:center;gap:11px;box-shadow:var(--shadow)}
  header .logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--teal),var(--azul));display:grid;place-items:center;font-size:15px;flex:0 0 auto}
  header b{font-size:16px;color:var(--ink)} header .sub{color:var(--mut);font-size:12.5px}
  main{max-width:1340px;margin:0 auto;padding:20px}
  .card,.ctlbar,.hleft,.hpanel,.panel,.mcard,.kpi,.schip,.ftbar,.mtbar{box-shadow:var(--shadow)}
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
  .card img{width:100%;max-height:150px;object-fit:cover;object-position:top;border:1px solid var(--bd);border-radius:8px;margin-top:8px;cursor:zoom-in}
  .hpanel .card img{max-height:130px}
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

  /* ── consola nueva: filtros, split, métricas ── */
  :root{--faint:#94A3B8;--violet:#6D28D9;--card2:#F8FAFC;--run:#2563EB}
  .sumchips{display:flex;gap:10px;flex-wrap:wrap;margin:4px 0 12px}
  .schip{flex:1 1 130px;min-width:120px;background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:10px 13px;cursor:pointer}
  .schip:hover{border-color:#c3ccdb} .schip.on{border-color:var(--azul);box-shadow:0 0 0 2px rgba(37,99,235,.2)}
  .schip .sn{font:800 22px/1 ui-monospace,monospace} .schip .sk{font-size:11.5px;color:var(--mut);margin-top:4px}
  .schip.s-proc .sn{color:var(--warn)} .schip.s-pend .sn{color:var(--azul)} .schip.s-ok .sn{color:var(--ok)} .schip.s-err .sn{color:var(--err)} .schip.s-all .sn{color:#334155}
  .ftbar{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:10px 12px;margin-bottom:14px;display:flex;gap:9px;align-items:flex-end;flex-wrap:wrap}
  .ffld{display:flex;flex-direction:column;gap:4px}
  .ffld label{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--faint);font-weight:600;font-family:ui-monospace,monospace}
  .ffld input,.ffld select{font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--bd);border-radius:8px;background:#fff}
  .ffld input.pl{width:110px;text-transform:uppercase;font-family:ui-monospace,monospace}
  .fseg{display:flex;border:1px solid var(--bd);border-radius:8px;overflow:hidden}
  .fseg button{border:0;background:#fff;color:var(--mut);padding:6px 10px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;border-right:1px solid var(--bd)}
  .fseg button:last-child{border-right:0} .fseg button.on{background:var(--azul);color:#fff}
  .fclr{background:#fff;border:1px solid var(--bd);color:var(--mut);border-radius:8px;padding:6px 11px;font:inherit;font-size:12px;cursor:pointer}
  .hsplit{display:grid;grid-template-columns:minmax(0,1fr) 440px;gap:14px;align-items:start}
  @media(max-width:1180px){.hsplit{grid-template-columns:minmax(0,1fr)}.hpanel{position:static}}
  .hleft,.hpanel{background:var(--card);border:1px solid var(--bd);border-radius:12px}
  .hleft-hd{display:flex;align-items:center;justify-content:space-between;padding:9px 13px;border-bottom:1px solid var(--bd);flex-wrap:wrap;gap:8px}
  .hl-ttl{font-weight:700;font-size:13.5px} .perpage-top{font-size:12px;color:var(--mut)}
  .perpage-top select{font:inherit;font-size:12.5px;padding:4px 6px;border:1px solid var(--bd);border-radius:7px}
  .tbl-scroll{overflow-x:auto} .hleft table.ped{border:0;border-radius:0}
  .hpanel{position:sticky;top:12px;padding:4px 15px 15px} .hpanel .dempty{padding:40px 18px;text-align:center;color:var(--faint);font-size:13px}
  .hpanel h2{font-size:16px;margin:10px 0 2px}
  .fsr{display:flex;align-items:center;gap:10px;margin:7px 0}
  .fsr .sn{width:118px;font:600 11.5px ui-monospace,monospace;flex:0 0 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fsr .tk{flex:1;height:8px;background:#E5E9F0;border-radius:999px;overflow:hidden}
  .fsr .fl{height:100%;border-radius:999px;transition:width .5s ease}
  .fsr .fl-ok{background:var(--ok)} .fsr .fl-run{background:var(--run)} .fsr .fl-err{background:var(--err)} .fsr .fl-pend{background:#CBD5E1}
  .fsr .st2{flex:0 0 auto;min-width:104px;text-align:right;font:600 10px ui-monospace,monospace;display:flex;gap:6px;align-items:center;justify-content:flex-end}
  .fsr .tm{color:var(--mut);font-weight:700}
  .st2.ok{color:var(--ok)} .st2.run{color:var(--run)} .st2.err{color:var(--err)} .st2.pend{color:var(--faint)}
  .loglinks2{display:flex;flex-wrap:wrap;gap:6px} .loglinks2 a{font:600 11px ui-monospace,monospace;color:var(--teal);text-decoration:none;border:1px solid var(--bd);border-radius:7px;padding:3px 8px;background:var(--card2)}
  .shotgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;margin:8px 0}
  .shotc{border:1px solid var(--bd);border-radius:8px;overflow:hidden;cursor:zoom-in;background:var(--card2)}
  .shotc img{width:100%;height:66px;object-fit:cover;display:block}
  .shotc .cc{font:600 10px ui-monospace,monospace;padding:3px 6px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--bd)}
  .shotc .cc .dd{width:7px;height:7px;border-radius:50%}
  #lightbox{position:fixed;inset:0;background:rgba(8,12,20,.82);display:none;align-items:center;justify-content:center;z-index:60;padding:24px}
  #lightbox.on{display:flex} #lightbox .lbi{max-width:900px;width:100%;background:#fff;border-radius:12px;overflow:hidden}
  #lightbox .lbh{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--bd);font:700 13px ui-monospace,monospace}
  #lightbox .lbh button{border:0;background:transparent;font-size:20px;cursor:pointer;color:var(--mut)}
  #lightbox img{width:100%;display:block;background:#0b1220} #lightbox .lbf{padding:8px 14px;font-size:11.5px;color:var(--faint);border-top:1px solid var(--bd)}
  /* métricas */
  .mtbar{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:10px 12px;margin-bottom:14px;display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
  .mselinfo{font-size:12.5px;color:var(--mut);align-self:center;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .mselinfo b{color:#334155;font-family:ui-monospace,monospace}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:11px;margin-bottom:14px}
  .kpi{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:12px 14px}
  .kpi .kl{font-size:11px;color:var(--mut);display:flex;align-items:center;gap:6px} .kpi .kl .sq{width:8px;height:8px;border-radius:2px}
  .kpi .kv{font:800 26px/1.1 ui-monospace,monospace;margin-top:7px} .kpi .ks{font-size:11px;color:var(--faint);margin-top:3px;font-family:ui-monospace,monospace}
  .kpi.all .kv{color:#334155} .kpi.all .sq{background:var(--azul)} .kpi.ok .kv{color:var(--ok)} .kpi.ok .sq{background:var(--ok)}
  .kpi.err .kv{color:var(--err)} .kpi.err .sq{background:var(--err)} .kpi.top .kv{color:var(--warn);font-size:17px} .kpi.top .sq{background:var(--warn)}
  .kpi.lat .kv{color:var(--teal)} .kpi.lat .sq{background:var(--teal)} .kpi.cost .kv{color:var(--violet)} .kpi.cost .sq{background:var(--violet)} .kpi.pay .kv{color:var(--azul)} .kpi.pay .sq{background:var(--azul)}
  .mcard{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:13px 15px;margin-bottom:14px}
  .mcard h3{margin:0 0 3px;font-size:14px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap} .mcard .msub{font-size:11.5px;color:var(--mut);margin-bottom:12px}
  .mgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px} @media(max-width:820px){.mgrid{grid-template-columns:1fr}} .mgrid .mcard{margin:0}
  .peakpill{font:700 10.5px ui-monospace,monospace;background:rgba(12,111,100,.12);color:var(--teal);padding:2px 8px;border-radius:999px}
  .bars{display:flex;align-items:flex-end;gap:2px;height:150px;padding-top:15px} .bars.dense{gap:1px}
  .bars .b{flex:1;background:rgba(30,58,138,.28);border-radius:3px 3px 0 0;min-height:2px;cursor:pointer;position:relative} .bars .b:hover{filter:brightness(1.15)}
  .bars .b.peak{background:linear-gradient(180deg,var(--azul),var(--teal))} .bars .b.sel{background:linear-gradient(180deg,var(--violet),var(--azul));outline:2px solid var(--violet);outline-offset:1px}
  .bars .b .bl{position:absolute;top:-14px;left:50%;transform:translateX(-50%);font:700 9px ui-monospace,monospace;color:var(--mut);opacity:0;white-space:nowrap;pointer-events:none} .bars .b:hover .bl{opacity:1}
  .axis{display:flex;gap:2px;margin-top:5px} .axis span{flex:1;text-align:center;font:500 9px ui-monospace,monospace;color:var(--faint);overflow:hidden}
  .donutwrap{display:flex;align-items:center;gap:16px;flex-wrap:wrap} .donut{position:relative;width:120px;height:120px} .donut .ct{position:absolute;inset:0;display:grid;place-items:center;text-align:center} .donut .ct .p{font:800 24px ui-monospace,monospace;color:var(--ok)} .donut .ct .l{font-size:10px;color:var(--mut)}
  .dleg{display:flex;flex-direction:column;gap:7px;font-size:12.5px} .dleg .li{display:flex;align-items:center;gap:7px} .dleg .sw{width:11px;height:11px;border-radius:3px} .dleg b{font-family:ui-monospace,monospace}
  .fbar,.sbar,.rbar{display:flex;align-items:center;gap:9px;margin:7px 0}
  .fbar .fn,.sbar .fn,.rbar .fn{width:112px;font:600 11px ui-monospace,monospace;flex:0 0 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fbar .ft,.sbar .ft,.rbar .ft{flex:1;height:19px;background:var(--card2);border:1px solid var(--bd);border-radius:6px;overflow:hidden}
  .fbar .ff{height:100%;background:linear-gradient(90deg,rgba(185,28,28,.55),var(--err));display:flex;align-items:center;justify-content:flex-end;padding-right:6px;color:#fff;font:700 10px ui-monospace,monospace;border-radius:6px 0 0 6px;min-width:22px}
  .rbar .ff{height:100%;background:linear-gradient(90deg,rgba(30,58,138,.45),var(--azul));display:flex;align-items:center;justify-content:flex-end;padding-right:6px;color:#fff;font:700 10px ui-monospace,monospace;border-radius:6px 0 0 6px;min-width:22px} .rbar .ff.op{background:linear-gradient(90deg,rgba(180,83,9,.45),var(--warn))}
  .sbar .sf{height:100%;display:flex;align-items:center;justify-content:flex-end;padding-right:6px;color:#fff;font:700 10px ui-monospace,monospace;border-radius:6px 0 0 6px;min-width:26px}
  .sbar .sf.hi{background:linear-gradient(90deg,rgba(21,128,61,.55),var(--ok))} .sbar .sf.mid{background:linear-gradient(90deg,rgba(180,83,9,.55),var(--warn))} .sbar .sf.lo{background:linear-gradient(90deg,rgba(185,28,28,.55),var(--err))}
  .fbar .fnote{width:150px;font-size:10px;color:var(--faint);flex:0 0 auto} .fbar .smeta,.sbar .smeta,.rbar .rmeta{width:62px;text-align:right;font:600 10px ui-monospace,monospace;color:var(--faint);flex:0 0 auto}
  @media(max-width:560px){.fbar .fnote{display:none}}
  .fempty{color:var(--ok);font-size:13px;padding:6px 0}
  .tstack{display:flex;height:26px;border-radius:7px;overflow:hidden;border:1px solid var(--bd);margin-bottom:12px} .tstack div{display:flex;align-items:center;justify-content:center;font:700 10px ui-monospace,monospace;overflow:hidden}
  .tstack .s-b{background:rgba(148,163,184,.42);color:#334155} .tstack .s-p{background:var(--azul);color:#fff} .tstack .s-u{background:var(--violet);color:#fff}
  .tleg{display:flex;flex-direction:column;gap:7px;font-size:12.5px} .tleg .li{display:flex;align-items:center;gap:7px} .tleg .sw{width:11px;height:11px;border-radius:3px} .tleg b{font-family:ui-monospace,monospace} .tleg .bar{flex:1}
  .paidnote{margin-top:11px;font-size:12px;color:var(--mut);border-top:1px solid var(--bd);padding-top:9px} .paidnote b{color:var(--azul);font-family:ui-monospace,monospace}
  .convtop{display:flex;align-items:baseline;gap:12px;margin-bottom:12px;flex-wrap:wrap} .convpct{font:800 32px ui-monospace,monospace;color:var(--azul)} .convsub{font-size:12px;color:var(--mut);flex:1;min-width:160px}
  .funnel{display:flex;flex-direction:column;gap:8px} .fstage{display:flex;align-items:center;gap:9px} .fst-l{width:88px;font:600 11px ui-monospace,monospace;color:var(--mut);flex:0 0 auto}
  .fst-bar{flex:1;height:23px;background:var(--card2);border:1px solid var(--bd);border-radius:6px;overflow:hidden} .fst-fill{height:100%;display:flex;align-items:center;justify-content:flex-end;padding-right:7px;font:700 11px ui-monospace,monospace;border-radius:6px 0 0 6px;min-width:24px}
  .fst-fill.base{background:rgba(148,163,184,.5);color:#334155} .fst-fill.conv{background:linear-gradient(90deg,rgba(30,58,138,.45),var(--azul));color:#fff}
  .heat{display:grid;grid-template-columns:38px repeat(24,minmax(18px,1fr));gap:3px;min-width:640px} .heat .hh{font:500 9px ui-monospace,monospace;color:var(--faint);text-align:center;align-self:end;padding-bottom:2px} .heat .hlb{font:600 10px ui-monospace,monospace;color:var(--mut);display:flex;align-items:center}
  .heat .hcell{height:18px;border-radius:3px;border:1px solid rgba(226,232,240,.6)} .heat .hcell.pk{outline:2px solid var(--teal);outline-offset:-1px}
  .heatleg{display:flex;align-items:center;gap:5px;margin-top:11px} .heatleg .hsw{width:17px;height:11px;border-radius:3px;border:1px solid var(--bd)}
  .recwrap{overflow-x:auto} .fchip{font:600 10px ui-monospace,monospace;background:rgba(185,28,28,.12);color:var(--err);padding:1px 6px;border-radius:5px;margin:0 3px 3px 0;display:inline-block} .cchip{font:600 10px ui-monospace,monospace;background:rgba(21,128,61,.13);color:var(--ok);padding:1px 6px;border-radius:5px}
</style></head><body>
<header><span class="logo">🛠</span><b>Consola del operador · PlacaPe</b><span class="sub">scraping · VPS Perú</span></header>
<main>
  <div class="ctlbar">
    <div class="row" style="justify-content:space-between">
      <div class="row">
        <span class="ctl-lbl">Motor automático</span>
        <button id="engBtn" class="sw off" onclick="toggleEngine()">…</button>
        <span id="engInfo" class="meta"></span>
      </div>
      <div class="row" style="align-items:flex-end;gap:10px">
        <div class="ffld"><label>Placa</label><input id="qplaca" class="pl" placeholder="ABC123" maxlength="8"></div>
        <div class="ffld"><label>Nivel</label>
          <select id="qtier"><option value="BASIC">BASIC (gratis)</option><option value="PRO" selected>PRO</option><option value="ULTRA">ULTRA (IA)</option></select></div>
        <div class="ffld"><label>WhatsApp</label><input id="qwa" placeholder="+51…" style="width:120px"></div>
        <div class="ffld"><label>Correo</label><input id="qmail" placeholder="cliente@…" style="width:150px"></div>
        <button class="ok" onclick="enqueue()">Encolar pedido</button>
      </div>
    </div>
    <div class="row" style="margin-top:10px;gap:8px;align-items:center">
      <button class="sec" onclick="toggleAutoSrc()" style="font-size:13px;padding:7px 12px">⚙ Fuentes del motor ▾</button>
      <span class="meta" id="autoSrcSummary"></span>
    </div>
    <div id="autoSrcBox" style="display:none;margin-top:8px;padding:11px;border:1px solid var(--bd);border-radius:10px;background:var(--card2)"></div>
    <div id="engBars"><div class="prog2 idle"><div class="top"><span class="pl">Motor libre</span><span class="pc"></span></div><div class="st">Sin pedidos en proceso</div><div class="bw"><div class="bf"></div></div></div></div>
  </div>

  <div class="tabs">
    <button class="tab active" id="tab-b-hist" onclick="showTab('hist')">Historial de pedidos</button>
    <button class="tab" id="tab-b-metrics" onclick="showTab('metrics')">Métricas &amp; KPIs</button>
    <button class="tab" id="tab-b-manual" onclick="showTab('manual')">Manual / QA</button>
  </div>

  <section id="tab-hist">
    <div class="sumchips" id="sumchips"></div>
    <div class="ftbar">
      <div class="ffld"><label>Placa</label><input class="pl" id="hf-placa" maxlength="8" placeholder="ABC123" oninput="hfInput()"></div>
      <div class="ffld"><label>Estado</label><select id="hf-estado" onchange="hfInput()"><option value="">Todos</option><option>pendiente</option><option>procesando</option><option>listo</option><option>entregado</option><option>error</option></select></div>
      <div class="ffld"><label>Nivel</label><select id="hf-tier" onchange="hfInput()"><option value="">Todos</option><option>BASIC</option><option>PRO</option><option>ULTRA</option></select></div>
      <div class="ffld"><label>Origen</label><select id="hf-origin" onchange="hfInput()"><option value="">Todos</option><option value="operador">operador</option><option value="servicio">servicio</option></select></div>
      <div class="ffld"><label>Usuario</label><input id="hf-user" style="width:140px" placeholder="correo / id" oninput="hfInput()"></div>
      <div class="ffld"><label>Fecha</label><div class="fseg" id="hf-fecha"><button data-v="hoy" onclick="setHFecha('hoy')">Hoy</button><button data-v="7d" onclick="setHFecha('7d')">7 d</button><button data-v="mes" onclick="setHFecha('mes')">Mes</button><button data-v="todo" class="on" onclick="setHFecha('todo')">Todo</button><button data-v="custom" onclick="setHFecha('custom')">Custom</button></div></div>
      <div class="ffld" id="hf-custom" style="display:none;flex-direction:row;gap:8px"><div class="ffld"><label>Desde</label><input type="date" id="hf-desde" onchange="hfInput()"></div><div class="ffld"><label>Hasta</label><input type="date" id="hf-hasta" onchange="hfInput()"></div></div>
      <div style="flex:1 1 auto"></div>
      <button class="fclr" onclick="clearHF()">✕ Limpiar</button>
    </div>
    <div class="hsplit">
      <div class="hleft">
        <div class="hleft-hd"><span class="hl-ttl">Historial <span id="histcount" class="meta"></span></span>
          <span class="perpage-top">Filas por página <select id="perTop" onchange="setPerPage(this.value)"><option>25</option><option value="50" selected>50</option><option>100</option><option value="99999">Todas</option></select></span></div>
        <div class="tbl-scroll"><table class="ped"><thead><tr><th>Placa</th><th>Origen</th><th>Nivel</th><th>Usuario</th><th>Reporte</th><th>Estado</th><th>Creado</th><th>Terminado</th><th>Duración</th></tr></thead><tbody id="histbody"><tr><td colspan="9" style="color:#64748B">Cargando…</td></tr></tbody></table></div>
        <div class="pager" id="histpager"></div>
      </div>
      <div class="hpanel" id="pdetail"><div class="dempty">Selecciona un pedido para ver fuentes, capturas, reporte y logs.</div></div>
    </div>
  </section>

  <section id="tab-metrics" style="display:none">
    <div class="mtbar">
      <div class="ffld"><label>Rango</label><div class="fseg" id="m-range"><button data-v="hoy" onclick="msetRange('hoy')">Hoy</button><button data-v="7d" class="on" onclick="msetRange('7d')">7 d</button><button data-v="mes" onclick="msetRange('mes')">Mes</button><button data-v="todo" onclick="msetRange('todo')">Todo</button><button data-v="custom" onclick="msetRange('custom')">Custom</button></div></div>
      <div class="ffld m-custom" style="display:none"><label>Desde</label><input type="date" id="m-from"></div>
      <div class="ffld m-custom" style="display:none"><label>Hasta</label><input type="date" id="m-to"></div>
      <div class="ffld"><label>Granularidad</label><div class="fseg" id="m-gran"><button data-v="600000" onclick="msetGran(600000)">10 min</button><button data-v="1800000" onclick="msetGran(1800000)">30 min</button><button data-v="3600000" class="on" onclick="msetGran(3600000)">1 h</button><button data-v="86400000" onclick="msetGran(86400000)">1 día</button></div></div>
      <button class="ok" onclick="mgen()">Generar</button>
      <div style="flex:1 1 auto"></div>
      <div class="mselinfo" id="m-selinfo"></div>
    </div>
    <div class="kpis" id="kpis"></div>
    <div class="mcard">
      <h3>Reportes generados en el tiempo <span class="peakpill" id="peakLabel"></span></h3>
      <div class="msub">Gráfica principal. <b>Clic en una barra</b> → KPIs, dona, ranking, fallas y la tabla se recalculan sobre ese punto.</div>
      <div class="bars" id="mainChart"></div><div class="axis" id="mainAxis"></div>
    </div>
    <div class="mcard">
      <h3>Actividad por día y hora <span class="peakpill" id="heatPeak"></span></h3>
      <div class="msub">Mapa de calor por <b>día de la semana × hora</b> — ubica las ventanas pico.</div>
      <div style="overflow-x:auto"><div class="heat" id="heat"></div></div><div class="heatleg" id="heatLeg"></div>
    </div>
    <div class="mgrid">
      <div class="mcard"><h3>Limpios vs. con fallas</h3><div class="msub">Limpio = ninguna fuente en ERROR.</div><div class="donutwrap"><div class="donut" id="donut"></div><div class="dleg" id="donutLegend"></div></div></div>
      <div class="mcard"><h3>Conversión BASIC → pago</h3><div class="msub">De las consultas gratis, cuántas pagaron un PRO/ULTRA de la misma placa.</div><div id="convBox"></div></div>
      <div class="mcard"><h3>¿Qué fuentes fallan más?</h3><div class="msub">Errores por fuente en el ámbito.</div><div id="fails"></div></div>
      <div class="mcard"><h3>Tasa de éxito por fuente</h3><div class="msub">% de corridas OK (peor primero).</div><div id="successRate"></div></div>
      <div class="mcard"><h3>Tipo de reporte</h3><div class="msub">BASIC / PRO / ULTRA · pago vs. gratis.</div><div id="tierBreak"></div></div>
      <div class="mcard"><h3>Ranking de usuarios</h3><div class="msub">Quién genera más reportes (top 8).</div><div id="userRank"></div></div>
    </div>
    <div class="mcard" style="padding:0">
      <div class="hleft-hd"><span class="hl-ttl">Registros del ámbito <span id="recCount" class="meta"></span></span><span class="meta">se actualiza con el rango / punto</span></div>
      <div class="recwrap"><table class="ped" style="border:0"><thead><tr><th>Fecha / hora</th><th>Placa</th><th>Nivel</th><th>Origen</th><th>Estado</th><th>Fallas</th><th>Duración</th></tr></thead><tbody id="recBody"></tbody></table></div>
      <div class="pager" id="recNote"></div>
    </div>
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
<div id="lightbox" onclick="lbClose(event)"><div class="lbi" onclick="event.stopPropagation()"><div class="lbh"><span id="lbTitle"></span><button onclick="lbClose()">✕</button></div><img id="lbImg" alt="captura"><div class="lbf" id="lbFoot"></div></div></div>
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
  var img=r.screenshot?'<img src="/shot/'+pl+'/'+srcId(r.source)+'.png?t='+Date.now()+'" onclick="lbOpenImg(this.src,\\''+srcId(r.source)+' · '+esc(pl)+'\\')">':'';
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
      var cancel=c.jobId?' <button onclick="cancelAuto(\\''+esc(c.jobId)+'\\')" title="Cancelar este pedido" style="margin-left:10px;border:1px solid #FCA5A5;background:#FEF2F2;color:#B91C1C;border-radius:8px;padding:2px 9px;font:600 11px system-ui;cursor:pointer">✕ Cancelar</button>':'';
      return '<div class="prog2"><div class="top"><span class="pl">⚙ '+esc(c.placa)+'</span><span class="pc">'+pct+'%'+cancel+'</span></div>'+
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
function cancelAuto(jid){if(!confirm('¿Cancelar el pedido en proceso? Quedará marcado como error y podrás re-generarlo.'))return;
  log('⏹ cancelando job '+jid+' …');
  fetch('/api/cancel/'+jid,{method:'POST'}).then(function(){log('⏹ cancelado');loadEngine();loadHistory();}).catch(function(e){log('✖ '+e)});}
function fmtTime(iso){if(!iso)return'—';try{var d=new Date(iso);return d.toLocaleDateString()+' '+d.toTimeString().slice(0,5);}catch(e){return esc(iso);}}
function fmtDur(a,b){if(!a||!b)return'—';try{var ms=new Date(b)-new Date(a);if(ms<0)return'—';var s=Math.round(ms/1000);return s<60?s+'s':(Math.floor(s/60)+'m '+(s%60)+'s');}catch(e){return'—';}}
function showTab(t){
  ['hist','manual','metrics'].forEach(function(x){
    var s=document.getElementById('tab-'+x); if(s)s.style.display=(x===t)?'block':'none';
    var b=document.getElementById('tab-b-'+x); if(b)b.className='tab'+(x===t?' active':'');
  });
  if(t==='metrics')loadMetrics();
}
var SELECTED=null, SELECTED_ID=null, DTAB='fuentes', HISTSEEN=false;
var HISTLIST=[], HISTPAGE=0, HISTPER=50;
// ── Filtros del historial (client-side sobre HISTLIST; el server manda hasta 2000) ──
var HF={placa:'',estado:'',tier:'',origin:'',user:'',fecha:'todo',desde:'',hasta:''};
function histTs(p){return p.createdAt?Date.parse(p.createdAt):0;}
function isoDate(ts){var d=new Date(ts);function z(n){return(n<10?'0':'')+n;}return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate());}
function filteredHist(){return HISTLIST.filter(function(p){
  if(HF.placa&&String(p.placa||'').toUpperCase().indexOf(HF.placa.toUpperCase())<0)return false;
  if(HF.estado&&p.estado!==HF.estado)return false;
  if(HF.tier&&String(p.tier||'PRO').toUpperCase()!==HF.tier)return false;
  if(HF.origin&&((String(p.origin||'servicio').toLowerCase()==='operador')?'operador':'servicio')!==HF.origin)return false;
  if(HF.user){var u=(String(p.origin||'').toLowerCase()==='operador')?'operador':String(p.email||p.userId||p.whatsapp||'');if(u.toLowerCase().indexOf(HF.user.toLowerCase())<0)return false;}
  if(HF.fecha!=='todo'){var ts=histTs(p),now=Date.now();
    if(HF.fecha==='hoy'){var d0=new Date();d0.setHours(0,0,0,0);if(ts<d0.getTime())return false;}
    else if(HF.fecha==='7d'){if(ts<now-604800000)return false;}
    else if(HF.fecha==='mes'){if(ts<now-2592000000)return false;}
    else if(HF.fecha==='custom'){if(HF.desde&&ts<new Date(HF.desde+'T00:00:00').getTime())return false;if(HF.hasta&&ts>new Date(HF.hasta+'T23:59:59').getTime())return false;}
  }
  return true;
});}
function renderSumChips(){
  var d0=new Date();d0.setHours(0,0,0,0);var t0=d0.getTime();
  var proc=0,pend=0,err=0,okhoy=0;
  for(var i=0;i<HISTLIST.length;i++){var p=HISTLIST[i];if(p.estado==='procesando')proc++;else if(p.estado==='pendiente')pend++;else if(p.estado==='error')err++;if((p.estado==='listo'||p.estado==='entregado')&&histTs(p)>=t0)okhoy++;}
  var defs=[['proc',proc,'En proceso','procesando'],['pend',pend,'Pendientes','pendiente'],['ok',okhoy,'Listos hoy','__okhoy'],['err',err,'Con error','error'],['all',HISTLIST.length,'Todos','']];
  document.getElementById('sumchips').innerHTML=defs.map(function(d){
    var on=(d[3]==='__okhoy')?(HF.estado===''&&HF.fecha==='hoy'):(HF.estado===d[3]&&d[3]!=='');
    return '<div class="schip s-'+d[0]+(on?' on':'')+'" onclick="chipFilter(\\''+d[3]+'\\')"><div class="sn">'+d[1]+'</div><div class="sk">'+d[2]+'</div></div>';
  }).join('');
}
function chipFilter(f){
  if(f==='__okhoy'){HF.estado='';document.getElementById('hf-estado').value='';setHFecha('hoy');return;}
  HF.estado=(HF.estado===f)?'':f;document.getElementById('hf-estado').value=HF.estado;HISTPAGE=0;renderHistory();
}
function setHFecha(v){HF.fecha=v;var segs=document.querySelectorAll('#hf-fecha button');for(var i=0;i<segs.length;i++)segs[i].className=(segs[i].getAttribute('data-v')===v)?'on':'';
  var cust=document.getElementById('hf-custom');if(cust)cust.style.display=(v==='custom')?'flex':'none';
  if(v==='custom'){var f=document.getElementById('hf-desde'),h=document.getElementById('hf-hasta');if(f&&!f.value){f.value=isoDate(Date.now()-604800000);HF.desde=f.value;}if(h&&!h.value){h.value=isoDate(Date.now());HF.hasta=h.value;}}
  HISTPAGE=0;renderHistory();
}
function hfInput(){HF.placa=document.getElementById('hf-placa').value;HF.user=document.getElementById('hf-user').value;HF.estado=document.getElementById('hf-estado').value;HF.tier=document.getElementById('hf-tier').value;HF.origin=document.getElementById('hf-origin').value;var d=document.getElementById('hf-desde'),h=document.getElementById('hf-hasta');HF.desde=d?d.value:'';HF.hasta=h?h.value:'';HISTPAGE=0;renderHistory();}
function clearHF(){HF={placa:'',estado:'',tier:'',origin:'',user:'',fecha:'todo',desde:'',hasta:''};['hf-placa','hf-user','hf-estado','hf-tier','hf-origin'].forEach(function(i){var e=document.getElementById(i);if(e)e.value='';});setHFecha('todo');}
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
  var src=filteredHist(),m={},order=[];
  for(var i=0;i<src.length;i++){var p=src[i],k=p.placa;if(!m[k]){m[k]={placa:k,list:[]};order.push(k);}m[k].list.push(p);}
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
  renderSumChips();
  var groups=groupHistory(), total=groups.length;
  var hc=document.getElementById('histcount'); if(hc)hc.textContent='· '+filteredHist().length+' pedido(s) · '+total+' placa(s)';
  if(!total){tb.innerHTML='<tr><td colspan="9" style="color:#64748B">'+(HISTLIST.length?'Sin pedidos que coincidan con el filtro':'Sin pedidos todavía')+'</td></tr>';renderPager(0,1,0);return;}
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
  el.innerHTML='<button onclick="histPage(-1)"'+(HISTPAGE<=0?' disabled':'')+'>‹ Anterior</button>'+
    '<span>Página '+(HISTPAGE+1)+' de '+pages+'</span>'+
    '<button onclick="histPage(1)"'+(HISTPAGE>=pages-1?' disabled':'')+'>Siguiente ›</button>'+
    '<span style="margin-left:auto">'+(HISTPAGE*HISTPER+1)+'–'+shownEnd+' de '+total+'</span>';
}
function setPerPage(v){HISTPER=parseInt(v,10)||50;HISTPAGE=0;var t=document.getElementById('perTop');if(t)t.value=String(HISTPER);renderHistory();}
function histPage(d){HISTPAGE+=d;renderHistory();}
function markSel(){var rows=document.querySelectorAll('#histbody tr');for(var i=0;i<rows.length;i++){var sub=rows[i].getAttribute('data-group')?'subrow':'';var sel=(rows[i].getAttribute('data-placa')===SELECTED)?'sel':'';rows[i].className=(sub&&sel)?sub+' '+sel:(sub||sel);}}
function hHeader(pl){return '<h2>'+esc(pl)+' <button class="sec" style="font-size:13px;padding:6px 12px" onclick="requeuePedido()">↻ Re-generar reporte</button></h2>';}
function detailTabs(){return '<div class="tabs" style="margin:10px 0 12px">'+
  '<button class="tab'+(DTAB==='fuentes'?' active':'')+'" onclick="showDetailTab(\\'fuentes\\')">Fuentes</button>'+
  '<button class="tab'+(DTAB==='reporte'?' active':'')+'" onclick="showDetailTab(\\'reporte\\')">Reporte al usuario</button></div>';}
function selectPedido(pl,id){SELECTED=pl;SELECTED_ID=id;DTAB='fuentes';markSel();showDetailTab('fuentes');}
function showDetailTab(t){DTAB=t;if(t==='reporte')loadWebReport();else loadFuentes();}
// ── Pestaña FUENTES: barras PERSISTENTES por fuente (color + tiempo) + capturas miniatura + logs ──
// Fusiona el reporte.json (resultados finales con ms + capturas) con el estado EN VIVO (/api/engine)
// para que las fuentes aún en curso muestren su barra; así las barras nunca desaparecen.
function loadFuentes(){var pl=SELECTED,d=document.getElementById('pdetail');if(!d)return;
  if(!d.querySelector('.fsr')&&!d.querySelector('.shotgrid'))d.innerHTML=hHeader(pl)+detailTabs()+'<div class="pmeta">Cargando…</div>';
  Promise.all([
    fetch('/api/pedido-report?placa='+encodeURIComponent(pl)).then(function(r){return r.json()}).catch(function(){return {results:[]};}),
    fetch('/api/engine').then(function(r){return r.json()}).catch(function(){return {};})
  ]).then(function(a){
    if(SELECTED!==pl||DTAB!=='fuentes')return;
    var rep=a[0]||{},s=a[1]||{},results=rep.results||[];
    var cj=((s.currentJobs)||[]).filter(function(c){return c.placa===pl;})[0];
    renderFuentes(pl,rep,results,cj);
    if(cj&&DTAB==='fuentes'&&SELECTED===pl)setTimeout(function(){if(DTAB==='fuentes'&&SELECTED===pl)loadFuentes();},4000);
  });}
function fbarCls(status){return (status==='ERROR')?'err':((status==='RUNNING')?'run':((status==='PENDING')?'pend':'ok'));}
function renderFuentes(pl,rep,results,cj){var d=document.getElementById('pdetail');if(!d)return;
  var byId={};results.forEach(function(r){byId[srcId(r.source)]=r;});
  var cjById={};if(cj&&cj.sources)cj.sources.forEach(function(x){cjById[srcId(x.source)]=x;});
  var order=[],seen={};function add(id){id=srcId(id);if(!seen[id]){seen[id]=1;order.push(id);}}
  if(cj&&cj.sources)cj.sources.forEach(function(x){add(x.source);});
  results.forEach(function(r){add(r.source);});
  var okN=0,errN=0,runN=0;
  var bars=order.map(function(id){var r=byId[id],live=cjById[id];
    var status=r?r.status:(live?live.status:'PENDING'),cls=fbarCls(status),w=(cls==='pend')?0:((cls==='run')?55:100);
    if(cls==='ok')okN++;else if(cls==='err')errN++;else if(cls==='run')runN++;
    var t=(r&&r.ms!=null&&cls!=='run'&&cls!=='pend')?('<span class="tm">'+(r.ms/1000).toFixed(1)+'s</span>'):'';
    var lab=(cls==='run')?'corriendo…':((cls==='pend')?'en cola':esc(status));
    return '<div class="fsr"><span class="sn" title="'+esc(id)+'">'+esc(id)+'</span><div class="tk"><div class="fl fl-'+cls+'" style="width:'+w+'%"></div></div><span class="st2 '+cls+'">'+t+lab+'</span></div>';
  }).join('');
  var shots=order.filter(function(id){var r=byId[id];return r&&r.screenshot;}).map(function(id){var r=byId[id],cls=fbarCls(r.status);
    var col=(cls==='err')?'var(--err)':((cls==='run')?'var(--run)':'var(--ok)'),u='/shot/'+encodeURIComponent(pl)+'/'+id+'.png?t='+Date.now();
    return '<div class="shotc" onclick="lbOpenImg(\\''+u+'\\',\\''+id+' · '+esc(pl)+'\\')"><img src="'+u+'"><div class="cc"><span>'+esc(id)+'</span><span class="dd" style="background:'+col+'"></span></div></div>';
  }).join('');
  var shotBlock=shots?('<div class="lh" style="margin-top:16px">📸 Capturas por fuente · clic para ampliar</div><div class="shotgrid">'+shots+'</div>'):'';
  var logs=order.map(function(id){return '<a href="/log/'+encodeURIComponent(pl)+'/'+id+'" target="_blank">'+esc(id)+'</a>';}).join('');
  var pct=cj?(cj.percent||0):100;
  var meta='<div class="pmeta">'+order.length+' fuentes · <span style="color:var(--ok)">'+okN+' ok</span>'+(runN?' · <span style="color:var(--run)">'+runN+' corriendo</span>':'')+(errN?' · <span style="color:var(--err)">'+errN+' con error</span>':'')+(cj?' · '+pct+'%':(rep.generatedAt?' · generado '+esc(fmtTime(rep.generatedAt)):''))+'</div>';
  var body=order.length?(meta+'<div style="margin-top:8px">'+bars+'</div>'+shotBlock+'<div class="lh" style="margin-top:16px">Logs por fuente</div><div class="loglinks2">'+logs+'</div>'):('<div class="pmeta">'+(cj?('Procesando… '+pct+'%'):'Aún sin reporte para esta placa.')+'</div>');
  d.innerHTML=hHeader(pl)+detailTabs()+body;}
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
// (showLiveLogs se fusionó en loadFuentes/renderFuentes: barras persistentes por fuente en vivo y al terminar.)
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
// ── Fuentes activas del motor automático (elegibles desde la consola) ──
var AUTOSRC_TOTAL=0;
function updAutoSummary(active,total,ovr){var s=document.getElementById('autoSrcSummary');if(s)s.textContent=active+' de '+total+' fuentes activas · '+(ovr?'personalizado':'por defecto');}
function loadAutoSources(){fetch('/api/auto-sources').then(function(r){return r.json()}).then(function(o){
  var active=o.active||[],all=o.all||[];AUTOSRC_TOTAL=all.length;
  document.getElementById('autoSrcBox').innerHTML=all.map(function(x){var on=active.indexOf(x.id)>=0;
    return '<label class="src" style="margin:0 12px 6px 0"><input type="checkbox" '+(on?'checked':'')+' value="'+esc(x.id)+'" onchange="saveAutoSources()"> '+esc(x.label)+'</label>';}).join('')+
    '<div class="meta" style="margin-top:4px">Aplica a pedidos <b>PRO/ULTRA</b> nuevos (BASIC usa su combo fijo). Desmarca una fuente para que el motor no la corra.</div>';
  updAutoSummary(active.length,all.length,o.overridden);
}).catch(function(){});}
function toggleAutoSrc(){var b=document.getElementById('autoSrcBox');b.style.display=(b.style.display==='none')?'block':'none';if(b.style.display==='block')loadAutoSources();}
function saveAutoSources(){var c=[].slice.call(document.querySelectorAll('#autoSrcBox input:checked')).map(function(i){return i.value});
  fetch('/api/auto-sources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sources:c})})
   .then(function(r){return r.json()}).then(function(o){var a=o.active||[];log('⚙ fuentes del motor: '+a.length+' activas ('+a.join(', ')+')');updAutoSummary(a.length,AUTOSRC_TOTAL,o.overridden);}).catch(function(e){log('✖ '+e)});}

// ── Lightbox de capturas ──
function lbOpenImg(src,title){document.getElementById('lbTitle').textContent=title||'captura';document.getElementById('lbImg').src=src;document.getElementById('lbFoot').textContent=(src||'').split('?')[0];document.getElementById('lightbox').classList.add('on');}
function lbClose(ev){if(ev&&ev.target&&ev.target.id&&ev.target.id!=='lightbox')return;document.getElementById('lightbox').classList.remove('on');}
document.addEventListener('keydown',function(e){if(e.key==='Escape')document.getElementById('lightbox').classList.remove('on');});

// ── Dashboard de Métricas ──────────────────────────────────────────────────
var MEVENTS=[], MR={range:'7d',gran:3600000}, SELB=null, MBUCKETS=[], MSTART=0, MEND=0, MLOADED=false;
var DAYms=86400000, HOURms=3600000;
var FNOTE={atu:'IP datacenter (reCAPTCHA v3)','apeseg-soat':'timeout bajo carga',historial:'lockout SPRL por IP','sat-papeletas':'reCAPTCHA v2',sigm:'Turnstile','mtc-citv':'captcha imagen','sat-captura':'captcha imagen','callao-papeletas':'captcha imagen','sbs-soat':'reCAPTCHA v3',sunarp:'Turnstile pasivo'};
var SRC_PAID=['sunarp','historial','sat-captura','sat-papeletas','callao-papeletas','mtc-citv','apeseg-soat','sbs-soat','atu','sigm'], SRC_BASIC=['sunarp','apeseg-soat','mtc-citv'];
var TCOST={BASIC:0.007,PRO:0.025,ULTRA:0.025};
function mpad(n){return(n<10?'0':'')+n;}
function toInput(ts){var d=new Date(ts);return d.getFullYear()+'-'+mpad(d.getMonth()+1)+'-'+mpad(d.getDate());}
function mfDate(ts){var d=new Date(ts);return mpad(d.getDate())+'/'+mpad(d.getMonth()+1);}
function mfTime(ts){var d=new Date(ts);return mpad(d.getHours())+':'+mpad(d.getMinutes());}
function mfDT(ts){return mfDate(ts)+' '+mfTime(ts);}
function mprep(evs){var pb={};evs.forEach(function(e){if(e.tier!=='BASIC'){(pb[e.placa]=pb[e.placa]||[]).push(e.ts);}});
  Object.keys(pb).forEach(function(k){pb[k].sort(function(a,b){return a-b;});});
  evs.forEach(function(e){if(e.tier==='BASIC'){var a=pb[e.placa]||[],f=0;for(var i=0;i<a.length;i++){if(a[i]>e.ts){f=a[i];break;}}if(f){e.conv=true;e.convDelay=f-e.ts;}}});return evs;}
function loadMetrics(){fetch('/api/metrics').then(function(r){return r.json()}).then(function(o){MEVENTS=mprep((o&&o.events)||[]);MLOADED=true;mgen();}).catch(function(){document.getElementById('m-selinfo').innerHTML='<span style="color:var(--err)">No se pudo cargar /api/metrics</span>';});}
function msetRange(v){MR.range=v;var b=document.querySelectorAll('#m-range button');for(var i=0;i<b.length;i++)b[i].className=(b[i].getAttribute('data-v')===v)?'on':'';
  var cust=(v==='custom'),cs=document.querySelectorAll('.m-custom');for(var j=0;j<cs.length;j++)cs[j].style.display=cust?'flex':'none';
  if(cust){var f=document.getElementById('m-from'),h=document.getElementById('m-to');if(f&&!f.value)f.value=toInput(Date.now()-7*DAYms);if(h&&!h.value)h.value=toInput(Date.now());}}
function msetGran(g){MR.gran=g;var b=document.querySelectorAll('#m-gran button');for(var i=0;i<b.length;i++)b[i].className=(parseInt(b[i].getAttribute('data-v'),10)===g)?'on':'';}
function mBounds(){var end=Date.now(),start,t=new Date();t.setHours(0,0,0,0);
  if(MR.range==='hoy')start=t.getTime();
  else if(MR.range==='7d')start=end-7*DAYms;
  else if(MR.range==='mes')start=end-30*DAYms;
  else if(MR.range==='todo')start=MEVENTS.length?MEVENTS[0].ts:end-30*DAYms;
  else{var f=document.getElementById('m-from').value,h=document.getElementById('m-to').value;start=f?new Date(f+'T00:00:00').getTime():end-7*DAYms;end=h?new Date(h+'T23:59:59').getTime():end;}
  return [start,end];}
function bucketize(evs,start,end,g){var s0=Math.floor(start/g)*g,map={};
  evs.forEach(function(e){if(e.ts>=start&&e.ts<end){var k=Math.floor(e.ts/g);(map[k]=map[k]||[]).push(e);}});
  var out=[];for(var t=s0;t<end;t+=g){var k=Math.floor(t/g);out.push({t0:t,t1:t+g,events:map[k]||[]});}return out;}
function mgen(){if(!MLOADED)return;var b=mBounds();MSTART=b[0];MEND=b[1];var g=MR.gran;
  var cnt=Math.ceil((MEND-Math.floor(MSTART/g)*g)/g);
  if(cnt>1600){document.getElementById('m-selinfo').innerHTML='<span style="color:var(--err)">⚠ '+cnt+' puntos: sube la granularidad o acorta el rango.</span>';document.getElementById('mainChart').innerHTML='';document.getElementById('mainAxis').innerHTML='';return;}
  var evs=MEVENTS.slice().sort(function(a,b){return a.ts-b.ts;});
  MBUCKETS=bucketize(evs,MSTART,MEND,g);SELB=null;renderMain();renderMDerived();}
function mScope(){if(SELB!=null&&MBUCKETS[SELB])return MBUCKETS[SELB].events;var all=[];for(var i=0;i<MBUCKETS.length;i++)all=all.concat(MBUCKETS[i].events);return all;}
function mfBucket(bk){return MR.gran>=DAYms?mfDate(bk.t0):(mfDate(bk.t0)+' '+mfTime(bk.t0)+'–'+mfTime(bk.t1));}
function renderMain(){var counts=MBUCKETS.map(function(bk){return bk.events.length;});
  var mx=Math.max(1,Math.max.apply(null,counts)),peak=counts.indexOf(Math.max.apply(null,counts)),dense=MBUCKETS.length>90;
  var box=document.getElementById('mainChart');box.className='bars'+(dense?' dense':'');
  box.innerHTML=MBUCKETS.map(function(bk,i){var n=bk.events.length,cls=(i===SELB)?'sel':(i===peak&&n>0?'peak':'');
    return '<div class="b '+cls+'" style="height:'+Math.max(2,n/mx*100)+'%" onclick="mpick('+i+')"><span class="bl">'+mfBucket(bk)+' · '+n+'</span></div>';}).join('');
  var step=Math.max(1,Math.ceil(MBUCKETS.length/12));
  document.getElementById('mainAxis').innerHTML=MBUCKETS.map(function(bk,i){return '<span>'+((i%step===0)?(MR.gran>=DAYms?mfDate(bk.t0):mfTime(bk.t0)):'')+'</span>';}).join('');
  document.getElementById('peakLabel').textContent=MBUCKETS.length&&mx>0?('pico '+(MR.gran>=DAYms?mfDate(MBUCKETS[peak].t0):mfTime(MBUCKETS[peak].t0))+' · '+mx):'';}
function mpick(i){SELB=(SELB===i)?null:i;renderMain();renderMDerived();}
function mclear(){SELB=null;renderMain();renderMDerived();}
function renderMDerived(){
  var sc=mScope(),total=sc.length;
  var si=document.getElementById('m-selinfo');
  if(SELB!=null&&MBUCKETS[SELB])si.innerHTML='🔎 Punto: <b>'+mfBucket(MBUCKETS[SELB])+'</b> · '+total+' reportes <button class="fclr" onclick="mclear()">✕ ver todo el rango</button>';
  else si.innerHTML='Rango: <b>'+mfDT(MSTART)+' → '+mfDT(MEND)+'</b> · '+total+' reportes';
  var clean=0,cnt={};for(var i=0;i<sc.length;i++){var e=sc[i];if(!e.fails||!e.fails.length)clean++;(e.fails||[]).forEach(function(s){cnt[s]=(cnt[s]||0)+1;});}
  var wf=total-clean,cleanPct=total?Math.round(clean/total*100):0,failPct=total?100-cleanPct:0;
  var farr=Object.keys(cnt).map(function(s){return{s:s,n:cnt[s]};}).sort(function(a,b){return b.n-a.n;});
  var durs=sc.filter(function(e){return e.dur>0;}).map(function(e){return e.dur;}).sort(function(a,b){return a-b;});
  function q(p){if(!durs.length)return 0;return durs[Math.min(durs.length-1,Math.floor(p/100*durs.length))];}
  function fmtS(s){if(!s)return '—';var m=Math.floor(s/60);return(m?m+'m ':'')+(s%60)+'s';}
  var cost=sc.reduce(function(a,e){return a+(TCOST[e.tier]||0.025);},0);
  var paid=sc.filter(function(e){return e.tier!=='BASIC';}).length,paidPct=total?Math.round(paid/total*100):0;
  document.getElementById('kpis').innerHTML=[
    {c:'all',l:'Reportes',v:total,s:(SELB!=null?'en el punto':'en el rango')},
    {c:'ok',l:'Limpios (sin fallas)',v:clean,s:cleanPct+'% del ámbito'},
    {c:'err',l:'Con &ge;1 falla',v:wf,s:failPct+'% del ámbito'},
    {c:'top',l:'Fuente que más falla',v:farr.length?farr[0].s:'—',s:farr.length?(farr[0].n+' · '+(FNOTE[farr[0].s]||'')):'sin fallas'},
    {c:'lat',l:'Latencia p95',v:fmtS(q(95)),s:'p50 '+fmtS(q(50))},
    {c:'cost',l:'Costo CapSolver',v:'S/ '+cost.toFixed(2),s:'~S/ '+(total?(cost/total).toFixed(3):'0')+'/rep'},
    {c:'pay',l:'% pago (PRO+ULTRA)',v:paidPct+'%',s:paid+' de '+total}
  ].map(function(k){return '<div class="kpi '+k.c+'"><div class="kl"><span class="sq"></span>'+k.l+'</div><div class="kv">'+k.v+'</div><div class="ks">'+esc(k.s)+'</div></div>';}).join('');
  var C=301.6,seg=(C*cleanPct/100);
  document.getElementById('donut').innerHTML='<svg width="120" height="120" viewBox="0 0 120 120"><circle cx="60" cy="60" r="48" fill="none" style="stroke:rgba(185,28,28,.5)" stroke-width="15"/><circle cx="60" cy="60" r="48" fill="none" style="stroke:#15803D" stroke-width="15" stroke-dasharray="'+seg.toFixed(1)+' '+(C-seg).toFixed(1)+'" stroke-dashoffset="0" transform="rotate(-90 60 60)" stroke-linecap="round"/></svg><div class="ct"><div class="p">'+cleanPct+'%</div><div class="l">limpios</div></div>';
  document.getElementById('donutLegend').innerHTML='<div class="li"><span class="sw" style="background:#15803D"></span>Limpios <b>'+clean+'</b> ('+cleanPct+'%)</div><div class="li"><span class="sw" style="background:rgba(185,28,28,.6)"></span>Con fallas <b>'+wf+'</b> ('+failPct+'%)</div>';
  var fmax=farr.length?farr[0].n:1;
  document.getElementById('fails').innerHTML=farr.length?farr.slice(0,7).map(function(x){return '<div class="fbar"><span class="fn">'+esc(x.s)+'</span><div class="ft"><div class="ff" style="width:'+Math.max(12,x.n/fmax*100)+'%">'+x.n+'</div></div><span class="fnote">'+esc(FNOTE[x.s]||'')+'</span></div>';}).join(''):'<div class="fempty">Sin fuentes en error en el ámbito.</div>';
  // tasa de éxito por fuente
  var runs={},errs={};sc.forEach(function(e){(e.tier==='BASIC'?SRC_BASIC:SRC_PAID).forEach(function(s){runs[s]=(runs[s]||0)+1;});(e.fails||[]).forEach(function(s){errs[s]=(errs[s]||0)+1;});});
  var sarr=Object.keys(runs).map(function(s){var r=runs[s],er=errs[s]||0;return{s:s,r:r,e:er,pc:r?((r-er)/r*100):100};}).sort(function(a,b){return a.pc-b.pc;});
  document.getElementById('successRate').innerHTML=sarr.length?sarr.map(function(x){var lv=x.pc>=95?'hi':(x.pc>=80?'mid':'lo');return '<div class="sbar"><span class="fn">'+esc(x.s)+'</span><div class="ft"><div class="sf '+lv+'" style="width:'+Math.max(8,x.pc)+'%">'+x.pc.toFixed(0)+'%</div></div><span class="smeta">'+x.e+'/'+x.r+'</span></div>';}).join(''):'<div class="fempty" style="color:var(--faint)">Sin corridas en el ámbito.</div>';
  // tipo de reporte
  var tc={BASIC:0,PRO:0,ULTRA:0};sc.forEach(function(e){tc[e.tier]=(tc[e.tier]||0)+1;});var tt=total||1;
  function tw(x){return tc[x]/tt*100;}function tpc(x){return Math.round(tw(x));}
  function tseg(cls,x){return '<div class="'+cls+'" style="width:'+tw(x)+'%">'+(tw(x)>=13?tpc(x)+'%':'')+'</div>';}
  var tleg=[['BASIC','rgba(148,163,184,.55)'],['PRO','#1E3A8A'],['ULTRA','#6D28D9']].map(function(a){return '<div class="li"><span class="sw" style="background:'+a[1]+'"></span><span class="bar">'+a[0]+'</span><b>'+tc[a[0]]+'</b> · '+tpc(a[0])+'%</div>';}).join('');
  document.getElementById('tierBreak').innerHTML=(total?('<div class="tstack">'+tseg('s-b','BASIC')+tseg('s-p','PRO')+tseg('s-u','ULTRA')+'</div>'):'')+'<div class="tleg">'+tleg+'</div><div class="paidnote">Pago (PRO+ULTRA): <b>'+paidPct+'%</b> · gratis: <b>'+(100-paidPct)+'%</b></div>';
  // ranking usuarios
  var uc={};sc.forEach(function(e){var u=e.user||'—';uc[u]=(uc[u]||0)+1;});
  var uarr=Object.keys(uc).map(function(u){return{u:u,n:uc[u]};}).sort(function(a,b){return b.n-a.n;}).slice(0,8),umax=uarr.length?uarr[0].n:1;
  document.getElementById('userRank').innerHTML=uarr.length?uarr.map(function(x){var op=x.u.indexOf('operador')===0,sh=x.u.length>22?x.u.slice(0,20)+'…':x.u;return '<div class="rbar"><span class="fn" title="'+esc(x.u)+'">'+esc(sh)+'</span><div class="ft"><div class="ff'+(op?' op':'')+'" style="width:'+Math.max(14,x.n/umax*100)+'%">'+x.n+'</div></div><span class="rmeta">'+Math.round(x.n/total*100)+'%</span></div>';}).join(''):'<div class="fempty" style="color:var(--faint)">Sin registros.</div>';
  // heatmap día × hora
  var g=[];for(var d=0;d<7;d++){g[d]=[];for(var h=0;h<24;h++)g[d][h]=0;}
  sc.forEach(function(e){var dt=new Date(e.ts);g[dt.getDay()][dt.getHours()]++;});
  var hmx=1;for(var d2=0;d2<7;d2++)for(var h2=0;h2<24;h2++)hmx=Math.max(hmx,g[d2][h2]);
  var order=[[1,'Lun'],[2,'Mar'],[3,'Mié'],[4,'Jue'],[5,'Vie'],[6,'Sáb'],[0,'Dom']];
  var hh='<div class="hh"></div>';for(var hc=0;hc<24;hc++)hh+='<div class="hh">'+(hc%3===0?hc:'')+'</div>';
  var pk=0,pkL='';
  order.forEach(function(o){hh+='<div class="hlb">'+o[1]+'</div>';for(var c=0;c<24;c++){var n=g[o[0]][c];if(n>pk){pk=n;pkL=o[1]+' '+c+':00';}var it=n/hmx;hh+='<div class="hcell'+(n===hmx&&n>0?' pk':'')+'" title="'+o[1]+' '+c+':00 · '+n+'" style="background:rgba(30,58,138,'+(n?(0.12+it*0.72).toFixed(2):'0')+')"></div>';}});
  document.getElementById('heat').innerHTML=hh;
  document.getElementById('heatPeak').textContent=pk>0?('pico '+pkL+' · '+pk):'';
  document.getElementById('heatLeg').innerHTML='<span style="font-size:11px;color:var(--faint)">menos</span>'+[0,.25,.5,.75,1].map(function(it){return '<span class="hsw" style="background:rgba(30,58,138,'+(0.12+it*0.72).toFixed(2)+')"></span>';}).join('')+'<span style="font-size:11px;color:var(--faint)">más</span>';
  // conversión BASIC → pago
  var basics=sc.filter(function(e){return e.tier==='BASIC';}),conv=basics.filter(function(e){return e.conv;});
  var crate=basics.length?Math.round(conv.length/basics.length*100):0,cw=basics.length?Math.max(6,conv.length/basics.length*100):0;
  var avgD=conv.length?(conv.reduce(function(a,e){return a+(e.convDelay||0);},0)/conv.length/DAYms):0;
  document.getElementById('convBox').innerHTML='<div class="convtop"><div class="convpct">'+crate+'%</div><div class="convsub">de las consultas <b>BASIC</b> (gratis) pagaron luego un PRO/ULTRA de la misma placa</div></div>'+
    '<div class="funnel"><div class="fstage"><span class="fst-l">BASIC gratis</span><div class="fst-bar"><div class="fst-fill base" style="width:100%">'+basics.length+'</div></div></div><div class="fstage"><span class="fst-l">Convirtieron</span><div class="fst-bar"><div class="fst-fill conv" style="width:'+cw+'%">'+conv.length+'</div></div></div></div>'+
    (conv.length?('<div class="paidnote">Convierten en <b>~'+avgD.toFixed(1)+' días</b> prom.</div>'):'<div class="paidnote">Sin conversiones en el ámbito.</div>');
  // registros del ámbito
  var recs=sc.slice().sort(function(a,b){return b.ts-a.ts;}),cap=80;
  document.getElementById('recCount').textContent='· '+recs.length+' reporte(s)';
  var rb=document.getElementById('recBody');
  rb.innerHTML=recs.length?recs.slice(0,cap).map(function(e){var fl=(e.fails&&e.fails.length)?e.fails.map(function(s){return '<span class="fchip">'+esc(s)+'</span>';}).join(''):'<span class="cchip">limpio</span>';var m=Math.floor(e.dur/60);
    return '<tr><td><span class="meta" style="font-family:ui-monospace,monospace">'+mfDT(e.ts)+'</span></td><td><b style="font:700 12px ui-monospace,monospace">'+esc(e.placa)+'</b></td><td>'+otier(e.tier)+'</td><td>'+oorigen(e.origin)+'</td><td>'+pestado(e.estado)+'</td><td>'+fl+'</td><td><span style="font:600 12px ui-monospace,monospace;color:#0C6F64">'+(e.dur?((m?m+'m ':'')+(e.dur%60)+'s'):'—')+'</span></td></tr>';}).join(''):'<tr><td colspan="7" style="color:#64748B;padding:20px;text-align:center">Sin reportes en el ámbito.</td></tr>';
  document.getElementById('recNote').innerHTML=recs.length>cap?'<span style="margin-left:auto">mostrando '+cap+' de '+recs.length+' (más recientes)</span>':'';
}
showTab('hist');loadEngine();loadHistory();loadAutoSources();setInterval(loadEngine,3000);setInterval(loadHistory,6000);
</script></body></html>`;
