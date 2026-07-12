/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright';
import { findChrome, chromeFlags } from './chrome-path.js';
import { pdfBytesToText } from './asiento-parser.js';

const SIGM_DEBUG = !!process.env.SIGM_DEBUG;

/**
 * SIGM (Sistema Informativo de Garantías Mobiliarias, SUNARP) por HÍBRIDO CDP — la misma vía
 * que SUNARP. Consulta GRATUITA "Por Bien" → Placa → garantías mobiliarias VIGENTES (prendas).
 *
 * SIGM protege con **Cloudflare Turnstile PASIVO** (como SUNARP): con Chrome real pasa solo. La
 * API `/gratuita/busqueda` devuelve el resultado **cifrado** (CryptoJS AES OpenSSL "Salted__",
 * MD5 EvpKDF → aes-256-cbc, idéntico a Síguelo) con la key propia de SIGM. Se captura la respuesta
 * (`waitForResponse`) y se descifra → `{list:[{numeroFolio, fechaInscripcion, ultimaOperacion,
 * numPartida,…}]}`. **list vacía = sin garantía vigente** (SIGM solo trae las NO canceladas).
 *
 * NOTA: SIGM cubre garantías mobiliarias (prendas), NO embargos judiciales. El acreedor/deudor/
 * monto no vienen en la lista (están en el "Detalle" → fase 2; además el deudor es PII de tercero).
 */
const URL = 'https://sigm.sunarp.gob.pe/garantias-mobiliarias/inicio';
// Passphrase CryptoJS del bundle SIGM (chunk-6WAWKTVD.js · cryptKey). Pública (viaja en el JS del sitio).
const SIGM_KEY = 'c4m4VsB3QV5PPK3ruDWK4TitjiDR4BVAvjKaA35v1SPPnXN1Up';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Descifra el AES "Salted__" de SIGM (idéntico a Síguelo, con la key de SIGM). */
function sigmDecrypt(b64: string): string | null {
  try {
    const dataB = Buffer.from(b64, 'base64');
    if (dataB.subarray(0, 8).toString('latin1') !== 'Salted__') return null;
    const salt = dataB.subarray(8, 16);
    let dd = Buffer.alloc(0), bb = Buffer.alloc(0);
    while (dd.length < 48) { bb = crypto.createHash('md5').update(Buffer.concat([bb, Buffer.from(SIGM_KEY, 'utf8'), salt])).digest(); dd = Buffer.concat([dd, bb]); }
    const c = crypto.createDecipheriv('aes-256-cbc', dd.subarray(0, 32), dd.subarray(32, 48));
    return Buffer.concat([c.update(dataB.subarray(16)), c.final()]).toString('utf8');
  } catch { return null; }
}

export interface SigmFolio {
  folio: string | null;
  fechaInscripcion: string | null;
  ultimaOperacion: string | null;
  partida: string | null;
  /** Acreedor (del Detalle §3): denominación/RUC. Solo cuando se pudo abrir el Detalle. */
  acreedor?: string | null;
  /** Descripción del incumplimiento (del Detalle §5), cuando está EN EJECUCIÓN. */
  incumplimiento?: string | null;
}
export interface CdpSigmOptions {
  /** Puerto CDP (default 9227 / env CDP_SIGM_PORT). Distinto de ATU (:9226) para no chocar. */
  port?: number;
  profileDir?: string;
  shotPath?: string;
  log?: (m: string) => void;
}
export interface CdpSigmResult {
  ok: boolean;
  /** ENCONTRADO = hay garantía vigente; SIN_REGISTRO = ninguna; ERROR = no se pudo. */
  status: 'ENCONTRADO' | 'SIN_REGISTRO' | 'ERROR';
  data?: { hasLiens: boolean; total: number; items: SigmFolio[] };
  error?: string;
}

const str = (v: unknown): string | null => {
  const t = String(v ?? '').trim();
  return t && t !== '-' ? t : null;
};

