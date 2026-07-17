/* eslint-disable no-console */
import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCaptchaSolver, type CaptchaSolver } from '../captcha/index.js';
import { scrapeSunarpViaCdp } from './cdp-sunarp.js';
import { scrapeAtuViaCdp } from './atu-cdp.js';
import { scrapeSigmViaCdp } from './sigm-cdp.js';
import { runHistorialRegistral } from './historial.js';
import { runHistorialPool, runHistorialPoolLive, type HistorialResult } from './historial-pool.js';
import { runLightLane } from './source-lane.js';
import type { Lane } from './batch.js';
import type { PipelineLane } from './pipeline.js';
import { AsyncQueue } from './async-queue.js';
import { killEngineChrome } from './chrome-path.js';
import { superbidLookup, metaGet } from '../db/repo.js';
import { peruStamp } from './time.js';
import { sprlSlots } from './sprl-slots.js';
import {
  runSatCaptura,
  runCallao,
  runMtcCitv,
  runApeseg,
  runSatPapeletas,
  runSbs,
  runFiseGnv,
  runInfogas,
  isGasVehicle,
  type OperatorSourceResult,
} from './sources.js';

export type { OperatorSourceResult, OperatorStatus } from './sources.js';

type Runner = (p: Page, plate: string, solver: CaptchaSolver, shot: string) => Promise<OperatorSourceResult>;

/** Registro de fuentes (navegador normal). SUNARP va aparte (stealth). */
const SOURCE_RUNNERS: Record<string, Runner> = {
  'sat-captura': runSatCaptura,
  'sat-papeletas': runSatPapeletas,
  'callao-papeletas': runCallao,
  'mtc-citv': runMtcCitv,
  'sbs-soat': runSbs,
  'apeseg-soat': runApeseg, // SOAT en TIEMPO REAL (API JSON de APESEG); la SBS está congelada en may-2024
  'fise-gnv': runFiseGnv, // deuda del crédito de conversión GNV (FISE, reCAPTCHA v3 → API JSON)
  'infogas-gnv': runInfogas, // estado GNV + ¿tiene crédito? (Infogas, reCAPTCHA v2). ⚠ Cloudflare delante
  // 'atu' NO va aquí: corre por CDP (Chrome real + reCAPTCHA v3 nativo) vía runAtuSource.
};

/** Fuentes que corren por defecto en la ráfaga del operador. */
// 'atu' fuera del default (su reCAPTCHA v3 rechaza por score; ver riesgos). Queda on-demand.
export const DEFAULT_SOURCES = ['sat-captura', 'sat-papeletas', 'callao-papeletas', 'mtc-citv', 'sbs-soat'];

/** Catálogo para la UI (id + etiqueta). */
export const OPERATOR_SOURCES: Array<{ id: string; label: string; default: boolean }> = [
  { id: 'sat-captura', label: 'SAT Lima · Orden de captura', default: true },
  { id: 'sat-papeletas', label: 'SAT Lima · Papeletas', default: true },
  { id: 'callao-papeletas', label: 'Callao · Papeletas', default: true },
  { id: 'mtc-citv', label: 'MTC · Revisión técnica (CITV)', default: true },
  { id: 'sbs-soat', label: 'SBS · siniestralidad + CAT taxis (SOAT congelado may-2024)', default: true },
  { id: 'apeseg-soat', label: 'APESEG · SOAT vigente (tiempo real)', default: true },
  { id: 'atu', label: 'ATU · Taxi/transporte (Lima/Callao)', default: true },
  { id: 'sigm', label: 'SIGM · Gravámenes / garantías mobiliarias (CDP)', default: true },
  { id: 'fise-gnv', label: 'FISE · Deuda del crédito de conversión GNV', default: false },
  { id: 'infogas-gnv', label: 'Infogas · Estado GNV / ¿tiene crédito? (⚠ Cloudflare)', default: false },
  { id: 'sunarp', label: 'SUNARP · Identidad y titular (CDP · Chrome)', default: false },
  { id: 'historial', label: 'SPRL+Síguelo · Historial, precios y banderas (CDP)', default: false },
  { id: 'superbid', label: 'Superbid · ¿en subasta? (siniestro/remate, experimental)', default: false },
];

