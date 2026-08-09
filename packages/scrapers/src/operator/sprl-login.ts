import type { Page, BrowserContext } from 'playwright';

/**
 * Login y estado de sesión de SPRL, CENTRALIZADOS. Es la MISMA lógica que usaba el historial (extraída
 * de historial.ts) para que el motor, el keep-alive y el seed compartan un solo login → si cambia la
 * detección de lockout o el flujo del form, cambia en un solo lugar (antes divergían).
 *
 * NO hace spawn ni cierra el browser: recibe una `page` de un Chrome ya abierto por CDP; el caller
 * maneja el ciclo de vida del navegador.
 */

const INGRESO = 'https://sprl.sunarp.gob.pe/sprl/ingreso';
// Sesión ACTIVA: el body de la SPA logueada muestra alguno de estos textos.
const RX_VIVA = /SALDO|BUSCAR SERVICIOS|CERRAR SESI|HOLA/;
// SUNARP bloquea la cuenta tras varios intentos ("Se superó el número de intentos…"). Si aparece hay
// que ABORTAR sin re-someter: cada intento extra agrava/prolonga el bloqueo por IP.
const RX_LOCK = /super[oó].{0,15}n[uú]mero de intentos|vuelva m[aá]s tarde|intente.{0,12}m[aá]s tarde|demasiados intentos|cuenta.{0,25}bloqueada/i;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// innerText SIN timeout usa el default de Playwright (30s). En un Chrome contendido (varios Chromes en
// 1 vCPU) cada lectura puede agotar esos 30s; en el bucle de 45 chequeos de login eso son ~22 min de
// cuelgue Y, peor, cada timeout devuelve '' → isLogged=false FALSO → force-clear de una sesión válida +
// re-login → riesgo de lockout por IP. Acotamos a 4s: un body sano se lee en <100ms; si tarda más, el
// Chrome está trabado, no solo lento → falla rápido en vez de colgar.
const bodyText = (page: Page, timeout = 4000): Promise<string> => page.locator('body').innerText({ timeout }).catch(() => '');

/** ¿La sesión SPRL está activa (logueada) en esta página? */
export async function sprlIsLogged(page: Page): Promise<boolean> {
  return RX_VIVA.test((await bodyText(page)).toUpperCase());
}
/** ¿SUNARP muestra el mensaje de bloqueo por exceso de intentos? */
export async function sprlIsLocked(page: Page): Promise<boolean> {
  return RX_LOCK.test(await bodyText(page));
}

export interface SprlLoginOpts {
  user: string;
  pass: string;
  log?: (m: string) => void;
  /** Ruta para el screenshot del form cuando falla (opcional). */
  shotPath?: string;
}
export interface SprlLoginResult {
  /** Sesión activa al terminar. */
  ok: boolean;
  /** SUNARP bloqueó la cuenta por IP (exceso de intentos) → NO reintentar en bucle (agrava el bloqueo). */
  locked: boolean;
}

/**
 * Asegura una sesión SPRL logueada en `page` (Chrome ya abierto por CDP). Si ya está logueada, no hace
 * nada. Si no, fuerza el form de login (limpia storage+cookies), llena creds, espera el Turnstile del
 * login si lo pide, envía y verifica. Nunca lanza. `locked=true` = bloqueo por IP.
 */
export async function sprlLogin(page: Page, ctx: BrowserContext, opts: SprlLoginOpts): Promise<SprlLoginResult> {
  const log = opts.log ?? (() => {});
  const { user, pass } = opts;
  const passVisible = async (): Promise<boolean> => page.locator('input[type="password"]:visible').first().isVisible().catch(() => false);

  if (await sprlIsLogged(page)) return { ok: true, locked: false };
  if (!user || !pass) { log('sin credenciales SPRL (user/pass)'); return { ok: false, locked: false }; }

  // Forzar el FORM de login directo: limpiar storage+cookies → la SPA redirige al login (path
  // probado). El token del SPRL vive en localStorage, por eso esto desloguea de verdad y muestra el
  // formulario (más fiable que clic en INGRESAR).
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
    //  1) La sesión VOLVIÓ: el force-clear + goto disparó el re-auth OAuth (el SSO seguía vivo) y
    //     SUNARP re-logueó solo → es ÉXITO, no fallo (fue el bug de M4S859: sesión viva pero isLogged
    //     tardó >25s en renderizar tras el redirect).
    //  2) Lockout: SUNARP muestra "se superó el número de intentos" en vez del form.
    //  3) Otra cosa (cambio de página / red): logueo qué sirvió para poder diagnosticar.
    if (await sprlIsLogged(page)) { log('sesión recuperada por re-auth (sin form de login)'); return { ok: true, locked: false }; }
    const bodySnippet = (await bodyText(page, 5000)).replace(/\s+/g, ' ').trim().slice(0, 200);
    const locked = await sprlIsLocked(page);
    if (locked) log('SPRL bloqueada por SUNARP (exceso de intentos) — sin form de login; no reintento');
    else log(`no apareció el form de login · url=${page.url()} · body="${bodySnippet}"`);
    if (opts.shotPath) await page.screenshot({ path: opts.shotPath, fullPage: true }).catch(() => {});
    return { ok: false, locked };
  }
  if (await sprlIsLocked(page)) { log('SPRL bloqueada por SUNARP (exceso de intentos) — NO intento login para no agravarlo'); return { ok: false, locked: true }; }

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
  for (let i = 0; i < 18 && !(await sprlIsLogged(page)); i++) await wait(1000);
  if (!(await sprlIsLogged(page))) {
    // Antes de re-someter, verifica que SUNARP no nos haya bloqueado: si sí, ABORTAR (otro Enter =
    // otro intento = agrava el bloqueo por IP).
    if (await sprlIsLocked(page)) { log('SPRL: "se superó el número de intentos" → aborto (no reintento)'); return { ok: false, locked: true }; }
    await pf.press('Enter').catch(() => {});
    for (let i = 0; i < 12 && !(await sprlIsLogged(page)); i++) await wait(1000);
  }
  const ok = await sprlIsLogged(page);
  const locked = !ok && (await sprlIsLocked(page));
  return { ok, locked };
}
