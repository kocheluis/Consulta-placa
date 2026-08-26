/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { chromium, type Page, type Locator, type Browser, type BrowserContext, type Response } from 'playwright';
import { parseAsientos, parseCaracteristicas, pdfBytesToText, construirTimeline, type AsientoRecord } from './asiento-parser.js';
import type { VehicleSpecs } from '@app/shared';
import { scrapeSunarpViaCdp } from './cdp-sunarp.js';
import { findChrome, chromeFlags } from './chrome-path.js';
import { sprlIsLogged, sprlLogin } from './sprl-login.js';

/**
 * HISTORIAL REGISTRAL completo (SUNARP → SPRL → Síguelo) por HÍBRIDO CDP.
 *
 * Flujo: [1] Consulta Vehicular (SUNARP) → SEDE; [2] SPRL (login auto con creds de
 * entorno + búsqueda por placa + "Ver Asientos" → todos los títulos); [3] Síguelo
 * Plus por cada título → PDF del asiento → parser → **línea de tiempo cronológica**
 * + detección de señales (aseguradora / casa de remate / financiera).
 *
 * El login usa SPRL_USER/SPRL_PASS del entorno (nunca se imprimen). Reusa la sesión
 * del perfil persistente; si expiró, hace login automático.
 */

const INGRESO = 'https://sprl.sunarp.gob.pe/sprl/ingreso';
const PARTIDA = 'https://sprl.sunarp.gob.pe/sprl/main/partidas-base-grafica-registral';
const SIGUELO = 'https://sigueloplus.sunarp.gob.pe/siguelo/';
const SG_PASS = 'sV2zUWiuNo@3uv8nu9ir4'; // CryptoJS passphrase del bundle de Síguelo
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CHROME = findChrome();

export interface HistorialOptions {
  sprlUser?: string;
  sprlPass?: string;
  /** Puerto CDP del Chrome del SPRL (por slot de cuenta). Default env CDP_SPRL_PORT ?? 9224. */
  port?: number;
  /** Perfil persistente del Chrome del SPRL (por slot). Default env CDP_SPRL_PROFILE. */
  profile?: string;
  /** Chrome CDP ya abierto por el CALLER (lo abre y lo cierra él). Si se pasa, esta función NO
   *  hace spawn ni close → la sesión SPRL queda CALIENTE entre llamadas: un login por cuenta en
   *  todo un lote, NO uno por placa (el re-login en bucle es lo que dispara el bloqueo por IP).
   *  Úsalo para procesar muchas placas seguidas con la misma cuenta. */
  browser?: Browser;
  oficina?: string; // si ya se conoce la sede; si no, se saca de SUNARP
  parallel?: boolean; // opt-in: corre las búsquedas de Síguelo en paralelo (conc. 2)
  log?: (m: string) => void;
  shotPath?: string;
}
export interface HistorialResult {
  ok: boolean;
  sede: string;
  vehiculo: Record<string, unknown> | null;
  titulos: string[];
  timeline: AsientoRecord[];
  /** Ficha técnica del asiento MÁS RECIENTE que la contenga (refleja el estado actual del vehículo); null si ninguno la trae. */
  caracteristicas?: VehicleSpecs | null;
  flags: { aseguradora: boolean; remate: boolean; financiera: boolean; gravamen: boolean; embargo: boolean };
  error?: string;
  /** true = SUNARP bloqueó la cuenta por IP (exceso de intentos) → el caller puede hacer failover a otra cuenta. */
  locked?: boolean;
  /** true = SUNARP marca la partida como "incompleta, no visualizada por usuario externo" (típico de placas
   *  MUY antiguas). Es un error DE SUNARP, no nuestro: la partida existe pero no deja ver los asientos → se
   *  reporta "solo propietario actual (de la Consulta Vehicular), sin histórico" en vez de un ERROR. */
  partidaIncompleta?: boolean;
}

function sgDecrypt(b64: string): string | null {
  try {
    const data = Buffer.from(b64, 'base64');
    const salt = data.subarray(8, 16);
    let dd = Buffer.alloc(0), bb = Buffer.alloc(0);
    while (dd.length < 48) { bb = crypto.createHash('md5').update(Buffer.concat([bb, Buffer.from(SG_PASS, 'utf8'), salt])).digest(); dd = Buffer.concat([dd, bb]); }
    const c = crypto.createDecipheriv('aes-256-cbc', dd.subarray(0, 32), dd.subarray(32, 48));
    return Buffer.concat([c.update(data.subarray(16)), c.final()]).toString('utf8');
  } catch { return null; }
}

// El SPRL migró a una API REST que devuelve JSON EN CLARO, pero algunos campos `data` siguen cifrados
// AES-128-CBC con esta clave ESTÁTICA del bundle público (`environment.cryptKey`; IV = primeros 16 bytes).
// Es la misma categoría que `SG_PASS`: NO es un secreto (sale del JS servido por SUNARP), así que puede ir
// en claro en el repo público. Se usa para leer los títulos también desde la RED (no solo del DOM del modal).
const SPRL_KEY = 'sUIZJFw36fA7GzpS';
function sprlDecrypt(b64: string): string | null {
  try {
    const blob = Buffer.from(b64.trim(), 'base64');
    if (blob.length < 32 || blob.length % 16 !== 0) return null;
    const d = crypto.createDecipheriv('aes-128-cbc', Buffer.from(SPRL_KEY, 'utf8'), blob.subarray(0, 16));
    return Buffer.concat([d.update(blob.subarray(16)), d.final()]).toString('utf8');
  } catch { return null; }
}

