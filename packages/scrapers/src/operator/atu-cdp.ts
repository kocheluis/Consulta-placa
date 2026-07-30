/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import { chromium, type Browser } from 'playwright';
import { findChrome, chromeFlags } from './chrome-path.js';
import { parseAtuFields } from './sources.js';
import { parseProxy, proxyServerArg, type ProxyConfig } from './proxy.js';
import { startProxyForwarder, type ProxyForwarder } from './proxy-forwarder.js';

/**
 * ATU (uso taxi/transporte) por HÍBRIDO CDP — la misma vía que destraba SUNARP.
 *
 * ATU protege la consulta con **reCAPTCHA v3 (invisible, por score)**. Un token de
 * CapSolver o un navegador headless puntúan bajo → ATU responde "Verificar re-captcha"
 * y no devuelve datos. En cambio, un **Chrome real** (sin banderas de automatización) desde
 * una **IP con buena reputación** deja que el `grecaptcha.execute()` NATIVO genere un token
 * con score alto → ATU sí responde. Playwright se conecta por CDP (no lanza el navegador) y
 * NO inyecta ningún token: solo llena la placa y pulsa Buscar.
 *
 * EGRESO DE RED — cadena de FALLBACK (orden pedido por el operador):
 *  1. DIRECTO con la IP del VPS — el v3 pasa nativo desde LightNode Perú (validado en vivo
 *     29-jul-2026) y no gasta datos de proxy.
 *  2. TÚNEL local → `ENGINE_PROXY` (forwarder con auth: Chrome no acepta user:pass en
 *     `--proxy-server`) — gasta datos del proxy residencial.
 *  3. PROXY explícito `ATU_PROXY`/`CDP_PROXY` (whitelist / socks, p. ej. un gost local).
 * El proxy solo puede fijarse AL LANZAR Chrome → cada egreso fallido mata el Chrome y relanza
 * con el siguiente. El Chrome del egreso que FUNCIONÓ queda parqueado (reputación caliente) →
 * los reportes siguientes entran directo por ese camino.
 */

