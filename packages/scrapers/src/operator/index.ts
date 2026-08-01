/* eslint-disable no-console */
import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCaptchaSolver, type CaptchaSolver } from '../captcha/index.js';
import { scrapeSunarpViaCdp } from './cdp-sunarp.js';
import { scrapeAtuViaCdp } from './atu-cdp.js';
import { scrapeSigmViaCdp } from './sigm-cdp.js';
import { scrapeInfogasViaCdp } from './infogas-cdp.js';
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
import { parseProxy, proxyForSource, withStickySession, type ProxyConfig } from './proxy.js';
import { sharedForwarderArg } from './proxy-forwarder.js';
import { fiseRelayAlive, runFiseViaRelay } from './fise-relay.js';
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

// Fuentes que SALEN por el proxy residencial (`ENGINE_PROXY`): gate compartido `proxyForSource`
// (proxy.ts; default fise-gnv,infogas-gnv,atu — override con env PROXY_SOURCES). Las demás usan la
// IP del VPS directo (peruana en LightNode → SUNARP/SIGM/SBS/SAT pasan nativo). ATU es CDP: su
// Chrome toma el ENGINE_PROXY vía `--proxy-server` (forwarder local si trae credenciales) en atu-cdp.
const proxyFor = proxyForSource;

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
  // Infogas: Cloudflare bloquea el headless ("Un momento…", validado 30-jul) → Chrome REAL por
  // CDP (:9230) con la misma cadena de egresos de ATU; reusa runInfogas sobre esa página.
  if (sourceId === 'infogas-gnv') {
    const t0 = Date.now();
    const r = await scrapeInfogasViaCdp(plate, solver, shot, (m) => logLine(opts.outDir, sourceId, m));
    logLine(opts.outDir, sourceId, resultLog(r));
    return { ...r, ms: r.ms || Date.now() - t0 };
  }
  // FISE: INALCANZABLE desde el VPS (probado con Chrome real 31-jul-2026: el MINEM filtra la IP
  // datacenter y iProyal rechaza el CONNECT al :23308 por HTTP y SOCKS5) → va por el RELAY
  // RESIDENCIAL (celular Termux con polling, ver fise-relay.ts). Si el celular no late, falla AL
  // INSTANTE en vez de quemar los ~200s de la cadena muerta; la cadena headless queda solo como
  // rescate opt-in con FISE_CHAIN_FALLBACK=1 (por si algún día cambia el bloqueo).
  if (sourceId === 'fise-gnv' && process.env.FISE_CHAIN_FALLBACK !== '1') {
    if (fiseRelayAlive()) {
      const r = await runFiseViaRelay(plate, solver, (m) => logLine(opts.outDir, sourceId, m));
      logLine(opts.outDir, sourceId, resultLog(r));
      return r;
    }
    const r: OperatorSourceResult = { source: 'FISE_GNV', label: 'FISE · Deuda de conversión GNV', category: 'GNV', status: 'ERROR', summary: 'relay residencial (celular) sin señal — FISE bloquea la IP del VPS', ms: 0 };
    logLine(opts.outDir, sourceId, resultLog(r));
    return r;
  }
  // Infogas (y FISE con FISE_CHAIN_FALLBACK=1): CADENA de egresos headless con fallback automático
  // (directo → túnel → SOCKS5 → proxy), el mismo patrón que ATU. Ignora el gate PROXY_SOURCES.
  if (GNV_SOURCES.has(sourceId)) return await runGnvWithEgress(plate, sourceId, runner, solver, shot, opts);
  // El Chrome del motor se libera al FINAL del job (runJob/runOperatorReport), NO por
  // fuente: así no se mata el Chrome de las fuentes que corren en paralelo.
  const proxy = proxyFor(sourceId);
  if (proxy) logLine(opts.outDir, sourceId, `vía proxy residencial ${proxy.server}`);
  const browser = await chromium.launch({ headless: opts.headless ?? true, ...(proxy ? { proxy } : {}) });
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

/**
 * Egresos de red de las fuentes GNV (mismo orden pedido que ATU): 1) DIRECTO con la IP del VPS
 * (gratis; puede pasar — el v3/Cloudflare varían), 2) TÚNEL HTTP local con auth → ENGINE_PROXY,
 * 3) TÚNEL SOCKS5 → mismo upstream (iProyal corta el CONNECT HTTP a puertos raros — FISE usa
 * :23308 — pero su SOCKS5 puede dejarlos pasar; Chromium no habla auth SOCKS5, el forwarder sí),
 * 4) ENGINE_PROXY con auth NATIVA de Playwright. Override del endpoint SOCKS con env
 * `ENGINE_PROXY_SOCKS` (default: mismo host:port con esquema socks5). Se evalúa al llamar.
 */