// pdf.js (CDN) para rasterizar el PDF del asiento a PNG. Se usa el VISOR-NO: render directo a un
// <canvas> con JS → funciona igual en headless o headed y NO depende del visor de PDF de Chrome (que
// en el VPS —headless / `--disable-extensions`— salía en blanco). Versión fija (estable).
const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';

/**
 * Rasteriza a PNG el PDF del ASIENTO de Síguelo (con los datos del vehículo). Usa los BYTES que ya trae
 * `listarAsientos`, así NO depende de dónde abra el PDF el portal ni del visor de Chrome. Render con
 * pdf.js sobre un canvas (independiente del entorno). Best-effort: si el render falla (p. ej. la CDN no
 * responde), deja el PDF en disco (`historial.pdf`) como respaldo; si sale, borra el PDF (solo captura).
 */
async function renderAsientoShot(ctx: BrowserContext, bytes: number[], pngPath: string): Promise<void> {
  const buf = Buffer.from(bytes.map((n) => (n < 0 ? n + 256 : n))); // bytes firmados −128..127 → 0..255
  const pdfPath = pngPath.replace(/\.png$/i, '.pdf');
  writeFileSync(pdfPath, buf); // respaldo por si falla el render
  const pg = await ctx.newPage();
  try {
    await pg.goto('about:blank').catch(() => {});
    await pg.addScriptTag({ url: `${PDFJS_CDN}/pdf.min.js` }).catch(() => {});
    const dataUrl = await pg.evaluate(async ({ b64, worker }) => {
      const lib = (window as unknown as { pdfjsLib?: any }).pdfjsLib; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!lib) return '';
      lib.GlobalWorkerOptions.workerSrc = worker;
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const pdf = await lib.getDocument({ data: arr }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2 }); // 2× = nítido
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      return canvas.toDataURL('image/png');
    }, { b64: buf.toString('base64'), worker: `${PDFJS_CDN}/pdf.worker.min.js` }).catch(() => '');
    if (dataUrl.startsWith('data:image/png')) {
      writeFileSync(pngPath, Buffer.from(dataUrl.split(',')[1] ?? '', 'base64'));
      try { unlinkSync(pdfPath); } catch { /* ya no está */ }
    }
  } finally { await pg.close().catch(() => {}); }
}

/**
 * Selecciona el ÁREA "Propiedad Vehicular" de forma ROBUSTA, sin depender del placeholder del select
 * (SUNARP lo cambió → el finder viejo `hasText:/propiedad/` no enganchaba → el área quedaba SIN
 * seleccionar → búsqueda incompleta → filas=0). Estrategia: abre cada `nz-select` y elige la 1ª que
 * ofrezca una opción que empareje `optionRx`; VERIFICA que el select quede con ese valor. Si no lo
 * logra, devuelve en `diag` las opciones que vio en cada select (para cazar un nuevo nombre si cambió).
 */