/** Conecta a un Chrome ya abierto en el puerto; si no hay, lanza uno limpio en la URL de SIGM. */
async function connectOrLaunch(port: number, profileDir: string, chrome: string, log: (m: string) => void): Promise<Browser> {
  try {
    const b = await chromium.connectOverCDP(`http://localhost:${port}`);
    log(`reusando Chrome CDP en :${port}`);
    return b;
  } catch {
    log(`lanzando Chrome limpio (CDP :${port})…`);
    const proc = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, ...chromeFlags(), URL], { detached: false, stdio: 'ignore' });
    proc.on('error', (e) => log(`spawn chrome: ${e.message}`));
    for (let i = 0; i < 20; i++) {
      await wait(700);
      try { return await chromium.connectOverCDP(`http://localhost:${port}`); } catch { /* aún no abre */ }
    }
    throw new Error('no pude conectar al Chrome CDP de SIGM');
  }
}

/** Mutex por puerto: evita dos scrapes SIGM concurrentes sobre el mismo perfil/puerto. */
const portQueues = new Map<number, Promise<void>>();
async function acquirePortLock(port: number): Promise<() => void> {
  const prev = portQueues.get(port) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  portQueues.set(port, prev.then(() => mine));
  await prev;
  return release;
}

/** Espera el Turnstile pasivo (mismo patrón que SUNARP): input cf-turnstile-response con token. */
async function esperarTurnstile(page: Page, log: (m: string) => void): Promise<boolean> {
  for (let a = 0; a < 3; a++) {
    if (a > 0) { log(`Turnstile no pasó → recarga ${a}/2`); await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}); }
    for (let i = 0; i < 20; i++) {
      await wait(1000);
      const tok = await page.locator('input[name="cf-turnstile-response"]').first().inputValue({ timeout: 1000 }).catch(() => '');
      if (tok) { log(`Turnstile pasó (${tok.length})`); return true; }
    }
  }
  return false;
}

/** Cierra el modal de bienvenida. La X primero; si persiste, se REMUEVE por JS (el form vive fuera).
 *  ⚠️ NUNCA clickear "Clic aquí" (.tutorial-container button) → navega a los videos y saca del form. */
async function cerrarModal(page: Page, log: (m: string) => void): Promise<void> {
  for (let round = 0; round < 3; round++) {
    await page.locator('.ant-modal-close, button[aria-label="Close"]').first().click({ force: true, timeout: 1500 }).catch(() => {});
    await wait(400);
    if (!(await page.locator('nz-modal-container').first().isVisible().catch(() => false))) return;
  }
  if (await page.locator('nz-modal-container').first().isVisible().catch(() => false)) {
    log('modal persiste tras la X → removiéndolo por JS');
    await page.evaluate(() => document.querySelectorAll('nz-modal-container, .cdk-overlay-backdrop, .ant-modal-mask, .ant-modal-wrap, .cdk-global-overlay-wrapper').forEach((e) => e.remove())).catch(() => {});
    await wait(300);
  }
}

const isPdf = (b: Buffer): boolean => b.length > 4 && b.subarray(0, 5).toString('latin1') === '%PDF-';

/** Busca recursivamente un array de bytes de PDF (empieza en %PDF = 0x25 0x50 0x44 0x46) en un objeto. */
function findPdfBytes(o: unknown): number[] | null {
  if (Array.isArray(o)) {
    if (o.length > 4 && o[0] === 0x25 && o[1] === 0x50 && o[2] === 0x44 && o[3] === 0x46) return o as number[];
    return null;
  }
  if (o && typeof o === 'object') {
    for (const v of Object.values(o as Record<string, unknown>)) { const r = findPdfBytes(v); if (r) return r; }
  }
  return null;
}

/** Extrae acreedor (§3) + descripción del incumplimiento (§5) del texto plano del PDF del Detalle.
 *  Best-effort sobre el texto aplanado; se afina con el dump SIGM_DEBUG contra el formato real. */