export interface OperatorReportOptions {
  outDir: string;
  captchaProvider?: string;
  captchaApiKey: string;
  /** Lista de fuentes a correr; por defecto DEFAULT_SOURCES (+ 'sunarp' si lo agregas). */
  sources?: string[];
  headless?: boolean;
  timeoutMs?: number;
  /** SUNARP CDP: más margen para que el operador resuelva el Turnstile a mano. */
  manualSunarp?: boolean;
}

export interface OperatorReport {
  plate: string;
  generatedAt: string;
  results: OperatorSourceResult[];
}

function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

async function withPage<T>(ctx: BrowserContext, fn: (p: Page) => Promise<T>): Promise<T> {
  const page = await ctx.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

/** Log POR FUENTE: cada módulo escribe su propio `<id>.log` en el outDir. */
function startLog(outDir: string, id: string, plate: string): void {
  try { writeFileSync(join(outDir, `${id}.log`), `${peruStamp()} INICIO ${id} · placa=${plate}\n`, 'utf8'); } catch { /* noop */ }
}
function logLine(outDir: string, id: string, msg: string): void {
  try { appendFileSync(join(outDir, `${id}.log`), `${peruStamp()} ${msg}\n`); } catch { /* noop */ }
}
/** Línea RESULTADO con el captcha que insertó el OCR (para validar lecturas). */
function resultLog(r: OperatorSourceResult): string {
  const cap = (r.data as Record<string, unknown> | undefined)?.captcha;
  return `RESULTADO ${r.status} · ${r.summary}${cap ? ` · captcha="${String(cap)}"` : ''} · ${r.ms}ms`;
}

/**
 * Orquestador del reporte del operador: corre las fuentes pedidas por placa en
 * paralelo (captcha imagen + reCAPTCHA vía CapSolver) desde el navegador local
 * (IP residencial) y devuelve resultados consolidados + screenshots.
 *
 * El historial de propietarios (SPRL) NO va aquí: lo pega el operador manualmente.
 */
export async function runOperatorReport(
  plateRaw: string,
  opts: OperatorReportOptions,
): Promise<OperatorReport> {
  const plate = normalizePlate(plateRaw);
  const generatedAt = new Date().toISOString();
  mkdirSync(opts.outDir, { recursive: true });
  const solver = createCaptchaSolver({ provider: opts.captchaProvider ?? 'capsolver', apiKey: opts.captchaApiKey });
  const shot = (id: string) => join(opts.outDir, `${id}.png`);
  const wanted = (opts.sources ?? DEFAULT_SOURCES).slice();
  const wantSunarp = wanted.includes('sunarp');
  const wantHistorial = wanted.includes('historial');
  const wantSuperbid = wanted.includes('superbid');
  // 'atu' va por CDP (Chrome real, reCAPTCHA v3 nativo), NO por el burst headless de Playwright.
  const wantAtu = wanted.includes('atu');
  const wantSigm = wanted.includes('sigm');
  const browserSources = wanted.filter((s) => !['sunarp', 'historial', 'superbid', 'atu', 'sigm'].includes(s) && SOURCE_RUNNERS[s]);

  let results: OperatorSourceResult[] = [];
  // Solo lanzamos el Chromium "burst" (Playwright bundled, headless) si hay fuentes
  // que lo usan; las fuentes CDP (sunarp/historial/superbid) abren su propio Chrome real.
  if (browserSources.length > 0) {
    const browser = await chromium.launch({ headless: opts.headless ?? true });
    try {
      const ctx = await browser.newContext({ locale: 'es-PE' });
      const settled = await Promise.allSettled(
        browserSources.map((id) => {
          startLog(opts.outDir, id, plate);
          return withPage(ctx, (p) => SOURCE_RUNNERS[id]!(p, plate, solver, shot(id)))
            .then((r) => { logLine(opts.outDir, id, resultLog(r)); return r; })
            .catch((e) => { logLine(opts.outDir, id, `ERROR ${(e as Error).message}`); throw e; });
        }),
      );
      results = settled.map((s, i) =>
        s.status === 'fulfilled'
          ? s.value
          : { source: browserSources[i] ?? `SRC_${i}`, label: browserSources[i] ?? 'Fuente', category: 'OTRO', status: 'ERROR' as const, summary: String(s.reason), ms: 0 },
      );
    } finally {
      await browser.close().catch(() => {});
    }
  }

  if (wantSunarp) results.push(await runSunarpSource(plate, solver, shot('sunarp'), opts));
  if (wantAtu) results.push(await runAtuSource(plate, shot('atu'), opts));
  if (wantSigm) results.push(await runSigmSource(plate, shot('sigm'), opts));
  if (wantHistorial) results.push(await runHistorialSource(plate, shot('historial'), opts));
  if (wantSuperbid) results.push(await runSuperbidSource(plate, shot('superbid'), opts));

  const report: OperatorReport = { plate, generatedAt, results };
  writeFileSync(join(opts.outDir, 'reporte.json'), JSON.stringify(report, null, 2), 'utf8');
  killEngineChrome(); // libera RAM en el VPS (no-op en la PC del operador)
  return report;
}

/** Corre UNA sola fuente (reintento desde la consola). */
export async function runSingleSource(
  plateRaw: string,
  sourceId: string,
  opts: OperatorReportOptions,
): Promise<OperatorSourceResult> {
  const plate = normalizePlate(plateRaw);
  mkdirSync(opts.outDir, { recursive: true });
  const solver = createCaptchaSolver({ provider: opts.captchaProvider ?? 'capsolver', apiKey: opts.captchaApiKey });
  const shot = join(opts.outDir, `${sourceId}.png`);
  startLog(opts.outDir, sourceId, plate);
  if (sourceId === 'sunarp') return await runSunarpSource(plate, solver, shot, opts);
  if (sourceId === 'atu') return await runAtuSource(plate, shot, opts);
  if (sourceId === 'sigm') return await runSigmSource(plate, shot, opts);
  if (sourceId === 'historial') return await runHistorialSource(plate, shot, opts);
  if (sourceId === 'superbid') return await runSuperbidSource(plate, shot, opts);
  const runner = SOURCE_RUNNERS[sourceId];
  if (!runner) throw new Error(`Fuente desconocida: ${sourceId}`);
  // El Chrome del motor se libera al FINAL del job (runJob/runOperatorReport), NO por
  // fuente: así no se mata el Chrome de las fuentes que corren en paralelo.
  const browser = await chromium.launch({ headless: opts.headless ?? true });
  try {
    const ctx = await browser.newContext({ locale: 'es-PE' });
    const r = await withPage(ctx, (p) => runner(p, plate, solver, shot));
    logLine(opts.outDir, sourceId, resultLog(r));
    return r;
  } catch (e) {
    logLine(opts.outDir, sourceId, `ERROR ${(e as Error).message}`);
    throw e;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runSunarpSource(
  plate: string,
  _captcha: CaptchaSolver,
  shotPath: string,
  opts: OperatorReportOptions,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'SUNARP', label: 'SUNARP · Identidad y titular', category: 'REGISTRAL' };
  const outDir = shotPath.replace(/[/\\][^/\\]+$/, '');
  startLog(outDir, 'sunarp', plate);
  logLine(outDir, 'sunarp', 'CDP híbrido (Chrome limpio + Turnstile pasivo)');
  try {
    const r = await scrapeSunarpViaCdp(plate, {
      shotPath,
      // Modo manual: más margen para que el operador resuelva y SIN auto-recargas
      // (recargar reiniciaría el Turnstile que está resolviendo a mano).
      ...(opts.manualSunarp ? { dataWaitMs: 300000, passiveReloads: 0 } : {}),
      log: (m) => logLine(outDir, 'sunarp', m),
    });
    if (r.ok) {
      const owner = r.ownerName ? ` · ${r.ownerName}` : '';
      logLine(outDir, 'sunarp', `RESULTADO ENCONTRADO${owner} · ${Date.now() - t0}ms`);
      return { ...base, status: 'ENCONTRADO', summary: `Datos registrales obtenidos${owner}`, data: r.data, screenshot: shotPath, ms: Date.now() - t0 };
    }
    logLine(outDir, 'sunarp', `ERROR ${r.error ?? 'no disponible'}`);
    return { ...base, status: 'ERROR', summary: r.error ?? 'SUNARP no disponible', ms: Date.now() - t0 };
  } catch (e) {
    logLine(outDir, 'sunarp', `ERROR ${(e as Error).message}`);
    return { ...base, status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
  }
}

/**
 * ATU (uso taxi/transporte) por CDP: Chrome real + reCAPTCHA v3 NATIVO (sin CapSolver).
 * Va aparte de la ráfaga headless porque el v3 puntúa el navegador/IP; solo pasa desde
 * un Chrome real en IP residencial. Devuelve `source: 'ATU'` → report-transform lo mapea
 * a la sección TRANSPORTE.
 */
async function runAtuSource(
  plate: string,
  shotPath: string,
  _opts: OperatorReportOptions,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'ATU', label: 'ATU · Taxi/transporte (CDP)', category: 'TRANSPORTE' };
  const outDir = shotPath.replace(/[/\\][^/\\]+$/, '');
  startLog(outDir, 'atu', plate);
  logLine(outDir, 'atu', 'CDP híbrido (Chrome real + reCAPTCHA v3 nativo)');
  try {
    const r = await scrapeAtuViaCdp(plate, { shotPath, log: (m) => logLine(outDir, 'atu', m) });
    const d = (r.data ?? {}) as Record<string, unknown>;
    if (r.ok) {
      const summary = d.isPublicTransport ? `Habilitado: ${(d.modalidad as string) ?? 'transporte'}` : 'No figura como taxi/transporte';
      logLine(outDir, 'atu', `RESULTADO ${r.status} · ${summary} · ${Date.now() - t0}ms`);
      return { ...base, status: r.status, summary, data: r.data, screenshot: shotPath, ms: Date.now() - t0 };
    }
    logLine(outDir, 'atu', `ERROR ${r.error ?? 'no disponible'}`);
    return { ...base, status: 'ERROR', summary: r.error ?? 'ATU no disponible', ms: Date.now() - t0 };
  } catch (e) {
    logLine(outDir, 'atu', `ERROR ${(e as Error).message}`);
    return { ...base, status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
  }
}

/**
 * SIGM (garantías mobiliarias / gravámenes) por CDP: Turnstile pasivo + consulta "Por Bien"→Placa,
 * captura y descifra /gratuita/busqueda. Devuelve `source: 'SIGM'` → report-transform lo mapea a
 * GRAVAMENES (reemplaza el heurístico de asientos cuando está disponible).
 */
async function runSigmSource(
  plate: string,
  shotPath: string,
  _opts: OperatorReportOptions,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'SIGM', label: 'SIGM · Gravámenes / garantías mobiliarias', category: 'REGISTRAL' };
  const outDir = shotPath.replace(/[/\\][^/\\]+$/, '');
  startLog(outDir, 'sigm', plate);
  logLine(outDir, 'sigm', 'CDP híbrido (Turnstile pasivo) → /gratuita/busqueda (AES)');
  try {
    const r = await scrapeSigmViaCdp(plate, { shotPath, log: (m) => logLine(outDir, 'sigm', m) });
    if (r.ok) {
      const n = r.data?.total ?? 0;
      const summary = n > 0 ? `${n} garantía(s) mobiliaria(s) vigente(s)` : 'Sin garantías mobiliarias vigentes';
      logLine(outDir, 'sigm', `RESULTADO ${r.status} · ${summary} · ${Date.now() - t0}ms`);
      return { ...base, status: r.status, summary, data: r.data, screenshot: shotPath, ms: Date.now() - t0 };
    }
    logLine(outDir, 'sigm', `ERROR ${r.error ?? 'no disponible'}`);
    return { ...base, status: 'ERROR', summary: r.error ?? 'SIGM no disponible', ms: Date.now() - t0 };
  } catch (e) {
    logLine(outDir, 'sigm', `ERROR ${(e as Error).message}`);
    return { ...base, status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
  }
}

/**
 * Historial registral completo: SUNARP (sede) → SPRL (login auto + asientos) →
 * Síguelo (precio por título) → línea de tiempo + banderas (aseguradora/remate).
 * Usa CDP + creds SPRL del entorno (SPRL_USER/SPRL_PASS). Va aparte de la ráfaga.
 */
async function runHistorialSource(
  plate: string,
  shotPath: string,
  _opts: OperatorReportOptions,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'HISTORIAL', label: 'SPRL+Síguelo · Historial registral', category: 'REGISTRAL' };
  const outDir = shotPath.replace(/[/\\][^/\\]+$/, '');
  startLog(outDir, 'historial', plate);
  logLine(outDir, 'historial', 'SUNARP→SPRL→Síguelo (CDP)');
  try {
    // Slots de cuenta SPRL con FAILOVER: si SUNARP bloquea la cuenta por IP (lockout),
    // reintenta con la siguiente cuenta (perfil/puerto propios). Otros errores NO hacen
    // failover (cambiar de cuenta no los arregla y gastaría tiempo/logins).
    const slots = sprlSlots();
    const parallel = process.env.HISTORIAL_PARALLEL === '1';
    let r: Awaited<ReturnType<typeof runHistorialRegistral>> | null = null;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]!;
      if (i > 0) logLine(outDir, 'historial', `failover → cuenta ${s.index} (slot bloqueado por IP)`);
      r = await runHistorialRegistral(plate, {
        shotPath, parallel, log: (m) => logLine(outDir, 'historial', m),
        sprlUser: s.user, sprlPass: s.pass, port: s.port, profile: s.profile,
      });
      if (r.ok || !r.locked) break; // éxito, o error no recuperable por failover
    }
    if (!r) { // sin slots configurados (dev sin env) → una corrida con defaults del entorno
      r = await runHistorialRegistral(plate, { shotPath, parallel, log: (m) => logLine(outDir, 'historial', m) });
    }
    if (r.ok) {
      const flagTxt = [r.flags.aseguradora && 'ASEGURADORA', r.flags.remate && 'REMATE', r.flags.financiera && 'FINANCIERA', r.flags.gravamen && 'GRAVAMEN', r.flags.embargo && 'EMBARGO'].filter(Boolean).join('/');
      const summary = `${r.timeline.length} asientos · ${r.titulos.length} títulos${flagTxt ? ` · ⚠ ${flagTxt}` : ' · sin banderas'}`;
      logLine(outDir, 'historial', `RESULTADO ${summary} · ${Date.now() - t0}ms`);
      return { ...base, status: 'ENCONTRADO', summary, data: { sede: r.sede, titulos: r.titulos, flags: r.flags, timeline: r.timeline, vehiculo: r.vehiculo, caracteristicas: r.caracteristicas }, screenshot: shotPath, ms: Date.now() - t0 };
    }
    logLine(outDir, 'historial', `ERROR ${r.error ?? 'sin asientos'}`);
    return { ...base, status: 'ERROR', summary: r.error ?? 'No se obtuvo historial', ms: Date.now() - t0 };
  } catch (e) {
    logLine(outDir, 'historial', `ERROR ${(e as Error).message}`);
    return { ...base, status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
  }
}

/**
 * Superbid: ¿la placa está/estuvo en una subasta (siniestro/remate)? Señal LEADING
 * (aparece antes que SUNARP). Hace un SUNARP rápido para marca/modelo/año (narrow) y
 * busca el anexo `<PLACA>.pdf`. EXPERIMENTAL — opt-in, requiere validación en vivo.
 */
/**
 * Convierte el resultado del historial (runHistorialRegistral / pool) en OperatorSourceResult
 * — MISMA forma que produce runHistorialSource. Lo usa el carril de historial del lote.
 */
export function mapHistorial(r: HistorialResult, ms: number, shotPath?: string): OperatorSourceResult {
  const base = { source: 'HISTORIAL', label: 'SPRL+Síguelo · Historial registral', category: 'REGISTRAL' };
  if (r.ok) {
    const flagTxt = [r.flags.aseguradora && 'ASEGURADORA', r.flags.remate && 'REMATE', r.flags.financiera && 'FINANCIERA', r.flags.gravamen && 'GRAVAMEN', r.flags.embargo && 'EMBARGO'].filter(Boolean).join('/');
    const summary = `${r.timeline.length} asientos · ${r.titulos.length} títulos${flagTxt ? ` · ⚠ ${flagTxt}` : ' · sin banderas'}`;
    return { ...base, status: 'ENCONTRADO', summary, data: { sede: r.sede, titulos: r.titulos, flags: r.flags, timeline: r.timeline, vehiculo: r.vehiculo, caracteristicas: r.caracteristicas }, ...(shotPath ? { screenshot: shotPath } : {}), ms };
  }
  return { ...base, status: 'ERROR', summary: r.error ?? 'No se obtuvo historial', ms };
}

export interface BatchLaneOpts {
  captchaApiKey: string;
  captchaProvider?: string;
  headless?: boolean;
}

/**
 * Arma los CARRILES del lote (para orchestrateBatch) cableando los runners reales: historial
 * en 2 hilos SPRL (runHistorialPool), cada fuente ligera transpuesta (runLightLane, reúso de
 * navegador) y sunarp/atu/superbid por placa. La UNIÓN de fuentes cubre BASIC y PRO/ULTRA; el
 * orquestador corre cada carril SOLO sobre las placas cuyo tier incluye esa fuente.
 */
export function buildBatchLanes(opts: BatchLaneOpts): Array<{ sources: string[]; run: Lane }> {
  const baseOpts = (outDir: string): OperatorReportOptions => ({ outDir, captchaProvider: opts.captchaProvider, captchaApiKey: opts.captchaApiKey, headless: opts.headless ?? true });
  const solver = (): CaptchaSolver => createCaptchaSolver({ provider: opts.captchaProvider ?? 'capsolver', apiKey: opts.captchaApiKey });
  const lanes: Array<{ sources: string[]; run: Lane }> = [];

  // Historial: 2 hilos SPRL (1 login por cuenta, reúso de sesión entre placas).
  lanes.push({ sources: ['historial'], run: async (plates, report) => {
    const outBy = new Map(plates.map((p) => [p.plate, p.outDir]));
    await runHistorialPool(plates.map((p) => p.plate), {
      onResult: (pr) => report(pr.plate, mapHistorial(pr.result, pr.ms, join(outBy.get(pr.plate) ?? '', 'historial.png'))),
    });
  } });

  // Fuentes ligeras: un carril por fuente, transpuesto (1 navegador barre las N placas).
  for (const id of Object.keys(SOURCE_RUNNERS)) {
    lanes.push({ sources: [id], run: async (plates, report) => {
      await runLightLane(id, SOURCE_RUNNERS[id]!, plates.map((p) => ({ plate: p.plate, outDir: p.outDir })), {
        captchaApiKey: opts.captchaApiKey, captchaProvider: opts.captchaProvider, headless: opts.headless ?? true,
        onResult: (lr) => report(lr.plate, lr.result),
      });
    } });
  }

  // SUNARP: por placa (CDP; KEEP_SUNARP_WARM reusa la sesión caliente entre placas).
  lanes.push({ sources: ['sunarp'], run: async (plates, report) => {
    const s = solver();
    for (const p of plates) report(p.plate, await runSunarpSource(p.plate, s, join(p.outDir, 'sunarp.png'), baseOpts(p.outDir)));
  } });
  // ATU: por placa (CDP reCAPTCHA v3 nativo).
  lanes.push({ sources: ['atu'], run: async (plates, report) => {
    for (const p of plates) report(p.plate, await runAtuSource(p.plate, join(p.outDir, 'atu.png'), baseOpts(p.outDir)));
  } });
  // SIGM: por placa (CDP Turnstile pasivo → /gratuita/busqueda descifrado).
  lanes.push({ sources: ['sigm'], run: async (plates, report) => {
    for (const p of plates) report(p.plate, await runSigmSource(p.plate, join(p.outDir, 'sigm.png'), baseOpts(p.outDir)));
  } });
  // Superbid: lookup en DB (instantáneo).
  lanes.push({ sources: ['superbid'], run: async (plates, report) => {
    for (const p of plates) report(p.plate, await runSuperbidSource(p.plate, join(p.outDir, 'superbid.png'), baseOpts(p.outDir)));
  } });

  return lanes;
}

/** Todas las fuentes NO-historial (las que corre el carril ligero del motor continuo). */
const NON_HISTORIAL_SOURCES = [
  'sunarp', 'superbid', 'sat-captura', 'sat-papeletas', 'callao-papeletas',
  'mtc-citv', 'apeseg-soat', 'sbs-soat', 'atu', 'sigm', 'fise-gnv', 'infogas-gnv',
];

export interface ContinuousLaneOpts extends BatchLaneOpts {
  /** Workers del carril ligero (placas NO-historial en paralelo). Tope de RAM/CPU. Default 2. */
  lightConcurrency?: number;
}

/**
 * Carriles del MOTOR CONTINUO (para `Pipeline`). Dos carriles de vida larga, cada uno con su propio
 * canal (lo llena el dispatcher en caliente):
 *  - **historial**: pool persistente de 2 workers SPRL (sesión caliente reusada TODO el turno) que
 *    jalan placas del canal — la parte lenta, desacoplada, sin frontera de lote.
 *  - **ligero**: K workers que, por placa, corren TODAS sus fuentes no-historial (SUNARP/SAT/MTC/…)
 *    vía `runSingleSource`, con tope de concurrencia por RAM.
 * A diferencia de `buildBatchLanes` (un carril por fuente sobre un conjunto FIJO), estos carriles no
 * terminan: viven mientras el canal siga abierto y admiten placas nuevas continuamente.
 */
export function buildContinuousLanes(opts: ContinuousLaneOpts): PipelineLane[] {
  const baseOpts = (outDir: string): OperatorReportOptions => ({ outDir, captchaProvider: opts.captchaProvider, captchaApiKey: opts.captchaApiKey, headless: opts.headless ?? true });
  const K = Math.max(1, opts.lightConcurrency ?? 2);

  // ── Gate GNV: FISE/Infogas SOLO deben correr si el vehículo es a gas (el combustible sale de la
  // característica del asiento SPRL). Como historial y carril ligero corren EN PARALELO, el ligero
  // ESPERA esta señal antes de gastar captcha. El carril historial la resuelve al terminar; para
  // placas sin 'historial' en el pedido (o si el SPRL falla → fuel null), la señal resuelve y GNV se
  // SALTA (no se puede confirmar gas). Bounded por la vida del motor (se limpia en cada deploy/reinicio).
  const GNV_SOURCES = new Set(['fise-gnv', 'infogas-gnv']);
  const fuelWaiters = new Map<string, { promise: Promise<string | null>; resolve: (f: string | null) => void }>();
  const fuelSignal = (plate: string) => {
    let w = fuelWaiters.get(plate);
    if (!w) {
      let resolve!: (f: string | null) => void;
      const promise = new Promise<string | null>((r) => { resolve = r; });
      w = { promise, resolve };
      fuelWaiters.set(plate, w);
    }
    return w;
  };
  const resolveFuel = (plate: string, fuel: string | null): void => fuelSignal(plate).resolve(fuel);

  // Carril historial: pool continuo de 2 hilos SPRL sobre el canal del pipeline.
  const outByPlate = new Map<string, string>();
  const historialLane: PipelineLane = {
    sources: ['historial'],
    run: async (take, report) => {
      await runHistorialPoolLive(async () => {
        const it = await take();
        if (it) { outByPlate.set(it.plate, it.outDir); startLog(it.outDir, 'historial', it.plate); } // crea historial.log
        return it ? { plate: it.plate, outDir: it.outDir } : null;
      }, {
        // Default 1: 1 historial a la vez sobre el slot caliente + failover (evita el cold-login de la
        // 2ª cuenta en cada pedido → lockout). Sube HISTORIAL_CONCURRENCY solo si cada cuenta tiene keep-alive.
        concurrency: Math.max(1, Number(process.env.HISTORIAL_CONCURRENCY ?? 1)),
        onLog: (task, m) => logLine(task.outDir ?? '', 'historial', m), // logs en vivo por placa (los perdía el motor continuo)
        onResult: (pr) => {
          resolveFuel(pr.plate, pr.result?.caracteristicas?.fuel ?? null); // libera el gate GNV
          report(pr.plate, mapHistorial(pr.result, pr.ms, join(outByPlate.get(pr.plate) ?? '', 'historial.png')));
        },
      });
    },
  };

  // Carril ligero: POOL DE TAREAS en PARALELO. Cada placa se EXPANDE en tareas por-fuente (todas sus
  // fuentes NO-historial) que van a una cola interna; K workers globales las jalan y corren EN PARALELO
  // → las fuentes de una misma placa NO se serializan (antes sí, y eso disparaba tiempos de 12 min y que
  // los reintentos de una fuente fallida bloquearan al resto). El historial corre aparte en su pool,
  // arrancando de inmediato. K acota la RAM/CPU global (no por placa). Un error de fuente no tumba al resto.
  const lightLane: PipelineLane = {
    sources: NON_HISTORIAL_SOURCES,
    run: async (take, report) => {
      const taskQ = new AsyncQueue<{ plate: string; src: string; outDir: string }>();
      // Alimentador: por cada placa que llega, encola una tarea por cada fuente no-historial del pedido.
      const feeder = (async (): Promise<void> => {
        for (;;) {
          const it = await take();
          if (!it) { taskQ.close(); break; }
          // Sin 'historial' en el pedido no hay señal de combustible → resolvemos null (GNV se saltará).
          if (!it.sources.includes('historial')) resolveFuel(it.plate, null);
          for (const src of it.sources.filter((s) => s !== 'historial')) taskQ.push({ plate: it.plate, src, outDir: it.outDir });
        }
      })();
      // Pool de K workers: corren fuentes de CUALQUIER placa en paralelo (reparto natural del trabajo).
      const worker = async (): Promise<void> => {
        for (;;) {
          const t = await taskQ.take();
          if (!t) break;
          try {
            // Gate GNV: espera la señal de combustible del SPRL (tope 8 min) y salta si NO es a gas —
            // así no se gasta captcha en un vehículo que no aplica (FISE/Infogas son solo para GNV).
            if (GNV_SOURCES.has(t.src)) {
              const fuel = await Promise.race([
                fuelSignal(t.plate).promise,
                new Promise<string | null>((r) => { setTimeout(() => r(null), 8 * 60 * 1000); }),
              ]);
              if (!isGasVehicle(fuel)) {
                report(t.plate, { source: t.src.toUpperCase().replace(/-/g, '_'), label: t.src, category: 'GNV', status: 'SIN_REGISTRO', summary: fuel ? `No aplica: el vehículo no es a gas (SPRL: ${fuel})` : 'No aplica: no se confirmó combustible a gas (SPRL)', ms: 0 });
                continue;
              }
            }
            report(t.plate, await runSingleSource(t.plate, t.src, baseOpts(t.outDir)));
          } catch (e) { report(t.plate, { source: t.src.toUpperCase(), label: t.src, category: 'OTRO', status: 'ERROR', summary: (e as Error).message, ms: 0 }); }
        }
      };
      await Promise.all([feeder, ...Array.from({ length: K }, worker)]);
    },
  };

  return [historialLane, lightLane];
}

async function runSuperbidSource(
  plate: string,
  shotPath: string,
  _opts: OperatorReportOptions,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'SUPERBID', label: 'Superbid · Subastas (siniestro/remate)', category: 'SINIESTRO' };
  const outDir = shotPath.replace(/[/\\][^/\\]+$/, '');
  startLog(outDir, 'superbid', plate);
  try {
    // Lookup INSTANTÁNEO en el índice multi-fuente (DB) poblado por los scans (Superbid/VMC, job diario).
    const hit = superbidLookup(plate);
    if (hit) {
      const f = (hit.flags ?? {}) as Record<string, boolean>;
      const tipo = f.siniestro ? 'SINIESTRO' : f.aseguradora ? 'ASEGURADORA (siniestro)' : f.remate ? 'remate/financiera' : 'subasta';
      const estado = hit.estado === 'cerrada' ? 'cerrada' : 'abierta';
      const fuente = (hit.fuente ?? 'superbid').toUpperCase();
      logLine(outDir, 'superbid', `MATCH índice [${fuente}]: ${hit.subasta ?? ''} · ${tipo} · ${estado} · ${Date.now() - t0}ms`);
      return { ...base, status: 'ENCONTRADO', summary: `⚠ EN SUBASTA [${fuente}]: ${hit.subasta ?? ''} (${tipo}, ${estado})`, data: { ...hit }, ms: Date.now() - t0 };
    }
    const upd = metaGet<string>('ultimo_scan_at');
    const updVmc = metaGet<string>('vmc_ultimo_scan_at');
    logLine(outDir, 'superbid', `sin match en índice (Superbid ${upd ?? '—'} · VMC ${updVmc ?? '—'}) · ${Date.now() - t0}ms`);
    return { ...base, status: 'SIN_REGISTRO', summary: `No aparece en el índice de subastas (Superbid/VMC)${upd ? `, act. ${upd.slice(0, 10)}` : ''}`, ms: Date.now() - t0 };
  } catch (e) {
    logLine(outDir, 'superbid', `ERROR ${(e as Error).message}`);
    return { ...base, status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
  }
}