const URL = 'https://soluciones.atu.gob.pe/ConsultaVehiculo';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CdpAtuOptions {
  /** Puerto de depuración remota (default 9226 / env CDP_ATU_PORT). */
  port?: number;
  /** Perfil de Chrome (persiste reputación/cookies entre placas). */
  profileDir?: string;
  /** Cuántos reintentos si el reCAPTCHA rechaza por score (default 2 → 3 intentos). Aplica al
   *  PRIMER egreso; los egresos de fallback usan 1 reintento (2 intentos) para no exceder el
   *  tope de tiempo de la fuente. */
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

// ── Egresos de red (cadena de fallback) ─────────────────────────────────────────────────────────

// Forwarder local para ENGINE_PROXY con credenciales. Singleton por proceso (se recicla si cambia
// el upstream): el Chrome de ATU queda parqueado usándolo entre placas.
let atuForwarder: ProxyForwarder | null = null;
let atuForwarderKey = '';
async function forwarderArg(cfg: ProxyConfig, log: (m: string) => void): Promise<string> {
  const key = `${cfg.server}|${cfg.username ?? ''}`;
  if (!atuForwarder || atuForwarderKey !== key) {
    if (atuForwarder) await atuForwarder.close().catch(() => {});
    atuForwarder = await startProxyForwarder(cfg);
    atuForwarderKey = key;
    log(`forwarder local 127.0.0.1:${atuForwarder.port} → ${cfg.server} (túnel con auth)`);
  }
  return `127.0.0.1:${atuForwarder.port}`;
}

export interface AtuEgress {
  label: string;
  /** Resuelve el valor de `--proxy-server` ('' = directo). LAZY: el túnel solo se abre si este
   *  egreso llega a intentarse. */
  proxy: (log: (m: string) => void) => Promise<string>;
}

/**
 * Cadena de egresos a intentar EN ORDEN: directo → túnel ENGINE_PROXY → proxy explícito.
 * Se evalúa al llamar (lee el env vigente). ATU NO usa el gate PROXY_SOURCES: el proxy aquí es
 * FALLBACK automático (si ENGINE_PROXY existe, está disponible), no un modo fijo por fuente.
 */
export function atuEgressChain(): AtuEgress[] {
  const chain: AtuEgress[] = [{ label: 'directo (IP del VPS)', proxy: async () => '' }];
  const cfg = parseProxy(process.env.ENGINE_PROXY);
  if (cfg?.username) chain.push({ label: `túnel local → ${cfg.server}`, proxy: (log) => forwarderArg(cfg, log) });
  else if (cfg) chain.push({ label: `proxy ${proxyServerArg(cfg)} (whitelist)`, proxy: async () => proxyServerArg(cfg) ?? '' });
  const explicit = process.env.ATU_PROXY || process.env.CDP_PROXY || '';
  if (explicit) chain.push({ label: `proxy explícito ${explicit}`, proxy: async () => explicit });
  return chain;
}

/** Mata el Chrome de ATU del puerto (CDP `Browser.close`, cross-platform) para poder relanzarlo
 *  con otro egreso — el `--proxy-server` solo puede cambiarse al lanzar. */
async function killAtuChrome(port: number, log: (m: string) => void): Promise<void> {
  try {
    const b = await chromium.connectOverCDP(`http://localhost:${port}`);
    const s = await b.newBrowserCDPSession();
    await s.send('Browser.close').catch(() => {});
    await b.close().catch(() => {});
    log(`Chrome :${port} cerrado (relanzo con el siguiente egreso)`);
  } catch { /* ya no estaba corriendo */ }
  await wait(1000); // deja que el SO suelte el puerto
}

/** Conecta a un Chrome ya abierto en el puerto; si no hay, lanza uno limpio con el egreso dado. */
async function connectOrLaunch(port: number, profileDir: string, chrome: string, log: (m: string) => void, proxyArg: string): Promise<Browser> {
  try {
    const b = await chromium.connectOverCDP(`http://localhost:${port}`);
    // Un Chrome parqueado conserva el egreso de SU lanzamiento (el proxy no se puede cambiar en
    // caliente): normalmente es el egreso que FUNCIONÓ la última vez → reusarlo es lo deseado.
    log(`reusando Chrome CDP en :${port} (reputación y egreso del lanzamiento original)`);
    return b;
  } catch {
    log(`lanzando Chrome limpio (CDP :${port})${proxyArg ? ` vía ${proxyArg}` : ' — directo'}…`);
    const flags = [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, ...chromeFlags(), ...(proxyArg ? [`--proxy-server=${proxyArg}`] : []), URL];
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

interface AtuAttemptOpts {
  port: number;
  profileDir: string;
  chrome: string;
  proxyArg: string;
  retries: number;
  warmupMs: number;
  shotPath?: string;
  log: (m: string) => void;
}

/** UN pase completo del flujo ATU (cookies → placa → Buscar → v3 nativo) con un egreso dado. */
async function attemptAtu(plate: string, a: AtuAttemptOpts): Promise<CdpAtuResult> {
  const { log } = a;
  let browser: Browser | null = null;
  try {
    browser = await connectOrLaunch(a.port, a.profileDir, a.chrome, log, a.proxyArg);
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    let navErr = '';
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => { navErr = (e as Error).message; });
    // Proxy muerto / túnel roto (ERR_PROXY_CONNECTION_FAILED, ERR_TUNNEL, ERR_SOCKS…): Chrome no
    // carga NADA — corta YA para que la cadena pase al siguiente egreso sin quemar reintentos.
    if (/ERR_(PROXY|TUNNEL|SOCKS)/i.test(navErr)) {
      const code = /net::\S+/.exec(navErr)?.[0] ?? navErr;
      return { ok: false, status: 'ERROR', error: `el egreso no responde (${code})` };
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
    await acceptCookies();
    await humanize();
    log(`reposo inicial ${a.warmupMs}ms + gestos…`);
    await wait(a.warmupMs);

    for (let attempt = 0; attempt <= a.retries; attempt++) {
      if (attempt > 0) {
        log(`recarga ${attempt}/${a.retries} (madurando el score del v3)…`);
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
      if (a.shotPath) await page.screenshot({ path: a.shotPath, fullPage: true }).catch(() => {});
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
    if (a.shotPath) await page.screenshot({ path: a.shotPath, fullPage: true }).catch(() => {});
    return { ok: false, status: 'ERROR', error: `reCAPTCHA v3 rechazó tras ${a.retries + 1} intento(s) con este egreso` };
  } catch (e) {
    return { ok: false, status: 'ERROR', error: (e as Error).message };
  } finally {
    // Desconecta CDP pero NO mata el Chrome → conserva reputación/cookies para la próxima placa.
    // (Si este egreso falló, la cadena lo mata aparte con killAtuChrome para relanzar.)
    if (browser) await browser.close().catch(() => {});
  }
}

export async function scrapeAtuViaCdp(plateRaw: string, opts: CdpAtuOptions = {}): Promise<CdpAtuResult> {
  const log = opts.log ?? (() => {});
  const plate = plateRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const chrome = findChrome();
  if (!chrome) return { ok: false, status: 'ERROR', error: 'No encontré chrome.exe. Instala Google Chrome.' };
  const port = opts.port ?? Number(process.env.CDP_ATU_PORT ?? 9226);
  const profileDir = opts.profileDir ?? process.env.CDP_ATU_PROFILE ?? `${process.cwd()}/.cdp-atu-profile`;
  const warmupMs = Math.max(0, opts.warmupMs ?? 3000);

  const releaseLock = await acquirePortLock(port);
  try {
    const chain = atuEgressChain();
    let last: CdpAtuResult = { ok: false, status: 'ERROR', error: 'sin egresos configurados' };
    for (let i = 0; i < chain.length; i++) {
      const eg = chain[i]!;
      if (i > 0) log(`egreso ${i + 1}/${chain.length} → ${eg.label}`);
      let proxyArg = '';
      try { proxyArg = await eg.proxy(log); }
      catch (e) { log(`egreso "${eg.label}": no se pudo preparar (${(e as Error).message}) → salto al siguiente`); continue; }
      // 1er egreso con los reintentos normales; los fallback con 1 (2 intentos) para no exceder
      // el tope de tiempo de la fuente cuando la cadena es larga.
      const retries = i === 0 ? Math.max(0, opts.retries ?? 2) : 1;
      const r = await attemptAtu(plate, { port, profileDir, chrome, proxyArg, retries, warmupMs, shotPath: opts.shotPath, log });
      if (r.ok) {
        if (i > 0) log(`✓ resuelto por "${eg.label}" (el Chrome queda parqueado con este egreso)`);
        return r;
      }
      last = r;
      log(`egreso "${eg.label}" falló: ${r.error ?? r.status}`);
      if (i < chain.length - 1) await killAtuChrome(port, log); // el proxy solo cambia relanzando
    }
    return { ...last, error: `${last.error ?? 'sin datos'} · egresos agotados: ${chain.map((e) => e.label).join(' → ')}` };
  } finally {
    releaseLock();
  }
}