function extraerAcreedorIncumplimiento(text: string): { acreedor: string | null; incumplimiento: string | null } {
  const flat = text.replace(/\s+/g, ' ');
  let acreedor: string | null = null;
  const accBlock = /ACREEDOR([\s\S]{0,700}?)(REPRESENTANTE|INCUMPLIMIENTO|DESCRIPCI[ÓO]N)/i.exec(flat)?.[1] ?? '';
  const denom = /([A-ZÁÉÍÓÚÑ0-9&.,\- ]{6,90}?(?:S\.?R\.?L|S\.?A\.?C?|E\.?I\.?R\.?L|SOCIEDAD|ASOCIADOS)\.?[A-ZÁÉÍÓÚÑ0-9&.,\- ]{0,25})/.exec(accBlock)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
  const ruc = /\b(20\d{9})\b/.exec(accBlock)?.[1] ?? null;
  if (denom || ruc) acreedor = [denom, ruc ? `RUC ${ruc}` : null].filter(Boolean).join(' · ');
  let incumplimiento: string | null = null;
  const inc = /INCUMPLIMIENTO\s*([\s\S]{0,900}?)(DESCRIPCI[ÓO]N DE LOS BIENES|BIENES A EJECUTAR|\bN?\d\.\s*DESCRIPCI)/i.exec(flat)?.[1];
  if (inc) { const t = inc.replace(/\s+/g, ' ').trim(); if (t.length > 15) incumplimiento = t.slice(0, 500); }
  return { acreedor, incumplimiento };
}

/**
 * Abre el "Detalle" del 1er folio (ícono de la última columna → visor PDF) y captura el PDF para
 * extraer ACREEDOR (§3) + DESCRIPCIÓN DEL INCUMPLIMIENTO (§5). NO extrae el deudor/garante (§2):
 * es PII de tercero (riesgo L-01). No fatal: si falla, el resultado de la lista igual sirve.
 */
async function capturarDetalle(page: Page, log: (m: string) => void): Promise<{ acreedor: string | null; incumplimiento: string | null } | null> {
  const bufs: Buffer[] = [];
  const grabbed: Array<{ ct: string; size: number }> = [];
  const onResp = (resp: import('playwright').Response): void => {
    const u = resp.url();
    const ct = resp.headers()['content-type'] ?? '';
    if (/\.(js|css|png|svg|woff2?|ttf|otf|eot|gif|ico|map)(\?|$)/i.test(u)) return;
    if (!(/pdf/i.test(ct) || /json/i.test(ct) || /detalle|formulario|documento|pdf|reporte|visor|garantia/i.test(u))) return;
    void resp.body().then((b) => { bufs.push(b); grabbed.push({ ct, size: b.length }); }).catch(() => {});
  };
  page.on('response', onResp);
  try {
    const icon = page.locator('table tbody td:last-child button, table tbody td:last-child a, table tbody td:last-child .anticon, table tbody td:last-child [nz-icon], table tbody td:last-child svg').last();
    await icon.click({ force: true, timeout: 5000 }).catch((e) => log(`detalle click: ${(e as Error).message}`));
    for (let i = 0; i < 15 && !bufs.some(isPdf); i++) await wait(1000);
  } finally {
    page.off('response', onResp);
  }

  let text = '';
  for (const b of bufs) {
    if (isPdf(b)) { try { text += ' ' + pdfBytesToText(Array.from(b)); } catch { /* */ } continue; }
    try {
      const j = JSON.parse(b.toString('utf8')) as { cmVzcG9uc2U?: string };
      const dec = j.cmVzcG9uc2U ? sigmDecrypt(j.cmVzcG9uc2U) : null;
      if (dec) {
        const o = (() => { try { return JSON.parse(dec); } catch { return null; } })();
        const bytes = findPdfBytes(o);
        if (bytes) { try { text += ' ' + pdfBytesToText(bytes); } catch { /* */ } }
        else text += ' ' + dec;
      }
    } catch { /* no era JSON */ }
  }
  if (SIGM_DEBUG) log(`[DETALLE] respuestas: ${grabbed.map((g) => `${(g.ct.split(';')[0] || '?')}:${g.size}`).join(', ') || '(ninguna)'} · texto ${text.length} chars`);
  if (SIGM_DEBUG && text) log(`[DETALLE-TEXT] ${text.slice(0, 3500)} [/DETALLE-TEXT]`);
  if (!text.trim()) return null;
  return extraerAcreedorIncumplimiento(text);
}

