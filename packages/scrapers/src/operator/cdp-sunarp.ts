/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { SectionStatus, SourceId, type SourceResult } from '@app/shared';
import { ocrImage } from '../ocr/index.js';
import { parseSunarpOcr } from '../sunarp/ocr-parser.js';
import { PORTAL_SELECTORS } from '../selectors.js';
import { findChrome, chromeFlags } from './chrome-path.js';

/**
 * SUNARP por HÍBRIDO CDP — la vía que reemplaza al StealthBrowserPool flaky.
 *
 * Lanza (o reusa) un **Chrome normal** con depuración remota: sin banderas de
 * automatización → Cloudflare NO lo detecta y el **Turnstile pasa PASIVO** desde
 * la IP residencial del operador. Playwright se CONECTA por CDP (no lanza el
 * navegador), llena placa + Buscar, e intercepta la imagen de `getDatosVehiculo`
 * → OCR → datos registrales. Si el pasivo no pasa, el operador resuelve el
 * Turnstile en la ventana (que queda abierta).
 *
 * Validado en vivo con BTF268 (ver validacion-fuentes/sunarp-cdp.json).
 */

const S = PORTAL_SELECTORS.sunarp;
const URL = 'https://consultavehicular.sunarp.gob.pe/';
const DATA_ENDPOINT = 'getDatosVehiculo';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CdpSunarpOptions {
  /** Dónde guardar la imagen-tarjeta de SUNARP como screenshot para la consola. */
  shotPath: string;
  /** Puerto de depuración remota (default 9222 / env CDP_SUNARP_PORT). */
  port?: number;
  /** Perfil de Chrome (persiste el clearance de Cloudflare entre placas). */
  profileDir?: string;
  /** Espera máx. del Turnstile pasivo antes de pedir intervención (default 45s). */
  passiveWaitMs?: number;
  /** Espera máx. de los datos (deja margen para que el operador resuelva, default 180s). */
  dataWaitMs?: number;
  /**
   * Cuántas veces recargar la página para reintentar el Turnstile PASIVO si no pasó
   * (default 2 → 3 intentos). Desde la IP del VPS el pasivo es intermitente; recargar
   * gatilla un nuevo challenge y suele pasar en el 2º/3er intento (junto al keep-alive
   * que mantiene caliente el clearance del perfil). Solo aplica en modo automático.
   */
  passiveReloads?: number;
  log?: (msg: string) => void;
}

export interface CdpSunarpResult {
  ok: boolean;
  status: SectionStatus;
  ownerName?: string | null;
  /** Datos registrales aplanados (vehicle + ownerName) para la consola/reporte. */
  data?: Record<string, unknown>;
  text?: string;
  error?: string;
}

/** Conecta a un Chrome ya abierto en el puerto; si no hay, lanza uno limpio. */
async function connectOrLaunch(
  port: number,
  profileDir: string,
  chrome: string,
  log: (m: string) => void,
): Promise<Browser> {
  try {
    const b = await chromium.connectOverCDP(`http://localhost:${port}`);
    log(`reusando Chrome CDP en :${port} (clearance persistido)`);
    return b;
  } catch {
    log(`lanzando Chrome limpio (CDP :${port})…`);
    const proc = spawn(
      chrome,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        ...chromeFlags(),
        URL,
      ],
      { detached: false, stdio: 'ignore' },
    );
    proc.on('error', (e) => log(`spawn chrome: ${e.message}`));
    for (let i = 0; i < 20; i++) {
      await wait(700);
      try {
        return await chromium.connectOverCDP(`http://localhost:${port}`);
      } catch {
        /* el puerto aún no abre; reintentar */
      }
    }
    throw new Error('no pude conectar al Chrome CDP (¿se abrió la ventana?)');
  }
}

/**
 * Mutex POR PUERTO para el perfil de Chrome del CDP. Dos `scrapeSunarpViaCdp` concurrentes
 * sobre el MISMO puerto/perfil (p. ej. la fuente `sunarp` y el SUNARP interno de `historial`
 * corriendo en paralelo con OPERATOR_CONCURRENCY>1) chocan: Chrome NO permite dos instancias
 * del mismo `user-data-dir` → una queda con la página rota → el Turnstile nunca renderiza.
 * Este lock los pone en fila; las fuentes que no usan este perfil (captcha) siguen en paralelo.
 */
const portQueues = new Map<number, Promise<void>>();
async function acquirePortLock(port: number): Promise<() => void> {
  const prev = portQueues.get(port) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  // El siguiente que pida el lock espera a que ESTE termine (prev → mine).
  portQueues.set(port, prev.then(() => mine));
  await prev; // espera tu turno
  return release;
}

