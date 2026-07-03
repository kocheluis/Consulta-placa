/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import { chromium, type Browser } from 'playwright';
import { findChrome, chromeFlags } from './chrome-path.js';
import { parseAtuFields } from './sources.js';

/**
 * ATU (uso taxi/transporte) por HÍBRIDO CDP — la misma vía que destraba SUNARP.
 *
 * ATU protege la consulta con **reCAPTCHA v3 (invisible, por score)**. Un token de
 * CapSolver o un navegador headless puntúan bajo → ATU responde "Verificar re-captcha"
 * y no devuelve datos. En cambio, un **Chrome real** (sin banderas de automatización) desde
 * una **IP residencial** deja que el `grecaptcha.execute()` NATIVO genere un token con score
 * alto → ATU sí responde. Playwright se conecta por CDP (no lanza el navegador) y NO inyecta
 * ningún token: solo llena la placa y pulsa Buscar; el reCAPTCHA lo resuelve el propio sitio.
 *
 * OJO: depende de la reputación de la IP. Desde el VPS (datacenter) el score será bajo; corre
 * este source desde la PC del operador (IP residencial) o con un proxy residencial.
 */

const URL = 'https://soluciones.atu.gob.pe/ConsultaVehiculo';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CdpAtuOptions {
  /** Puerto de depuración remota (default 9226 / env CDP_ATU_PORT). */
  port?: number;
  /** Perfil de Chrome (persiste reputación/cookies entre placas). */
  profileDir?: string;
  /** Cuántos reintentos si el reCAPTCHA rechaza por score (default 2 → 3 intentos). */
  retries?: number;
  /** Segundos de "reposo" tras cargar la página antes de la 1ª consulta (default 4500ms).
   *  El reCAPTCHA v3 puntúa el tiempo en página + interacción: entrar y consultar de
   *  inmediato baja el score → sube el 1er intento fallido. Dejarlo respirar lo mejora. */
  warmupMs?: number;
  /** Recarga previa para madurar el score del v3 antes de la 1ª consulta (default true).
   *  Evita el cold-start del primer execute() (que suele fallar). */
  primeReload?: boolean;
  /** Ruta para guardar screenshot del resultado. */
  shotPath?: string;
  log?: (msg: string) => void;
}

export interface CdpAtuResult {
  ok: boolean;
  /** ENCONTRADO = habilitado como transporte; SIN_REGISTRO = no figura; ERROR = no se pudo. */
  status: 'ENCONTRADO' | 'SIN_REGISTRO' | 'ERROR';
  data?: Record<string, unknown>;
  error?: string;
}

/** Conecta a un Chrome ya abierto en el puerto; si no hay, lanza uno limpio en la URL de ATU. */
async function connectOrLaunch(port: number, profileDir: string, chrome: string, log: (m: string) => void): Promise<Browser> {
  try {
    const b = await chromium.connectOverCDP(`http://localhost:${port}`);
    log(`reusando Chrome CDP en :${port} (reputación persistida)`);
    return b;
  } catch {
    log(`lanzando Chrome limpio (CDP :${port})…`);
    const proc = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, ...chromeFlags(), URL], { detached: false, stdio: 'ignore' });
    proc.on('error', (e) => log(`spawn chrome: ${e.message}`));
    for (let i = 0; i < 20; i++) {
      await wait(700);
      try { return await chromium.connectOverCDP(`http://localhost:${port}`); } catch { /* aún no abre */ }
    }
    throw new Error('no pude conectar al Chrome CDP de ATU (¿se abrió la ventana?)');
  }
}

/** Mutex por puerto: evita dos scrapes ATU concurrentes sobre el mismo perfil/puerto. */
const portQueues = new Map<number, Promise<void>>();
async function acquirePortLock(port: number): Promise<() => void> {
  const prev = portQueues.get(port) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  portQueues.set(port, prev.then(() => mine));
  await prev;
  return release;
}