async function pickAreaOption(page: Page, optionRx: RegExp): Promise<{ ok: boolean; diag: string }> {
  const selects = page.locator('nz-select');
  const n = await selects.count().catch(() => 0);
  const seen: string[] = [];
  for (let i = 0; i < n; i++) {
    const sel = selects.nth(i);
    await sel.locator('.ant-select-selector').first().click({ timeout: 4000 }).catch(() => {});
    await wait(500);
    const opts = page.locator('.ant-select-item-option-content');
    const texts = (await opts.allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (texts.length) seen.push(`sel${i}:[${texts.slice(0, 6).join(' | ')}]`);
    const idx = texts.findIndex((t) => optionRx.test(t));
    if (idx >= 0) {
      await opts.nth(idx).click().catch(() => {});
      await wait(700);
      const chosen = (await sel.innerText({ timeout: 1500 }).catch(() => '')).replace(/\s+/g, ' ').trim();
      if (optionRx.test(chosen)) return { ok: true, diag: `sel${i}` };
    }
    await page.keyboard.press('Escape').catch(() => {}); // cierra el dropdown antes del siguiente
    await wait(200);
  }
  return { ok: false, diag: `NO seleccionada · selects=${n} · ${seen.join('  ') || 'sin opciones visibles'}` };
}
async function pickSearchable(sel: Locator, page: Page, value: string): Promise<void> {
  await sel.locator('.ant-select-selector').first().click({ timeout: 5000 }).catch(() => {});
  await wait(400);
  await page.locator('.ant-select-selection-search-input:visible').first().fill(value).catch(() => {});
  await wait(900);
  const opt = page.locator('.ant-select-item-option-content', { hasText: new RegExp(`^\\s*${value}\\s*$`, 'i') }).first();
  await opt.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  await opt.click().catch(() => {});
  await wait(800);
}

export async function runHistorialRegistral(plateRaw: string, opts: HistorialOptions = {}): Promise<HistorialResult> {
  const log = opts.log ?? (() => {});
  const plate = plateRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const user = opts.sprlUser ?? process.env.SPRL_USER ?? '';
  const pass = opts.sprlPass ?? process.env.SPRL_PASS ?? '';
  const PORT = opts.port ?? Number(process.env.CDP_SPRL_PORT ?? 9224);
  const PROFILE = opts.profile ?? process.env.CDP_SPRL_PROFILE ?? join(process.cwd(), '.cdp-sprl-profile');
  const empty: HistorialResult = { ok: false, sede: opts.oficina ?? '', vehiculo: null, titulos: [], timeline: [], flags: { aseguradora: false, remate: false, financiera: false, gravamen: false, embargo: false } };
  if (!CHROME) return { ...empty, error: 'No encontré chrome.exe.' };

  // Lanzar el Chrome del SPRL PRIMERO: el re-auth (OAuth) se asienta mientras corre
  // el SUNARP (igual que el probe que funciona) → evita el race de login.
  // Si el caller pasó un browser (modo lote), NO se hace spawn ni close: se reusa su sesión.
  const reuseBrowser = !!opts.browser;
  let browser: Browser | null = opts.browser ?? null;
  let spawned = false;
  // connectOverCDP con timeout POR INTENTO: un stall NO debe colgar ~30s (default de Playwright) — con
  // 20 reintentos eso daba los ~10 min del "no conecté al Chrome SPRL" visto en el VPS.
  const cdp = (): Promise<Browser> => chromium.connectOverCDP(`http://localhost:${PORT}`, { timeout: 6000 });
  if (!reuseBrowser) {
    // CONNECT-FIRST: si ya hay un Chrome CALIENTE en el puerto (el keep-alive del SPRL o el pool
    // continuo parqueado), REÚSALO en vez de lanzar OTRO sobre el mismo perfil. El 2º Chrome no puede
    // bindear el puerto (SingletonLock del perfil) y connectOverCDP terminaba colgando contra el Chrome
    // ocupado → causa raíz del cuelgue de ~10 min. Solo se cierra lo que ESTA función lanzó (`spawned`).
    browser = await cdp().catch(() => null);
    if (browser) {
      log(`Chrome SPRL (CDP :${PORT}) reusado (sesión caliente)`);
    } else {
      log(`Chrome SPRL (CDP :${PORT})…`);
      const proc = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...chromeFlags(), INGRESO], { detached: false, stdio: 'ignore' });
      proc.on('error', (e) => log(`spawn: ${e.message}`));
      spawned = true;
    }
  }

  // ── [1] SUNARP → SEDE en PARALELO ──
  // La sede SOLO la necesita Síguelo (no el SPRL: este busca por placa sin oficina).
  // Por eso SUNARP corre EN PARALELO con el login + la búsqueda del SPRL, y su sede se
  // resuelve recién antes de Síguelo → se solapa el ~24s de SUNARP en vez de bloquear.
  type SunResult = Awaited<ReturnType<typeof scrapeSunarpViaCdp>>;
  let oficina = (opts.oficina ?? '').toUpperCase();
  let vehiculo: Record<string, unknown> | null = null;
  let sunarpP: Promise<SunResult | null>;
  if (oficina) {
    sunarpP = Promise.resolve(null);
  } else {
    log('Consulta Vehicular (SUNARP) → sede (en paralelo con el SPRL)…');
    sunarpP = scrapeSunarpViaCdp(plate, { shotPath: opts.shotPath ?? `${PROFILE}/_sunarp.png`, log: (m) => log(`sunarp: ${m}`) }).catch(() => null);
  }
  // Resuelve la sede desde SUNARP (idempotente): Síguelo la necesita y el fallback del SPRL.
  const ensureSede = async (): Promise<void> => {
    if (oficina) return;
    const sun = await sunarpP;
    vehiculo = sun?.data ?? null;
    oficina = ((sun?.data?.sede as string | undefined) ?? '').trim().toUpperCase() || 'LIMA';
    log(`sede=${oficina}`);
  };

  // Referencia a la página para el screenshot de diagnóstico del `catch` (el `page` de abajo es
  // block-scoped al try → no llega al catch). En el pool continuo este camino de error no guardaba
  // NI log NI captura → el historial fallaba "en silencio" (el .log terminaba en "Síguelo…").
  let errPage: Page | null = null;
  let sprlRespOff: (() => void) | null = null; // desengancha el listener REST del SPRL en el finally (evita fuga en el pool)
  try {
    for (let i = 0; i < 20 && !browser; i++) { await wait(700); browser = await cdp().catch(() => null); }
    if (!browser) return { ...empty, sede: oficina, vehiculo, error: 'no conecté al Chrome SPRL' };
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    errPage = page;
    // Red de seguridad: cualquier op de locator SIN timeout explícito usaría el default de 30s de
    // Playwright; en un Chrome contendido eso encadena cuelgues. Se acota a 20s (las esperas legítimas
    // largas —goto, waitForResponse— pasan su propio timeout explícito, así que no las afecta).
    page.setDefaultTimeout(20000);

    // Intercepta las respuestas REST del SPRL para leer los títulos también desde la RED, no solo del
    // DOM del modal "Lista de Asientos" (que en VPS/red lenta a veces no alcanza a pintar antes de leer →
    // era el `títulos: []` con partida existente). El JSON viene EN CLARO; si un campo `data` está cifrado
    // (AES-128) se descifra. Igual que el probe validado. Se desengancha en el finally.
    const sprlRest: Array<{ url: string; body: string }> = [];
    const onSprlResp = (resp: Response): void => {
      const u = resp.url();
      if (!/sunarp-services/i.test(u) || /captcha\/image/i.test(u)) return;
      resp.text().then((t) => {
        if (!t) return;
        let out = t;
        try { const j = JSON.parse(t) as { data?: unknown }; if (typeof j.data === 'string' && j.data.length > 40) { const dec = sprlDecrypt(j.data); if (dec) out = `${t} ${dec}`; } } catch { /* no era JSON */ }
        sprlRest.push({ url: u, body: out });
      }).catch(() => {});
    };
    page.on('response', onSprlResp);
    sprlRespOff = () => page.off('response', onSprlResp);

    // ── [2] SPRL: login (la sesión ya debería estar asentada por el spawn temprano) ──
    // Login + detección de lockout centralizados en sprl-login.ts (MISMA lógica que reusan el
    // keep-alive y el seed → un solo lugar donde mantenerlos).
    const isLogged = (): Promise<boolean> => sprlIsLogged(page);
    let blockReason = '';
    let freshLogin = false; // true = esta corrida arrancó con login fresco (NO con la sesión caliente del keep-alive)
    const autoLogin = async (): Promise<boolean> => {
      const r = await sprlLogin(page, ctx, { user, pass, log, shotPath: `${PROFILE}/_login.png` });
      if (r.locked) blockReason = 'lockout';
      return r.ok;
    };
    // Esperar a que la sesión activa se renderice. El re-auth OAuth puede tardar >25s en
    // VPS lento; si nos rendimos antes, autoLogin dispara un force-clear innecesario que
    // destruye una sesión que estaba por aparecer (fue el bug de M4S859) → 45s de margen.
    // Comprueba PRIMERO (sesión caliente del keep-alive → sale al toque, sin gastar 1s); solo si
    // no está logueada entra al bucle de espera (re-auth OAuth puede tardar en VPS lento).
    const tLogin = Date.now();
    let logged = await isLogged();
    for (let i = 0; i < 45 && !logged; i++) { await wait(1000); logged = await isLogged(); }
    // RECUPERACIÓN SUAVE antes del login destructivo: la sesión puede seguir VIVA pero la página quedó
    // ilegible (Chrome trabado/contendido → isLogged devolvió '' por timeout). Una navegación LIMPIA a la
    // base (sin borrar cookies) deja que el re-auth la recupere. Solo si tras esto sigue sin sesión se
    // hace autoLogin (que SÍ limpia cookies y arriesga lockout por re-login en bucle).
    if (!logged) {
      log(`sin sesión activa tras ${Math.round((Date.now() - tLogin) / 1000)}s → intento recuperar la sesión (navegación limpia)`);
      await page.goto(INGRESO, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      for (let i = 0; i < 10 && !logged; i++) { await wait(1000); logged = await isLogged(); }
    }
    if (!logged) { log('sesión no recuperada → login automático'); logged = await autoLogin(); freshLogin = logged; }
    if (!logged) {
      await page.screenshot({ path: `${PROFILE}/_login.png`, fullPage: true }).catch(() => {});
      const err = blockReason === 'lockout'
        ? 'Cuenta SPRL bloqueada por SUNARP desde el VPS (se superó el número de intentos de login). La cuenta está OK — es un límite temporal por IP. Espera ~1-2 h y reintenta UNA sola vez; no reintentes seguido.'
        : 'no se pudo iniciar sesión en SPRL (revisa SPRL_USER/SPRL_PASS, o el Turnstile del login pidió clic manual)';
      return { ...empty, sede: oficina, vehiculo, error: err, locked: blockReason === 'lockout' };
    }
    log('sesión SPRL activa');

    // Búsqueda SPRL (con espera del form post-login + reintento si no hay títulos).
    let partidaIncompleta = false;
    async function sprlBuscarTitulos(useOficina: boolean): Promise<string[]> {
      await page.goto(PARTIDA, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await page.locator('nz-select').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
      await wait(1500);
      // Área "Propiedad Vehicular" — selección ROBUSTA (no depende del placeholder; ver pickAreaOption).
      // Un reintento por si el 1er open no alcanzó a pintar las opciones (VPS lento).
      let areaPick = await pickAreaOption(page, /propiedad\s+vehicular/i);
      if (!areaPick.ok) { await wait(800); areaPick = await pickAreaOption(page, /propiedad\s+vehicular/i); }
      await wait(600);
      // Oficina: opcional. El SPRL busca por placa sin sede; solo se llena en el fallback.
      if (useOficina && oficina) {
        await pickSearchable(page.locator('nz-select').filter({ hasText: /seleccione/i }).first(), page, oficina);
        await wait(800);
      }
      await page.locator('label.ant-radio-wrapper', { hasText: /^placa$/i }).first().check().catch(() => {});
      await wait(500);
      const num = page.locator('#numero');
      await num.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      let placaVal = '';
      for (let i = 0; i < 3; i++) { await num.click().catch(() => {}); await num.fill('').catch(() => {}); await num.type(plate, { delay: 60 }).catch(() => {}); await wait(400); placaVal = await num.inputValue({ timeout: 1000 }).catch(() => ''); if (placaVal === plate) break; }
      // Poll del Turnstile a 400ms (antes 1000ms): mismo tope (~30s) pero sale ~600ms antes en promedio.
      let tsLen = 0;
      for (let i = 0; i < 75; i++) { tsLen = (await page.locator('input[name="cf-turnstile-response"]').first().inputValue({ timeout: 400 }).catch(() => '')).length; if (tsLen) break; await wait(400); }
      const respP = page.waitForResponse((r) => /mostrar-resultado-partida-veh/i.test(r.url()), { timeout: 30000 }).catch(() => null);
      const buscarBtns = page.locator('button:has-text("Buscar")');
      let buscarClicked = false;
      for (let i = 0; i < (await buscarBtns.count().catch(() => 0)); i++) { const b = buscarBtns.nth(i); if ((await b.isVisible().catch(() => false)) && (await b.isEnabled().catch(() => false))) { await b.click().catch(() => {}); buscarClicked = true; break; } }
      const resp = await respP;
      // Espera a que pinte la fila de resultados (la partida). Cap 4s (subido desde 2.5s: en VPS lento la
      // fila tardaba y se saltaba el clic). Si no hay fila, el caso "sin resultado" sale igual de rápido.
      const rowBtns = page.locator('.ant-table-tbody tr button, table tbody tr button');
      await rowBtns.first().waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
      const nRow = await rowBtns.count().catch(() => 0);
      // Botones de la fila: Ver Detalle (lupa) · Ver Asientos · Boleta ($). NUNCA la boleta (cuesta S/6.60).
      // El de asientos = 1er no-boleta desde el índice 1 (igual que el probe validado), no un `nth(1)` ciego.
      let asientoIdx = -1;
      for (let i = 1; i < nRow; i++) {
        const html = await rowBtns.nth(i).evaluate((el) => el.outerHTML).catch(() => '');
        if (/boleta|file|pdf|printer|profile/i.test(html)) continue;
        asientoIdx = i; break;
      }
      if (asientoIdx === -1 && nRow >= 2) asientoIdx = 1; // respaldo: el 2º suele ser el de asientos
      const rxTit = /\b20\d{2}\s*-\s*\d{6,8}\b/;
      if (asientoIdx >= 0) {
        await rowBtns.nth(asientoIdx).click().catch(() => {});
        // El modal "Lista de Asientos" se PUEBLA con una llamada REST → esperar por SEÑAL, no ~3.9s ciegos
        // (era la causa del `[]` con partida existente en VPS lento). Espera el modal visible + a que los
        // títulos aparezcan en el DOM o en la red interceptada (cap ~15s; sale apenas hay títulos).
        await page.locator('.ant-modal-content, .ant-modal, [role="dialog"], .ant-drawer-content')
          .filter({ hasText: /asiento/i }).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
        for (let i = 0; i < 50; i++) {
          const dom = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
          if (rxTit.test(dom) || sprlRest.some((s) => rxTit.test(s.body))) break;
          await wait(300);
        }
      }
      const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
      // SUNARP marca la partida como "incompleta, no visualizada por usuario externo" (error DE SUNARP,
      // reportado a su zona registral). La partida existe pero no muestra los asientos → no es error nuestro.
      if (/partida incompleta|no visualizada por usuario externo/i.test(bodyText)) partidaIncompleta = true;
      // Títulos: DOM del modal + JSON REST interceptado (como el probe validado). La combinación solo puede
      // AÑADIR títulos que el DOM no alcanzó a pintar; el regex `AAAA-NNNNNN` nunca produce falsos positivos.
      const combined = `${bodyText} ${sprlRest.map((r) => r.body).join(' ')}`;
      const tits = [...new Set((combined.match(/\b20\d{2}\s*-\s*\d{6,8}\b/g) ?? []).map((s) => s.replace(/\s+/g, '')))];
      log(`SPRL${useOficina ? '+ofi' : ''}: filas=${nRow} · asientoBtn=${asientoIdx} · títulos=${tits.length}`);
      // DIAGNÓSTICO cuando la BÚSQUEDA no devolvió fila (filas=0): distingue —sin asumir— si el problema es
      // el Turnstile (tsLen=0), el llenado de la placa (placa≠), el botón Buscar (buscarClic=false), la
      // respuesta REST (resp=null / sin endpoint de búsqueda), o el render. Guarda una captura de la página
      // para verla directamente. Solo corre en el camino de fallo → no ralentiza el caso normal.
      if (nRow === 0) {
        const areaTxt = (await page.locator('nz-select').filter({ hasText: /propiedad/i }).first().innerText({ timeout: 1500 }).catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 40);
        const urls = sprlRest.map((r) => r.url.replace(/^https?:\/\/[^/]+/, '').slice(-52));
        const searchResp = sprlRest.find((r) => /mostrar-resultado-partida-veh/i.test(r.url));
        const snippet = (await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 220);
        const dbgShot = opts.shotPath ? opts.shotPath.replace(/[^/\\]+$/, 'sprl-busqueda.png') : `${PROFILE}/_sprl-busqueda.png`;
        await page.screenshot({ path: dbgShot, fullPage: true }).catch(() => {});
        log(`SPRL DIAG · placa="${placaVal}" area="${areaTxt}" areaPick=${areaPick.ok ? 'ok/' + areaPick.diag : areaPick.diag} turnstile=${tsLen} buscarClic=${buscarClicked} resp=${resp ? resp.status() : 'null'} REST=[${urls.join(' | ')}]`);
        if (searchResp) log(`SPRL DIAG · búsqueda body: ${searchResp.body.replace(/\s+/g, ' ').slice(0, 320)}`);
        log(`SPRL DIAG · captura=${dbgShot} · texto="${snippet}"`);
      }
      return tits;
    }
    // Intento RÁPIDO: SPRL por placa SIN oficina (optimización). Si el caller ya dio la
    // sede, se usa directo. Si viene vacío, resolvemos la sede (SUNARP) y reintentamos
    // CON oficina (camino antiguo, seguro) → la optimización nunca degrada el resultado.
    let titulos = await sprlBuscarTitulos(!!oficina);
    if (!titulos.length && !partidaIncompleta) {
      log('SPRL sin resultados → resuelvo sede (SUNARP) y reintento con oficina…');
      await ensureSede();
      titulos = await sprlBuscarTitulos(true);
      if (!titulos.length && !partidaIncompleta) { log('reintento SPRL con oficina…'); titulos = await sprlBuscarTitulos(true); }
    }
    await ensureSede(); // Síguelo SIEMPRE necesita la sede (y el propietario actual sale de aquí)
    // SESIÓN CALIENTE RANCIA: el keep-alive mantiene la página con pinta de logueada (isLogged=true) pero
    // el auth de la API REST de búsqueda ya caducó → la búsqueda por placa devuelve filas=0 EN SILENCIO
    // aunque la partida exista (le pasó a D0K057: 2 corridas con "sesión activa" inmediata → vacío; la 3ª,
    // que tuvo que re-loguear, trajo los 3 títulos). Si NO logueamos fresco esta corrida, seguimos en vacío
    // y SUNARP SÍ vio el vehículo (⇒ debería tener partida), forzamos UN re-login (no en bucle → no dispara
    // el lockout por IP) y un último intento con la sesión nueva.
    if (!titulos.length && !partidaIncompleta && !freshLogin && vehiculo) {
      log('SPRL vacío con sesión caliente (SUNARP sí halló el vehículo) → posible sesión rancia; re-login y último intento…');
      const relog = await autoLogin();
      freshLogin = true; // ya intentamos el re-login: no reintentar de nuevo (bounded a 1)
      if (blockReason === 'lockout') {
        return { ...empty, sede: oficina, vehiculo, locked: true, error: 'Cuenta SPRL bloqueada por SUNARP desde el VPS (re-login por sesión rancia superó el límite por IP). Espera ~1-2 h y reintenta UNA sola vez.' };
      }
      if (relog) titulos = await sprlBuscarTitulos(true);
    }
    // Partida marcada INCOMPLETA por SUNARP (no nuestro error, placa antigua): devolvemos el propietario
    // actual (de la Consulta Vehicular) y avisamos que el histórico no está disponible — NO un ERROR.
    if (partidaIncompleta && !titulos.length) {
      log('SUNARP: partida incompleta (no visualizable por usuario externo) → solo propietario actual, sin histórico');
      return { ...empty, partidaIncompleta: true, sede: oficina, vehiculo };
    }
    log(`títulos: ${JSON.stringify(titulos)}`);

    // ── [3] Síguelo por cada título → asiento PDF → parser ──
    const fire = (el: Element) => { for (const t of ['input', 'change', 'blur']) el.dispatchEvent(new Event(t, { bubbles: true })); };
    const aceptarTC = async (pg: Page): Promise<void> => {
      const btn = pg.locator('button').filter({ hasText: /acepto/i }).filter({ hasNotText: /no\s*acepto/i }).first();
      if (await btn.isVisible().catch(() => false)) { await btn.click().catch(() => {}); await wait(700); return; }
      const link = pg.locator('a:has-text("ingresar"), a:has-text("términos"), a:has-text("terminos")').first();
      if (await link.isVisible().catch(() => false)) { await link.click().catch(() => {}); await wait(1200); await pg.locator('button').filter({ hasText: /acepto/i }).filter({ hasNotText: /no\s*acepto/i }).first().click().catch(() => {}); await wait(700); }
    };
    // Recencia (año*1e8+nº) del asiento capturado en el screenshot del historial. La captura es del
    // asiento a capturar. Prioridad: (calidad) el que trae FICHA técnica gana sobre cualquier otro; a
    // igual calidad, el más reciente (año*1e8+nº). Así, en autos ANTIGUOS cuyos asientos NO traen la
    // ficha moderna (VIN/versión — p. ej. EGU257, 1998), igual se captura el asiento más reciente y NO
    // se cae al fallback de la captura de SUNARP. Se renderiza UNA sola vez, al final del Síguelo.
    let shotCandidate: { bytes: number[]; quality: number; recency: number } | null = null;
    async function searchSiguelo(pg: Page, anioT: string, numeroT: string): Promise<string | null> {
      await pg.goto(SIGUELO, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      // En vez de wait(1800) ciego: espera a que el formulario esté en el DOM (señal de que el JS
      // de la página ya cargó). 'attached' (no 'visible') porque el modal de T&C puede taparlo.
      await pg.locator('#cboOficina').waitFor({ state: 'attached', timeout: 6000 }).catch(() => {});
      await aceptarTC(pg);
      await pg.locator('input[name="optradio"]').first().check().catch(() => {});
      await pg.selectOption('#cboOficina', { label: oficina }).catch(() => {});
      await pg.locator('#cboOficina').evaluate(fire).catch(() => {});
      await pg.selectOption('#cboAnio', { label: anioT }).catch(() => {});
      await pg.locator('#cboAnio').evaluate(fire).catch(() => {});
      await pg.locator('input[name="numeroTitulo"]').fill(numeroT).catch(() => {});
      await pg.locator('input[name="numeroTitulo"]').evaluate(fire).catch(() => {});
      // Poll del Turnstile a 400ms (antes 1000ms): mismo tope (~20s) pero exit más rápido. Se repite
      // por CADA título → en autos con varios títulos el ahorro se multiplica.
      for (let i = 0; i < 50; i++) { if (await pg.locator('input[name="cf-turnstile-response"]').first().inputValue({ timeout: 400 }).catch(() => '')) break; await wait(400); }
      const buscar = pg.locator('button:has-text("BUSCAR")').first();
      if (!(await buscar.isEnabled().catch(() => false))) { await aceptarTC(pg); await wait(500); }
      if (!(await buscar.isEnabled().catch(() => false))) return null;
      const respP = pg.waitForResponse((r) => /listarAsientos/i.test(r.url()), { timeout: 70000 }).catch(() => null);
      await buscar.click().catch(() => {});
      // En vez de wait(4000) ciego: espera a que aparezca la pestaña/botón del asiento (el resultado
      // real de Buscar). ⚠️ SOLO estos selectores: los links "Ver anotación"/"Acceder al asiento/TIVE"
      // NAVEGAN y rompen la captura (regresión).
      const asientoSel = 'button:has-text("Asiento de inscripción"), button:has-text("Asiento de inscripcion"), a:has-text("Asiento de inscripción"), a:has-text("Asiento de inscripcion"), [role="tab"]:has-text("Asiento")';
      await pg.locator(asientoSel).first().waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
      for (const txt of ['Asiento de inscripción', 'Asiento de inscripcion', 'Asiento']) {
        const el = pg.locator(`button:has-text("${txt}"), a:has-text("${txt}"), [role="tab"]:has-text("${txt}")`).first();
        if (await el.isVisible().catch(() => false)) { await el.click().catch(() => {}); break; }
      }
      // El "ojo" abre el asiento y dispara listarAsientos → espéralo (hasta 3s) en vez de wait(3000) fijo.
      const ojo = pg.locator('button:has(i.fa-eye), a:has(i.fa-eye), .fa-eye, button.btn-success, [title*="ver" i], [title*="asiento" i]').first();
      await ojo.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
      if (await ojo.isVisible().catch(() => false)) { await ojo.click().catch(() => {}); }
      const resp = await respP; // la respuesta listarAsientos ES la señal real de "listo"
      if (!resp) return null;
      const body = (await resp.json().catch(() => null)) as { cmVzcG9uc2U?: string } | null;
      const dec = body?.cmVzcG9uc2U ? sgDecrypt(body.cmVzcG9uc2U) : null;
      // Depuración: vuelca el JSON descifrado de listarAsientos SIN los bytes del PDF, para ver
      // si trae los actos ya estructurados (código+descripción+participantes) → fuente limpia
      // para el parser multi-acto en vez de raspar el texto del PDF.
      if (process.env.SIGUELO_DEBUG && dec) log(`  [DEBUG listarAsientos ${anioT}-${numeroT}] ${dec.replace(/"paginaAsiento":\s*\[[-\d,\s]*\]/g, '"paginaAsiento":"<bytes>"').slice(0, 4000)} [/DEBUG]`);
      const obj = dec ? (JSON.parse(dec) as { list?: Array<{ paginaAsiento?: number[] }> }) : null;
      const bytes = obj?.list?.[0]?.paginaAsiento;
      const text = Array.isArray(bytes) ? pdfBytesToText(bytes) : null;
      // Candidato a captura: el asiento CON ficha (calidad 2) gana sobre cualquiera (calidad 1); a igual
      // calidad, el más reciente. Se guarda solo el mejor (bytes) y se rasteriza UNA vez al final. Así
      // funciona en secuencial y en paralelo, y los autos antiguos sin ficha igual capturan un asiento.
      if (Array.isArray(bytes) && text && opts.shotPath) {
        const quality = parseCaracteristicas(text) ? 2 : 1;
        const recency = (Number(anioT) || 0) * 1e8 + (Number(numeroT) || 0);
        const c = shotCandidate;
        if (!c || quality > c.quality || (quality === c.quality && recency > c.recency)) {
          shotCandidate = { bytes, quality, recency };
        }
      }
      return text;
    }

    const valid = titulos.map((t) => t.split('-')).filter((p) => p[0] && p[1]) as Array<[string, string]>;
    const records: AsientoRecord[] = [];
    const procesar = (text: string | null, tit: string) => {
      if (!text) return;
      // Depuración (SIGUELO_DEBUG=1): vuelca SOLO el texto legible del asiento para afinar el parser.
      // `pdfBytesToText` deja una cola de bytes de la imagen del PDF (basura `ÿÿÿ`/`�`); el `�` (U+FFFD)
      // aparece SOLO en esa cola → cortamos ahí, quitamos lo no imprimible y acotamos. Antes volcaba
      // decenas de miles de chars binarios al log (ilegible). En prod, apagar SIGUELO_DEBUG lo elimina.
      if (process.env.SIGUELO_DEBUG) {
        const clean = text.split('�')[0]!.replace(/[^\t\x20-\x7EÀ-ſ°º]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1600);
        log(`  [DEBUG asiento ${tit}] ${clean} [/DEBUG]`);
      }
      // Un título puede traer VARIOS asientos (p. ej. Compra-Venta + Cancelación de Afectación) → todos.
      for (const rec of parseAsientos(text)) {
        records.push(rec);
        log(`  ${tit}: ${rec.acto || rec.tipo} · ${rec.precio || 's/precio'} · ${rec.fechaPresentacion}`);
      }
    };

    if (opts.parallel && valid.length > 1) {
      // PARALELO (opt-in): una pestaña por título, concurrencia 2, con stagger para
      // no disparar varios Turnstile a la vez. ⚠️ Validar con el operador presente.
      log(`Síguelo en paralelo (${valid.length} títulos, conc. 2)…`);
      const CONC = 2;
      for (let i = 0; i < valid.length; i += CONC) {
        const batch = valid.slice(i, i + CONC);
        const out = await Promise.all(batch.map(async ([aT, nT], k) => {
          await wait(k * 1800);
          // Log ANTES de abrir la pestaña: si `ctx.newPage()` revienta (Chrome compartido cerrado a mitad
          // de Síguelo → "Target closed"), este es el último rastro y señala en qué título murió.
          log(`Síguelo ${aT}-${nT}…`);
          const pg = await ctx.newPage();
          try {
            let text = await searchSiguelo(pg, aT, nT).catch(() => null);
            if (!text) text = await searchSiguelo(pg, aT, nT).catch(() => null);
            log(`  ${aT}-${nT}: ${text ? 'asiento OK' : 'sin asiento'}`);
            return { tit: `${aT}-${nT}`, text };
          }
          finally { await pg.close().catch(() => {}); }
        }));
        for (const r of out) procesar(r.text, r.tit);
      }
    } else {
      // SECUENCIAL (default, validado): una sola pestaña reutilizada.
      const sg = await ctx.newPage();
      for (const [aT, nT] of valid) {
        log(`Síguelo ${aT}-${nT}…`);
        let text = await searchSiguelo(sg, aT, nT).catch(() => null);
        if (!text) { log(`  ${aT}-${nT}: sin asiento → reintento`); text = await searchSiguelo(sg, aT, nT).catch(() => null); }
        procesar(text, `${aT}-${nT}`);
      }
      await sg.close().catch(() => {});
    }

    // CAPTURA del historial: rasteriza (una vez) el asiento elegido — el más reciente CON ficha técnica
    // si hay, o el asiento más reciente si ninguno la trae (autos antiguos). Sobrescribe la captura de
    // SUNARP en historial.png → la miniatura del historial es SIEMPRE un asiento de Síguelo.
    // Cast: TS no rastrea la asignación hecha dentro del closure `searchSiguelo`, así que aquí lo cree
    // siempre null. El cast restaura el tipo real (la asignación sí ocurre en runtime).
    const cand = shotCandidate as { bytes: number[]; quality: number; recency: number } | null;
    if (cand && opts.shotPath) {
      await renderAsientoShot(ctx, cand.bytes, opts.shotPath).catch(() => {});
      log(`  captura del historial → historial.png (${cand.quality === 2 ? 'asiento con ficha' : 'asiento más reciente'})`);
    }

    const timeline = construirTimeline(records);
    // Ficha técnica: del asiento MÁS RECIENTE que la traiga (así refleja el estado actual —
    // p. ej. tras conversión a GNV o cambio de color— y no la ficha original de 2015). El
    // timeline va de más antiguo a más reciente, por eso se recorre de atrás hacia adelante.
    let caracteristicas: VehicleSpecs | null = null;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const c = timeline[i]?.caracteristicas;
      if (c) { caracteristicas = { ...c, sourceTitle: timeline[i]?.titulo ?? null }; break; }
    }
    const flags = {
      aseguradora: records.some((r) => r.flags.aseguradora),
      remate: records.some((r) => r.flags.remate),
      financiera: records.some((r) => r.flags.financiera),
      gravamen: records.some((r) => r.flags.gravamen),
      embargo: records.some((r) => r.flags.embargo),
    };
    return { ok: records.length > 0, sede: oficina, vehiculo, titulos, timeline, caracteristicas, flags };
  } catch (e) {
    const msg = (e as Error).message;
    // LOG del error (antes solo se devolvía en `error` → invisible en el .log de la fuente, sobre todo en
    // el pool continuo). Con esto la causa real aparece en "Logs por fuente → historial".
    log(`historial ERROR: ${msg}`);
    // Captura de diagnóstico best-effort. En la ruta single/lote `shotPath` = <outDir>/historial.png → el
    // panel "Capturas por fuente" la muestra. Si el Chrome ya murió (p. ej. "Target closed") la captura no
    // sale, pero el mensaje de arriba YA quedó en el log.
    const errShot = opts.shotPath ?? `${PROFILE}/_historial-error.png`;
    if (errPage) { const ok = await errPage.screenshot({ path: errShot, fullPage: true }).then(() => true).catch(() => false); if (ok) log(`captura de error → ${errShot}`); }
    return { ...empty, sede: oficina, vehiculo, error: msg };
  } finally {
    if (sprlRespOff) sprlRespOff(); // desengancha el listener REST (el `page` se reusa entre placas en el pool)
    // Solo cerramos lo que ESTA función LANZÓ: si reusamos un Chrome caliente (connect-first) o nos lo
    // pasó el caller (modo lote/pool), la sesión queda viva. Cerrarlo mataría el keep-alive / el pool.
    if (browser && spawned) await browser.close().catch(() => {});
  }
}
