/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { chromium, type Page, type Locator, type Browser } from 'playwright';
import { parseAsientos, pdfBytesToText, construirTimeline, type AsientoRecord } from './asiento-parser.js';
import type { VehicleSpecs } from '@app/shared';
import { scrapeSunarpViaCdp } from './cdp-sunarp.js';
import { findChrome, chromeFlags } from './chrome-path.js';

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

async function pickNzSelect(sel: Locator, page: Page, optionText: RegExp): Promise<void> {
  await sel.locator('.ant-select-selector').first().click({ timeout: 5000 }).catch(() => {});
  await wait(500);
  const opt = page.locator('.ant-select-item-option-content', { hasText: optionText }).first();
  await opt.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  await opt.click().catch(() => {});
  await wait(800);
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
  if (!reuseBrowser) {
    log(`Chrome SPRL (CDP :${PORT})…`);
    const proc = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...chromeFlags(), INGRESO], { detached: false, stdio: 'ignore' });
    proc.on('error', (e) => log(`spawn: ${e.message}`));
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

  try {
    for (let i = 0; i < 20 && !browser; i++) { await wait(700); try { browser = await chromium.connectOverCDP(`http://localhost:${PORT}`); } catch { /* retry */ } }
    if (!browser) return { ...empty, sede: oficina, vehiculo, error: 'no conecté al Chrome SPRL' };
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());

    // ── [2] SPRL: login (la sesión ya debería estar asentada por el spawn temprano) ──
    const isLogged = async () => /SALDO|BUSCAR SERVICIOS|CERRAR SESI|HOLA/.test((await page.locator('body').innerText().catch(() => '')).toUpperCase());
    const passVisible = async () => page.locator('input[type="password"]:visible').first().isVisible().catch(() => false);
    // SUNARP bloquea la cuenta tras varios intentos ("Se superó el número de intentos…").
    // Si aparece, hay que ABORTAR sin re-someter: cada intento extra agrava/prolonga el bloqueo.
    const RX_LOCK = /super[oó].{0,15}n[uú]mero de intentos|vuelva m[aá]s tarde|intente.{0,12}m[aá]s tarde|demasiados intentos|cuenta.{0,25}bloqueada/i;
    const isLocked = async () => RX_LOCK.test(await page.locator('body').innerText().catch(() => ''));
    let blockReason = '';
    async function autoLogin(): Promise<boolean> {
      if (await isLogged()) return true;
      if (!user || !pass) { log('sin SPRL_USER/SPRL_PASS en el entorno'); return false; }
      // Forzar el FORM de login directo: limpiar storage+cookies → la SPA redirige al
      // login (path probado). El token del SPRL vive en localStorage, por eso esto
      // desloguea de verdad y muestra el formulario (más fiable que clic en INGRESAR).
      if (!(await passVisible())) {
        await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* */ } }).catch(() => {});
        await ctx.clearCookies().catch(() => {});
        await page.goto(INGRESO, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        for (let i = 0; i < 25 && !(await passVisible()); i++) await wait(1000);
      }
      // Fallback: clic en INGRESAR de la home.
      if (!(await passVisible())) {
        await page.locator('a:has-text("INGRESAR"), button:has-text("INGRESAR"), a:has-text("Acceder")').first().click({ timeout: 6000 }).catch(() => {});
        for (let i = 0; i < 15 && !(await passVisible()); i++) await wait(1000);
      }
      if (!(await passVisible())) {
        // SIN form de login = 3 casos, hay que distinguirlos:
        //  1) La sesión VOLVIÓ: el force-clear + goto disparó el re-auth OAuth (el SSO
        //     seguía vivo) y SUNARP re-logueó solo → es ÉXITO, no fallo. Fue el bug de
        //     M4S859 (sesión viva, pero isLogged tardó >25s en renderizar tras el redirect).
        //  2) Lockout: SUNARP muestra "se superó el número de intentos" en vez del form.
        //  3) Otra cosa (cambio de página / red): logueo qué sirvió para poder diagnosticar.
        if (await isLogged()) { log('sesión recuperada por re-auth (sin form de login) → sigo'); return true; }
        const bodySnippet = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 200);
        if (await isLocked()) { blockReason = 'lockout'; log('SPRL bloqueada por SUNARP (exceso de intentos) — sin form de login; no reintento'); }
        else log(`no apareció el form de login · url=${page.url()} · body="${bodySnippet}"`);
        await page.screenshot({ path: `${PROFILE}/_login.png`, fullPage: true }).catch(() => {});
        return false;
      }
      if (await isLocked()) { blockReason = 'lockout'; log('SPRL bloqueada por SUNARP (exceso de intentos) — NO intento login para no agravarlo'); return false; }
      const pf = page.locator('input[type="password"]:visible').first();
      await page.locator('input[name*="usuario" i], input[formcontrolname*="usuario" i], input[type="text"]:visible').first().fill(user).catch(() => {});
      await pf.fill(pass).catch(() => {});
      log('login automático (creds de entorno)…');
      let lt = '';
      for (let i = 0; i < 12 && !lt; i++) { await wait(1000); lt = await page.locator('input[name="cf-turnstile-response"]').first().inputValue({ timeout: 800 }).catch(() => ''); }
      log(lt ? `Turnstile login ok (${lt.length})` : 'login sin token Turnstile (este login no lo requiere)');
      const ing = page.locator('button:has-text("INGRESAR"), button:has-text("Ingresar"), button[type="submit"], input[type="submit"]');
      let clicked = false;
      for (let i = 0; i < (await ing.count().catch(() => 0)); i++) { const b = ing.nth(i); if ((await b.isVisible().catch(() => false)) && (await b.isEnabled().catch(() => false))) { await b.click().catch(() => {}); clicked = true; break; } }
      if (!clicked) await pf.press('Enter').catch(() => {});
      for (let i = 0; i < 18 && !(await isLogged()); i++) await wait(1000);
      if (!(await isLogged())) {
        // Antes de re-someter, verifica que SUNARP no nos haya bloqueado: si sí, ABORTAR
        // (otro Enter = otro intento = agrava el bloqueo por IP).
        if (await isLocked()) { blockReason = 'lockout'; log('SPRL: "se superó el número de intentos" → aborto (no reintento)'); return false; }
        await pf.press('Enter').catch(() => {});
        for (let i = 0; i < 12 && !(await isLogged()); i++) await wait(1000);
      }
      if (!(await isLogged()) && (await isLocked())) blockReason = 'lockout';
      return isLogged();
    }
    // Esperar a que la sesión activa se renderice. El re-auth OAuth puede tardar >25s en
    // VPS lento; si nos rendimos antes, autoLogin dispara un force-clear innecesario que
    // destruye una sesión que estaba por aparecer (fue el bug de M4S859) → 45s de margen.
    let logged = false;
    for (let i = 0; i < 45 && !logged; i++) { await wait(1000); logged = await isLogged(); }
    // Si sigue sin sesión (logout/expirada), login automático (autoLogin consigue el
    // form solo vía force-clear; un re-login sobre sesión válida también es inocuo).
    if (!logged) { log('sin sesión activa → login automático'); logged = await autoLogin(); }
    if (!logged) {
      await page.screenshot({ path: `${PROFILE}/_login.png`, fullPage: true }).catch(() => {});
      const err = blockReason === 'lockout'
        ? 'Cuenta SPRL bloqueada por SUNARP desde el VPS (se superó el número de intentos de login). La cuenta está OK — es un límite temporal por IP. Espera ~1-2 h y reintenta UNA sola vez; no reintentes seguido.'
        : 'no se pudo iniciar sesión en SPRL (revisa SPRL_USER/SPRL_PASS, o el Turnstile del login pidió clic manual)';
      return { ...empty, sede: oficina, vehiculo, error: err, locked: blockReason === 'lockout' };
    }
    log('sesión SPRL activa');

    // Búsqueda SPRL (con espera del form post-login + reintento si no hay títulos).
    async function sprlBuscarTitulos(useOficina: boolean): Promise<string[]> {
      await page.goto(PARTIDA, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await page.locator('nz-select').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
      await wait(1500);
      await pickNzSelect(page.locator('nz-select').filter({ hasText: /propiedad/i }).first(), page, /propiedad vehicular/i);
      await wait(800);
      // Oficina: opcional. El SPRL busca por placa sin sede; solo se llena en el fallback.
      if (useOficina && oficina) {
        await pickSearchable(page.locator('nz-select').filter({ hasText: /seleccione/i }).first(), page, oficina);
        await wait(800);
      }
      await page.locator('label.ant-radio-wrapper', { hasText: /^placa$/i }).first().check().catch(() => {});
      await wait(500);
      const num = page.locator('#numero');
      await num.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      for (let i = 0; i < 3; i++) { await num.click().catch(() => {}); await num.fill('').catch(() => {}); await num.type(plate, { delay: 60 }).catch(() => {}); await wait(400); if ((await num.inputValue({ timeout: 1000 }).catch(() => '')) === plate) break; }
      for (let i = 0; i < 30; i++) { if (await page.locator('input[name="cf-turnstile-response"]').first().inputValue({ timeout: 1000 }).catch(() => '')) break; await wait(1000); }
      const respP = page.waitForResponse((r) => /mostrar-resultado-partida-veh/i.test(r.url()), { timeout: 30000 }).catch(() => null);
      const buscarBtns = page.locator('button:has-text("Buscar")');
      for (let i = 0; i < (await buscarBtns.count().catch(() => 0)); i++) { const b = buscarBtns.nth(i); if ((await b.isVisible().catch(() => false)) && (await b.isEnabled().catch(() => false))) { await b.click().catch(() => {}); break; } }
      await respP;
      await wait(2500);
      const rowBtns = page.locator('.ant-table-tbody tr button, table tbody tr button');
      if ((await rowBtns.count().catch(() => 0)) >= 2) { await rowBtns.nth(1).click().catch(() => {}); await wait(4000); }
      const bodyText = await page.locator('body').innerText().catch(() => '');
      return [...new Set((bodyText.match(/\b20\d{2}\s*-\s*\d{6,8}\b/g) ?? []).map((s) => s.replace(/\s+/g, '')))];
    }
    // Intento RÁPIDO: SPRL por placa SIN oficina (optimización). Si el caller ya dio la
    // sede, se usa directo. Si viene vacío, resolvemos la sede (SUNARP) y reintentamos
    // CON oficina (camino antiguo, seguro) → la optimización nunca degrada el resultado.
    let titulos = await sprlBuscarTitulos(!!oficina);
    if (!titulos.length) {
      log('SPRL sin resultados → resuelvo sede (SUNARP) y reintento con oficina…');
      await ensureSede();
      titulos = await sprlBuscarTitulos(true);
      if (!titulos.length) { log('reintento SPRL con oficina…'); titulos = await sprlBuscarTitulos(true); }
    }
    await ensureSede(); // Síguelo SIEMPRE necesita la sede
    log(`títulos: ${JSON.stringify(titulos)}`);

    // ── [3] Síguelo por cada título → asiento PDF → parser ──
    const fire = (el: Element) => { for (const t of ['input', 'change', 'blur']) el.dispatchEvent(new Event(t, { bubbles: true })); };
    const aceptarTC = async (pg: Page): Promise<void> => {
      const btn = pg.locator('button').filter({ hasText: /acepto/i }).filter({ hasNotText: /no\s*acepto/i }).first();
      if (await btn.isVisible().catch(() => false)) { await btn.click().catch(() => {}); await wait(700); return; }
      const link = pg.locator('a:has-text("ingresar"), a:has-text("términos"), a:has-text("terminos")').first();
      if (await link.isVisible().catch(() => false)) { await link.click().catch(() => {}); await wait(1200); await pg.locator('button').filter({ hasText: /acepto/i }).filter({ hasNotText: /no\s*acepto/i }).first().click().catch(() => {}); await wait(700); }
    };
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
      for (let i = 0; i < 20; i++) { if (await pg.locator('input[name="cf-turnstile-response"]').first().inputValue({ timeout: 800 }).catch(() => '')) break; await wait(1000); }
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
      return Array.isArray(bytes) ? pdfBytesToText(bytes) : null;
    }

    const valid = titulos.map((t) => t.split('-')).filter((p) => p[0] && p[1]) as Array<[string, string]>;
    const records: AsientoRecord[] = [];
    const procesar = (text: string | null, tit: string) => {
      if (!text) return;
      // Depuración (SIGUELO_DEBUG=1): vuelca el texto crudo COMPLETO del asiento para afinar la
      // extracción de características (N° de Versión, carrocería, cilindrada…) de "Identidad específica".
      // Sin recorte: las características de la Primera Inscripción pueden ir más allá de los 3000 chars.
      if (process.env.SIGUELO_DEBUG) log(`  [DEBUG asiento ${tit}] ${text} [/DEBUG]`);
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
          const pg = await ctx.newPage();
          try {
            let text = await searchSiguelo(pg, aT, nT).catch(() => null);
            if (!text) text = await searchSiguelo(pg, aT, nT).catch(() => null);
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
    return { ...empty, sede: oficina, vehiculo, error: (e as Error).message };
  } finally {
    // Solo cerramos lo que abrimos: en modo lote (browser del caller) la sesión queda caliente.
    if (browser && !reuseBrowser) await browser.close().catch(() => {});
  }
}