function gnvEgressChain(): Array<{ label: string; proxy: () => Promise<ProxyConfig | undefined> }> {
  const chain: Array<{ label: string; proxy: () => Promise<ProxyConfig | undefined> }> = [
    { label: 'directo (IP del VPS)', proxy: async () => undefined },
  ];
  const raw = parseProxy(process.env.ENGINE_PROXY);
  // Sticky: fija UNA IP de salida por proceso (sin ella iProyal rota por conexión y el
  // reCAPTCHA/Cloudflare ven IPs distintas dentro de una misma consulta → rechazo).
  const cfg = raw ? withStickySession(raw) : undefined;
  if (cfg?.username) {
    chain.push({ label: `túnel local → ${cfg.server} (sticky)`, proxy: async () => ({ server: `http://${await sharedForwarderArg(cfg)}` }) });
    const socksRaw = parseProxy(process.env.ENGINE_PROXY_SOCKS)
      ?? { ...cfg, server: cfg.server.replace(/^[a-z0-9]+:\/\//i, 'socks5://') };
    const socks = withStickySession(socksRaw);
    chain.push({ label: `túnel SOCKS5 → ${socks.server}`, proxy: async () => ({ server: `http://${await sharedForwarderArg(socks)}` }) });
    chain.push({ label: `proxy ${cfg.server} (auth nativa)`, proxy: async () => cfg });
  } else if (cfg) {
    chain.push({ label: `proxy ${cfg.server} (whitelist)`, proxy: async () => cfg });
  }
  return chain;
}

// Tope por EGRESO (corta cuelgues de captcha/goto dentro de un intento) y presupuesto TOTAL de la
// cadena (no seguir probando egresos si ya se gastó el tiempo de la fuente — SRC_TIMEOUT ≈ 4 min).
const GNV_EGRESS_TIMEOUT_MS = Math.max(30_000, Number(process.env.GNV_EGRESS_TIMEOUT_MS ?? 90_000));
const GNV_CHAIN_BUDGET_MS = Math.max(60_000, Number(process.env.GNV_CHAIN_BUDGET_MS ?? 200_000));

/** Corre una fuente GNV probando la cadena de egresos EN ORDEN hasta que una responda (≠ ERROR).
 *  Chromium headless se relanza por egreso (barato); el resultado bueno corta la cadena. Cada
 *  egreso tiene tope duro (el close del browser aborta al runner) y la cadena un presupuesto total. */
async function runGnvWithEgress(
  plate: string,
  sourceId: string,
  runner: Runner,
  solver: CaptchaSolver,
  shot: string,
  opts: OperatorReportOptions,
): Promise<OperatorSourceResult> {
  const chain = gnvEgressChain();
  const srcName = sourceId.toUpperCase().replace(/-/g, '_');
  const t0 = Date.now();
  let last: OperatorSourceResult | null = null;
  for (let i = 0; i < chain.length; i++) {
    const eg = chain[i]!;
    if (i > 0 && Date.now() - t0 > GNV_CHAIN_BUDGET_MS) {
      logLine(opts.outDir, sourceId, `presupuesto de la cadena agotado (${Math.round(GNV_CHAIN_BUDGET_MS / 1000)}s) → no pruebo más egresos`);
      break;
    }
    if (i > 0) logLine(opts.outDir, sourceId, `egreso ${i + 1}/${chain.length} → ${eg.label}`);
    let proxy: ProxyConfig | undefined;
    try { proxy = await eg.proxy(); }
    catch (e) { logLine(opts.outDir, sourceId, `egreso "${eg.label}": no se pudo preparar (${(e as Error).message}) → salto`); continue; }
    if (proxy) logLine(opts.outDir, sourceId, `vía ${eg.label}`);
    const browser = await chromium.launch({ headless: opts.headless ?? true, ...(proxy ? { proxy } : {}) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const ctx = await browser.newContext({ locale: 'es-PE' });
      const page = await ctx.newPage();
      // Tope del egreso: si el runner se atasca (goto lento + captcha + reintentos internos), el
      // race devuelve ERROR y el finally cierra el browser → las operaciones del runner abortan.
      let timedOut = false;
      const r = await Promise.race([
        runner(page, plate, solver, shot),
        new Promise<OperatorSourceResult>((resolve) => {
          timer = setTimeout(() => { timedOut = true; resolve({ source: srcName, label: sourceId, category: 'GNV', status: 'ERROR', summary: `tope del egreso (${Math.round(GNV_EGRESS_TIMEOUT_MS / 1000)}s)`, ms: GNV_EGRESS_TIMEOUT_MS }); }, GNV_EGRESS_TIMEOUT_MS);
        }),
      ]);
      // DIAGNÓSTICO del tope: dónde quedó la página (un título "Just a moment…" = Cloudflare
      // bloqueando el headless; el captcha o un portal lento se ven en la captura).
      if (timedOut) {
        const title = await page.title().catch(() => '?');
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        logLine(opts.outDir, sourceId, `tope: la página quedó en "${title}" · ${page.url()} (captura guardada)`);
      }
      await page.close().catch(() => {});
      if (r.status !== 'ERROR') { logLine(opts.outDir, sourceId, resultLog(r)); return r; }
      last = r;
      logLine(opts.outDir, sourceId, `egreso "${eg.label}" falló: ${r.summary}`);
    } catch (e) {
      last = { source: srcName, label: sourceId, category: 'GNV', status: 'ERROR', summary: (e as Error).message, ms: 0 };
      logLine(opts.outDir, sourceId, `egreso "${eg.label}" reventó: ${(e as Error).message}`);
    } finally {
      if (timer) clearTimeout(timer);
      await browser.close().catch(() => {});
    }
  }
  const base = last ?? { source: srcName, label: sourceId, category: 'GNV', status: 'ERROR' as const, summary: 'sin egresos configurados', ms: 0 };
  const final = { ...base, summary: `${base.summary} · egresos agotados: ${chain.map((e) => e.label).join(' → ')}` };
  logLine(opts.outDir, sourceId, resultLog(final));
  return final;
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

// ── Gate GNV ─────────────────────────────────────────────────────────────────────────────────────
// FISE/Infogas SOLO deben correr si el vehículo es a gas (el combustible sale de la característica
// del asiento SPRL). Como historial y las fuentes ligeras corren EN PARALELO, las GNV ESPERAN la
// señal de combustible antes de gastar captcha/proxy. Compartido por el motor CONTINUO y el de LOTES.
const GNV_SOURCES = new Set(['fise-gnv', 'infogas-gnv']);

/** Señal de combustible por placa: el carril de historial la RESUELVE al terminar; los carriles GNV
 *  la ESPERAN (tope 8 min → null = no confirmado → se salta). Un gate por corrida/pipeline. */
function makeFuelGate(): { resolve: (plate: string, fuel: string | null) => void; wait: (plate: string) => Promise<string | null> } {
  const waiters = new Map<string, { promise: Promise<string | null>; resolve: (f: string | null) => void }>();
  const signal = (plate: string): { promise: Promise<string | null>; resolve: (f: string | null) => void } => {
    let w = waiters.get(plate);
    if (!w) {
      let resolve!: (f: string | null) => void;
      const promise = new Promise<string | null>((r) => { resolve = r; });
      w = { promise, resolve };
      waiters.set(plate, w);
    }
    return w;
  };
  return {
    resolve: (plate, fuel) => signal(plate).resolve(fuel),
    wait: (plate) => Promise.race([
      signal(plate).promise,
      new Promise<string | null>((r) => { setTimeout(() => r(null), 8 * 60 * 1000); }),
    ]),
  };
}

/** Resultado "no aplica" de una fuente GNV (vehículo CONFIRMADO no-gas). `data.aplicable=false` le
 *  dice al transform que fue un SALTO del gate (≠ "sin crédito" de un vehículo que SÍ es a gas). */
const gnvSkip = (srcId: string, fuel: string): OperatorSourceResult => ({
  source: srcId.toUpperCase().replace(/-/g, '_'), label: srcId, category: 'GNV', status: 'SIN_REGISTRO',
  summary: `No aplica: el vehículo no es a gas (SPRL: ${fuel})`,
  data: { aplicable: false, fuel }, ms: 0,
});

/** Resultado "NO ejecutada" de una fuente GNV: la DEPENDENCIA (historial → señal de combustible)
 *  falló o no corrió, así que NO SABEMOS si el vehículo es a gas. ERROR honesto (antes salía
 *  SIN_REGISTRO "No aplica", que aparentaba una consulta hecha): en la consola sale en rojo con
 *  Reintentar — el retry corre la fuente DIRECTO (sin gate), útil tras reintentar el historial. */
const gnvDepFail = (srcId: string): OperatorSourceResult => ({
  source: srcId.toUpperCase().replace(/-/g, '_'), label: srcId, category: 'GNV', status: 'ERROR',
  summary: 'no ejecutada: sin señal de combustible (el historial falló o no corrió) — omitida para no gastar captcha',
  data: { aplicable: null }, ms: 0,
});

/**
 * Señal de combustible a gas ROBUSTA para el gate GNV. `caracteristicas.fuel` es del asiento MÁS
 * RECIENTE que traiga ficha técnica, y puede NO reflejar la conversión (la ficha vigente dice
 * "GASOLINA" aunque el vehículo se convirtió, o el asiento de conversión no reimprime la ficha).
 * Caso real: BRA514 tiene crédito GNV en Infogas pero su ficha no marcaba gas → el gate la saltaba.
 * Fix: si la ficha no es gas, se recorre el timeline y basta UNA ficha histórica a gas o un asiento
 * de CONVERSIÓN A GNV/GLP (el "Cambio de Características") para confirmarlo. Devuelve una cadena que
 * `isGasVehicle` reconoce, o la ficha cruda (null/no-gas) si nada delata gas.
 */
export function gasFuelSignal(
  result: { caracteristicas?: { fuel?: string | null } | null; timeline?: Array<{ acto?: string; caracteristicas?: { fuel?: string | null } | null }> } | null | undefined,
): string | null {
  const ficha = result?.caracteristicas?.fuel ?? null;
  if (isGasVehicle(ficha)) return ficha;
  const RX_CONV_GAS = /CONVERSI[OÓ]N.*(GNV|GLP|GAS\s*NATURAL)|BI[\s-]*COMBUSTIBLE|\bGNV\b|\bGLP\b/i;
  for (const t of result?.timeline ?? []) {
    if (isGasVehicle(t?.caracteristicas?.fuel)) return t!.caracteristicas!.fuel!;
    if (t?.acto && RX_CONV_GAS.test(t.acto)) return `GNV (conversión registral: ${t.acto.replace(/\s+/g, ' ').trim().slice(0, 48)})`;
  }
  return ficha; // null o no-gas → el gate saltará (vehículo confirmado sin gas)
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
  const fuelGate = makeFuelGate(); // gate GNV: historial resuelve el combustible; FISE/Infogas esperan

  // Historial: 2 hilos SPRL (1 login por cuenta, reúso de sesión entre placas).
  lanes.push({ sources: ['historial'], run: async (plates, report) => {
    const outBy = new Map(plates.map((p) => [p.plate, p.outDir]));
    await runHistorialPool(plates.map((p) => p.plate), {
      onResult: (pr) => {
        fuelGate.resolve(pr.plate, gasFuelSignal(pr.result)); // libera el gate GNV (gas robusto: ficha + conversión)
        report(pr.plate, mapHistorial(pr.result, pr.ms, join(outBy.get(pr.plate) ?? '', 'historial.png')));
      },
    });
  } });

  // Fuentes ligeras: un carril por fuente, transpuesto (1 navegador barre las N placas).
  for (const id of Object.keys(SOURCE_RUNNERS)) {
    // GNV (FISE/Infogas): gated por combustible — espera el historial de ESA placa y salta si no es
    // a gas (mismo contrato que el motor continuo). Vehículos gas son raros → sin reúso de navegador.
    if (GNV_SOURCES.has(id)) {
      lanes.push({ sources: [id], run: async (plates, report) => {
        for (const p of plates) {
          const fuel = await fuelGate.wait(p.plate);
          if (fuel == null) { report(p.plate, gnvDepFail(id)); continue; } // dependencia caída ≠ "no aplica"
          if (!isGasVehicle(fuel)) { report(p.plate, gnvSkip(id, fuel)); continue; }
          try { report(p.plate, await runSingleSource(p.plate, id, baseOpts(p.outDir))); }
          catch (e) { report(p.plate, { source: id.toUpperCase().replace(/-/g, '_'), label: id, category: 'GNV', status: 'ERROR', summary: (e as Error).message, ms: 0 }); }
        }
      } });
      continue;
    }
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

  // Gate GNV (ver makeFuelGate arriba): el carril de historial resuelve el combustible al terminar;
  // el carril ligero lo espera antes de correr FISE/Infogas. Para placas sin 'historial' en el pedido
  // (o si el SPRL falla → fuel null) la señal resuelve null y GNV se SALTA (no se confirma gas).
  // Bounded por la vida del motor (se limpia en cada deploy/reinicio).
  const fuelGate = makeFuelGate();

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
        onEngineLog: (m) => console.log(`[historial-cont] ${m}`), // heartbeat/enfriamiento/failover → pm2 logs
        // heartbeatMs / cooldownMs: default desde el entorno (HISTORIAL_HEARTBEAT_MS / HISTORIAL_LOCKOUT_COOLDOWN_MS).
        onResult: (pr) => {
          fuelGate.resolve(pr.plate, gasFuelSignal(pr.result)); // libera el gate GNV (gas robusto: ficha + conversión)
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
          if (!it.sources.includes('historial')) fuelGate.resolve(it.plate, null);
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
              const fuel = await fuelGate.wait(t.plate);
              if (fuel == null) { report(t.plate, gnvDepFail(t.src)); continue; } // dependencia caída ≠ "no aplica"
              if (!isGasVehicle(fuel)) { report(t.plate, gnvSkip(t.src, fuel)); continue; }
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
