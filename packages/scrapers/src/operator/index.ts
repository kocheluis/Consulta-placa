/* eslint-disable no-console */
import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCaptchaSolver, type CaptchaSolver } from '../captcha/index.js';
import { scrapeSunarpViaCdp } from './cdp-sunarp.js';
import { runHistorialRegistral } from './historial.js';
import { killEngineChrome } from './chrome-path.js';
import { superbidLookup, metaGet } from '../db/repo.js';
import {
  runSatCaptura,
  runCallao,
  runMtcCitv,
  runApeseg,
  runSatPapeletas,
  runSbs,
  runAtu,
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
  'apeseg-soat': runApeseg, // extra/opcional (flaky, redundante con SBS)
  'atu': runAtu, // taxi/transporte (Lima/Callao) — selectores por validar en vivo
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
  { id: 'sbs-soat', label: 'SBS · SOAT y siniestralidad', default: true },
  { id: 'apeseg-soat', label: 'APESEG · SOAT (extra)', default: false },
  { id: 'atu', label: 'ATU · Taxi/transporte (Lima/Callao)', default: true },
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
  try { writeFileSync(join(outDir, `${id}.log`), `${new Date().toISOString()} INICIO ${id} · placa=${plate}\n`, 'utf8'); } catch { /* noop */ }
}
function logLine(outDir: string, id: string, msg: string): void {
  try { appendFileSync(join(outDir, `${id}.log`), `${new Date().toISOString()} ${msg}\n`); } catch { /* noop */ }
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
  const browserSources = wanted.filter((s) => s !== 'sunarp' && s !== 'historial' && s !== 'superbid' && SOURCE_RUNNERS[s]);

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
      ...(opts.manualSunarp ? { dataWaitMs: 300000 } : {}),
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
    const r = await runHistorialRegistral(plate, { shotPath, parallel: process.env.HISTORIAL_PARALLEL === '1', log: (m) => logLine(outDir, 'historial', m) });
    if (r.ok) {
      const flagTxt = [r.flags.aseguradora && 'ASEGURADORA', r.flags.remate && 'REMATE', r.flags.financiera && 'FINANCIERA', r.flags.gravamen && 'GRAVAMEN', r.flags.embargo && 'EMBARGO'].filter(Boolean).join('/');
      const summary = `${r.timeline.length} asientos · ${r.titulos.length} títulos${flagTxt ? ` · ⚠ ${flagTxt}` : ' · sin banderas'}`;
      logLine(outDir, 'historial', `RESULTADO ${summary} · ${Date.now() - t0}ms`);
      return { ...base, status: 'ENCONTRADO', summary, data: { sede: r.sede, titulos: r.titulos, flags: r.flags, timeline: r.timeline, vehiculo: r.vehiculo }, screenshot: shotPath, ms: Date.now() - t0 };
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