export async function scrapeSigmViaCdp(plateRaw: string, opts: CdpSigmOptions = {}): Promise<CdpSigmResult> {
  const log = opts.log ?? (() => {});
  const plate = plateRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const chrome = findChrome();
  if (!chrome) return { ok: false, status: 'ERROR', error: 'No encontré chrome.exe.' };
  const port = opts.port ?? Number(process.env.CDP_SIGM_PORT ?? 9227);
  const profileDir = opts.profileDir ?? process.env.CDP_SIGM_PROFILE ?? `${process.cwd()}/.cdp-sigm-profile`;

  const releaseLock = await acquirePortLock(port);
  let browser: Browser | null = null;
  try {
    browser = await connectOrLaunch(port, profileDir, chrome, log);
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    if (!(await esperarTurnstile(page, log))) log('⚠️ Turnstile NO pasó pasivo (¿IP marcada?)');
    await wait(1500);
    await cerrarModal(page, log);

    // Pestaña "Por Bien" → radio "Placa" (cada pestaña tiene su propio botón oculto → usar :visible).
    const tab = page.locator('[role="tab"]:has-text("Por Bien")').first();
    await tab.click({ timeout: 4000 }).catch(async () => { await tab.click({ force: true, timeout: 3000 }).catch(() => {}); });
    await wait(1000);
    await page.locator('label:has-text("Placa")').first().click({ force: true, timeout: 3000 }).catch(() => {});
    await wait(400);

    // Placa + Consultar, capturando la respuesta cifrada de /gratuita/busqueda.
    const inp = page.locator('input[formcontrolname="numeroPlaca"]').first();
    await inp.fill('', { timeout: 4000 }).catch(() => {});
    await inp.fill(plate, { timeout: 4000 }).catch((e) => log(`fill: ${(e as Error).message}`));
    await wait(400);
    const respP = page.waitForResponse((r) => /gratuita\/busqueda/i.test(r.url()), { timeout: 30000 }).catch(() => null);
    await page.locator('button:has-text("Consultar"):visible').first().click({ timeout: 5000 }).catch(async () => {
      await page.locator('button:has-text("Consultar"):visible').first().click({ force: true }).catch((e) => log(`Consultar: ${(e as Error).message}`));
    });
    const resp = await respP;
    if (opts.shotPath) await page.screenshot({ path: opts.shotPath, fullPage: true }).catch(() => {});

    if (!resp) return { ok: false, status: 'ERROR', error: 'SIGM no respondió /gratuita/busqueda (¿Turnstile/reCAPTCHA?)' };
    const raw = (await resp.text().catch(() => '')) || '';
    const enc = (() => { try { return (JSON.parse(raw) as { cmVzcG9uc2U?: string }).cmVzcG9uc2U ?? ''; } catch { return ''; } })();
    const dec = enc ? sigmDecrypt(enc) : null;
    if (!dec) return { ok: false, status: 'ERROR', error: 'no pude descifrar la respuesta de SIGM' };
    const obj = (() => { try { return JSON.parse(dec) as { list?: Array<Record<string, unknown>> }; } catch { return null; } })();
    const list = obj?.list ?? [];
    const items: SigmFolio[] = list.map((f) => ({
      folio: str(f.numeroFolio),
      fechaInscripcion: str(f.fechaInscripcion),
      ultimaOperacion: str(f.ultimaOperacion),
      partida: str(f.numPartida),
    }));
    const hasLiens = items.length > 0;
    // Detalle (acreedor §3 + incumplimiento §5) del 1er folio — solo si hay garantía.
    if (hasLiens) {
      try {
        const det = await capturarDetalle(page, log);
        if (det && items[0]) { items[0].acreedor = det.acreedor; items[0].incumplimiento = det.incumplimiento; }
        if (det?.acreedor) log(`acreedor: ${det.acreedor}`);
      } catch (e) { log(`detalle: ${(e as Error).message}`); }
    }
    log(`RESULTADO ${hasLiens ? `${items.length} garantía(s) vigente(s)` : 'sin garantías vigentes'}`);
    return { ok: true, status: hasLiens ? 'ENCONTRADO' : 'SIN_REGISTRO', data: { hasLiens, total: items.length, items } };
  } catch (e) {
    return { ok: false, status: 'ERROR', error: (e as Error).message };
  } finally {
    if (browser) await browser.close().catch(() => {}); // desconecta CDP, NO mata el Chrome
    releaseLock();
  }
}
