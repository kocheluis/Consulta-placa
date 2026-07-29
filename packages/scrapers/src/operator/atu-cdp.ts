/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import { chromium, type Browser } from 'playwright';
import { findChrome, chromeFlags } from './chrome-path.js';
import { parseAtuFields } from './sources.js';
import { proxyForSource, proxyServerArg } from './proxy.js';
import { startProxyForwarder, type ProxyForwarder } from './proxy-forwarder.js';

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
  /** "Reposo" tras cargar la página antes de la 1ª consulta (default 3000ms): da tiempo a que
   *  cargue el script del reCAPTCHA y suma señal de interacción. NO evita el cold-start del v3
   *  (eso lo cubre el bucle de reintentos), solo ayuda a que el grecaptcha esté listo al clic. */
  warmupMs?: number;
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

// Forwarder local para ENGINE_PROXY con credenciales: Chrome NO acepta user:pass en --proxy-server,
// así que se abre un mini-proxy en 127.0.0.1 (sin auth) que reenvía al upstream CON auth. Singleton
// por proceso: el Chrome de ATU queda parqueado usándolo entre placas; si cambia el ENGINE_PROXY,
// se recicla.
let atuForwarder: ProxyForwarder | null = null;
let atuForwarderKey = '';

/**
 * Resuelve el `--proxy-server` para el Chrome de ATU:
 *  1. `ATU_PROXY`/`CDP_PROXY` explícito (host:port por WHITELIST de IP) — prioridad, camino previo.
 *  2. `ENGINE_PROXY` compartido, si 'atu' está en PROXY_SOURCES (default sí): sin credenciales va
 *     directo; CON credenciales pasa por el forwarder local (túnel con auth).
 * '' = sin proxy (comportamiento de siempre: IP del VPS).
 */
async function resolveAtuProxy(log: (m: string) => void): Promise<string> {
  const explicit = process.env.ATU_PROXY || process.env.CDP_PROXY || '';
  if (explicit) return explicit;
  const cfg = proxyForSource('atu');
  if (!cfg) return '';
  if (!cfg.username) return proxyServerArg(cfg) ?? '';
  const key = `${cfg.server}|${cfg.username}`;
  if (!atuForwarder || atuForwarderKey !== key) {
    if (atuForwarder) await atuForwarder.close().catch(() => {});
    atuForwarder = await startProxyForwarder(cfg);
    atuForwarderKey = key;
    log(`forwarder local 127.0.0.1:${atuForwarder.port} → ${cfg.server} (con auth; Chrome no acepta user:pass)`);
  }
  return `127.0.0.1:${atuForwarder.port}`;
}