export async function scrapeAtuViaCdp(plateRaw: string, opts: CdpAtuOptions = {}): Promise<CdpAtuResult> {
  const log = opts.log ?? (() => {});
  const plate = plateRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const chrome = findChrome();
  if (!chrome) return { ok: false, status: 'ERROR', error: 'No encontré chrome.exe. Instala Google Chrome.' };
  const port = opts.port ?? Number(process.env.CDP_ATU_PORT ?? 9226);
  const profileDir = opts.profileDir ?? process.env.CDP_ATU_PROFILE ?? `${process.cwd()}/.cdp-atu-profile`;
  const retries = Math.max(0, opts.retries ?? 2);

  const releaseLock = await acquirePortLock(port);
  let browser: Browser | null = null;
  try {
    browser = await connectOrLaunch(port, profileDir, chrome, log);
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

    // Banner de cookies: si NO se acepta, el portal no deja escribir la placa.
    const acceptCookies = async (): Promise<void> => {
      await page.locator('button:has-text("Acepto cookies"), button:has-text("Aceptar"), button:has-text("Acepto"), a:has-text("Acepto cookies")')
        .first().click({ timeout: 5000 }).catch(() => {});
    };
    const plateInput = page.locator('input#placa, input[name*="laca" i], input[placeholder*="laca" i], input[formcontrolname*="laca" i]').first();
    // Gestos de mouse "humanos": el v3 sube el score con señales de interacción reales.
    const humanize = async (): Promise<void> => {
      await page.mouse.move(200, 220).catch(() => {});
      await wait(280);
      await page.mouse.move(460, 380).catch(() => {});
      await wait(220);
    };

    // Reposo inicial + gestos: el v3 puntúa tiempo-en-página e interacción antes del execute().
    const warmupMs = Math.max(0, opts.warmupMs ?? 4500);
    await acceptCookies();
    await humanize();
    log(`reposo inicial ${warmupMs}ms + gestos (calienta el score del v3)…`);
    await wait(warmupMs);

    // PRIME del reCAPTCHA v3: el PRIMER execute() de una sesión nueva puntúa bajo (cold start) →
    // por eso "falla el 1er intento y pasa al recargar". Una recarga previa (mismo cookie de
    // sesión, 2º pageview) madura el score, así la 1ª consulta REAL ya es el "segundo challenge".
    if (opts.primeReload ?? true) {
      log('prime: recarga previa para madurar el score del v3…');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await acceptCookies();
      await humanize();
      await wait(Math.min(warmupMs, 3000));
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        log(`reCAPTCHA rechazó (score bajo) → recarga ${attempt}/${retries}…`);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      }
      await wait(1200);
      await acceptCookies();
      await wait(500);
      await plateInput.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
      await humanize();
      await plateInput.fill(plate).catch((e) => log(`fill: ${(e as Error).message}`));
      await wait(900);
      await humanize();
      // Clic en Buscar → dejamos que el reCAPTCHA v3 NATIVO se ejecute (sin inyectar token).
      await page.locator('button:has-text("Buscar"), button[type="submit"]').first().click().catch(() => {});
      await wait(7000);
      await page.waitForLoadState('networkidle').catch(() => {});

      const body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
      if (/verificar\s*re-?captcha/i.test(body)) continue; // score bajo → reintenta
      const done = /consultar otra placa|fecha y hora de consulta/i.test(body);
      if (!done) continue; // respuesta no reconocida → reintenta

      // Los campos del resultado son inputs readonly: sus valores NO salen en innerText.
      const fieldVals = String((await page.evaluate(
        `Array.from(document.querySelectorAll('input')).map(function(i){return i.value}).filter(function(v){return v&&v.trim()}).join(' | ')`,
      ).catch(() => '')) || '');
      if (opts.shotPath) await page.screenshot({ path: opts.shotPath, fullPage: true }).catch(() => {});
      const blob = `${body} | ${fieldVals}`;
      if (/no\s*registrad/i.test(blob)) {
        return { ok: true, status: 'SIN_REGISTRO', data: { isPublicTransport: false, detalleCampos: fieldVals } };
      }
      const atu = parseAtuFields(fieldVals);
      return {
        ok: true, status: 'ENCONTRADO',
        data: { isPublicTransport: true, modalidad: atu.modalidad, estado: atu.estado, titular: atu.titular, detalleCampos: fieldVals },
      };
    }
    if (opts.shotPath) await page.screenshot({ path: opts.shotPath, fullPage: true }).catch(() => {});
    return { ok: false, status: 'ERROR', error: `reCAPTCHA v3 rechazado tras ${retries + 1} intento(s) (¿IP no residencial?)` };
  } catch (e) {
    return { ok: false, status: 'ERROR', error: (e as Error).message };
  } finally {
    // Desconecta CDP pero NO mata el Chrome → conserva reputación/cookies para la próxima placa.
    if (browser) await browser.close().catch(() => {});
    releaseLock();
  }
}