export async function scrapeSunarpViaCdp(
  plateRaw: string,
  opts: CdpSunarpOptions,
): Promise<CdpSunarpResult> {
  const log = opts.log ?? (() => {});
  const plate = plateRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const chrome = findChrome();
  if (!chrome) {
    return { ok: false, status: SectionStatus.UNAVAILABLE, error: 'No encontré chrome.exe. Instala Google Chrome.' };
  }
  const port = opts.port ?? Number(process.env.CDP_SUNARP_PORT ?? 9222);
  const profileDir =
    opts.profileDir ?? process.env.CDP_CHROME_PROFILE ?? join(process.cwd(), '.cdp-chrome-profile');

  // Serializa el acceso a este perfil/puerto (evita la colisión sunarp↔historial en 9222).
  const releaseLock = await acquirePortLock(port);
  let browser: Browser | null = null;
  let dataImage: string | null = null;
  try {
    browser = await connectOrLaunch(port, profileDir, chrome, log);
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());

    page.on('response', (resp) => {
      if (!resp.url().includes(DATA_ENDPOINT)) return;
      void resp
        .json()
        .then((b: unknown) => {
          const img = (b as { model?: { imagen?: string } } | null)?.model?.imagen;
          if (img) {
            dataImage = img;
            log('imagen de datos capturada');
          }
        })
        .catch(() => {});
    });

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

    // Reintento del Turnstile PASIVO: si no pasa, recargamos la página (nuevo challenge)
    // y volvemos a esperar. Reparte la espera total entre los intentos.
    const reloads = Math.max(0, opts.passiveReloads ?? 2);
    const attempts = reloads + 1;
    const perAttemptMs = Math.max(15000, Math.ceil((opts.passiveWaitMs ?? 45000) / attempts));
    const turnstileSel = S.turnstileResponse ?? 'input[name="cf-turnstile-response"]';
    let token = '';
    for (let a = 0; a < attempts && !token; a++) {
      if (a > 0) {
        log(`Turnstile no pasó pasivo → recarga ${a}/${reloads} (nuevo challenge)…`);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      }
      log(`esperando Turnstile pasivo (Chrome limpio, intento ${a + 1}/${attempts})…`);
      const tries = Math.ceil(perAttemptMs / 1000);
      for (let i = 0; i < tries && !token; i++) {
        await wait(1000);
        // OJO: inputValue SIEMPRE con timeout. Sin él, si el input del Turnstile no existe
        // (página en mal estado / colisión de perfil), Playwright espera su timeout por
        // defecto (30s) POR LLAMADA → el loop se dispara a minutos y revienta el tope del job.
        token = await page.locator(turnstileSel).first().inputValue({ timeout: 1000 }).catch(() => '');
      }
    }

    if (token) {
      log(`Turnstile pasó pasivo (${token.length}); llenando placa ${plate} + Buscar`);
      await page.locator(S.plateInput).first().fill(plate).catch((e) => log(`fill: ${(e as Error).message}`));
      await wait(600);
      await page.locator(S.submit).first().click().catch((e) => log(`click: ${(e as Error).message}`));
    } else {
      log(`Turnstile NO pasó pasivo tras ${attempts} intento(s) → resuélvelo en la ventana (placa ${plate} + verificación + Buscar)`);
    }

    const dataTries = Math.ceil((opts.dataWaitMs ?? 180000) / 1000);
    for (let i = 0; i < dataTries && !dataImage; i++) await wait(1000);

    if (!dataImage) {
      return { ok: false, status: SectionStatus.UNAVAILABLE, error: 'No se capturó la imagen de datos (¿no se hizo la búsqueda?).' };
    }

    const img: string = dataImage;
    // La imagen-tarjeta de SUNARP ES el mejor screenshot para la consola.
    try {
      writeFileSync(opts.shotPath, Buffer.from(img, 'base64'));
    } catch (e) {
      log(`no pude guardar screenshot: ${(e as Error).message}`);
    }

    log('OCR sobre la imagen de SUNARP…');
    const text = await ocrImage(Buffer.from(img, 'base64'));
    const parsed: SourceResult[] = parseSunarpOcr(text, plate);
    const reg = parsed.find((s) => s.source === SourceId.SUNARP);

    if (!reg || reg.status === SectionStatus.NOT_FOUND) {
      return { ok: false, status: SectionStatus.NOT_FOUND, text, error: 'SUNARP no devolvió datos para esta placa.' };
    }

    const vehicle = (reg as { vehicle?: Record<string, unknown> }).vehicle ?? {};
    const ownerName = (reg as { ownerName?: string | null }).ownerName ?? null;
    return {
      ok: true,
      status: SectionStatus.AVAILABLE,
      ownerName,
      data: { ...vehicle, ownerName },
      text,
    };
  } catch (e) {
    return { ok: false, status: SectionStatus.UNAVAILABLE, error: (e as Error).message };
  } finally {
    // Desconecta la sesión CDP pero NO mata el Chrome → conserva el clearance
    // para la próxima placa (passive Turnstile más rápido).
    if (browser) await browser.close().catch(() => {});
    releaseLock(); // libera el perfil para el siguiente scrape (sunarp/historial)
  }
}