/** Conecta a un Chrome ya abierto en el puerto; si no hay, lanza uno limpio en la URL de ATU. */
async function connectOrLaunch(port: number, profileDir: string, chrome: string, log: (m: string) => void): Promise<Browser> {
  try {
    const b = await chromium.connectOverCDP(`http://localhost:${port}`);
    log(`reusando Chrome CDP en :${port} (reputación persistida)`);
    // El proxy se aplica AL LANZAR Chrome: uno ya parqueado conserva el proxy (o la falta de él) de
    // su lanzamiento. Aviso para no perseguir fantasmas si acaban de configurar el proxy.
    if (process.env.ATU_PROXY || process.env.CDP_PROXY || proxyForSource('atu')) {
      log(`⚠ proxy configurado pero Chrome ya estaba abierto: aplica el del LANZAMIENTO original. Si lo acabas de configurar: pkill -f "remote-debugging-port=${port}" y reintenta.`);
    }
    return b;
  } catch {
    log(`lanzando Chrome limpio (CDP :${port})…`);
    // Proxy RESIDENCIAL: el reCAPTCHA v3 de ATU puntúa por reputación de IP → desde el VPS
    // (datacenter) el score es bajo y rechaza. ATU_PROXY/CDP_PROXY (whitelist) o ENGINE_PROXY
    // (credenciales → forwarder local). Sin proxy → sin cambio (IP del VPS).
    const proxy = await resolveAtuProxy(log);
    if (proxy) log(`vía proxy residencial ${proxy}`);
    const flags = [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, ...chromeFlags(), ...(proxy ? [`--proxy-server=${proxy}`] : []), URL];
    const proc = spawn(chrome, flags, { detached: false, stdio: 'ignore' });
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
    let navErr = '';
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => { navErr = (e as Error).message; });
    // Proxy muerto / túnel roto (ERR_PROXY_CONNECTION_FAILED, ERR_TUNNEL, ERR_SOCKS…): Chrome no carga
    // NADA — sin este corte, los reintentos queman ~90s para acabar culpando (mal) al reCAPTCHA v3.
    // Caso real: un ATU_PROXY=socks5://localhost:1080 huérfano (gost apagado) tapando al ENGINE_PROXY.
    if (/ERR_(PROXY|TUNNEL|SOCKS)/i.test(navErr)) {
      const code = /net::\S+/.exec(navErr)?.[0] ?? navErr;
      return { ok: false, status: 'ERROR', error: `el proxy configurado no responde (${code}). Revisa ATU_PROXY/CDP_PROXY/ENGINE_PROXY en el env (¿quedó un socks5://localhost viejo sin su forwarder corriendo?).` };
    }

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

    // Reposo inicial + gestos: da tiempo a que cargue el script del reCAPTCHA y suma señal de
    // interacción. OJO: el v3 de ATU necesita DOS execute() (el 1º "calienta" el score y el 2º
    // pasa); eso lo resuelve el bucle de reintentos, no el reposo. En PRODUCCIÓN el Chrome queda
    // vivo entre placas → tras la 1ª placa la sesión ya está madura y la 1ª consulta pasa directo.
    const warmupMs = Math.max(0, opts.warmupMs ?? 3000);
    await acceptCookies();
    await humanize();
    log(`reposo inicial ${warmupMs}ms + gestos…`);
    await wait(warmupMs);

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        log(`recarga ${attempt}/${retries} (madurando el score del v3)…`);
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
      // Sondea el resultado (rechazo del v3 o datos ya cargados) en vez de esperar un fijo largo:
      // así el intento de "calentamiento" (que sabemos que rebota) no desperdicia segundos.
      const RECAP = /verificar\s*re-?captcha/i;
      const DONE = /consultar otra placa|fecha y hora de consulta/i;
      let body = '';
      for (let k = 0; k < 20; k++) {
        await wait(500);
        body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
        if (RECAP.test(body) || DONE.test(body)) break;
      }
      if (RECAP.test(body)) { log(`intento ${attempt + 1}: v3 aún tibio (cold start) → reintento`); continue; }
      if (!DONE.test(body)) { log(`intento ${attempt + 1}: respuesta no reconocida → reintento`); continue; }

      // Los campos del resultado son inputs readonly: sus valores NO salen en innerText.
      const fieldVals = String((await page.evaluate(
        `Array.from(document.querySelectorAll('input')).map(function(i){return i.value}).filter(function(v){return v&&v.trim()}).join(' | ')`,
      ).catch(() => '')) || '');
      // El value del textarea g-recaptcha-response se cuela como un campo larguísimo sin espacios:
      // lo quitamos del detalle para no guardar ese token basura en el reporte del operador.
      const detalle = fieldVals.split(' | ').filter((v) => !(v.length > 80 && /^[A-Za-z0-9_-]+$/.test(v))).join(' | ');
      if (opts.shotPath) await page.screenshot({ path: opts.shotPath, fullPage: true }).catch(() => {});
      const blob = `${body} | ${detalle}`;
      if (/no\s*registrad/i.test(blob)) {
        return { ok: true, status: 'SIN_REGISTRO', data: { isPublicTransport: false, detalleCampos: detalle } };
      }
      const atu = parseAtuFields(detalle);
      return {
        ok: true, status: 'ENCONTRADO',
        data: {
          isPublicTransport: true, modalidad: atu.modalidad, estado: atu.estado,
          titular: atu.titular, documento: atu.documento, vigencia: atu.vigencia, detalleCampos: detalle,
        },
      };
    }
    if (opts.shotPath) await page.screenshot({ path: opts.shotPath, fullPage: true }).catch(() => {});
    return { ok: false, status: 'ERROR', error: `reCAPTCHA v3 rechazó la IP tras ${retries + 1} intento(s) — el score de la IP del VPS (datacenter) es bajo. Requiere IP residencial: configura ATU_PROXY (proxy residencial con IP whitelisteada) o corre esta fuente desde la PC.` };
  } catch (e) {
    return { ok: false, status: 'ERROR', error: (e as Error).message };
  } finally {
    // Desconecta CDP pero NO mata el Chrome → conserva reputación/cookies para la próxima placa.
    if (browser) await browser.close().catch(() => {});
    releaseLock();
  }
}
