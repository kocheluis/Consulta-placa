/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { SectionStatus, SourceId, type SourceResult } from '@app/shared';
import { ocrImage } from '../ocr/index.js';
import { parseSunarpOcr } from '../sunarp/ocr-parser.js';
import { PORTAL_SELECTORS } from '../selectors.js';

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

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
];
function findChrome(): string | null {
  return CHROME_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

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
        '--no-first-run',
        '--no-default-browser-check',
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

    log('esperando Turnstile pasivo (Chrome limpio)…');
    let token = '';
    const passiveTries = Math.ceil((opts.passiveWaitMs ?? 45000) / 1000);
    for (let i = 0; i < passiveTries && !token; i++) {
      await wait(1000);
      token = await page
        .locator(S.turnstileResponse ?? 'input[name="cf-turnstile-response"]')
        .first()
        .inputValue()
        .catch(() => '');
    }

    if (token) {
      log(`Turnstile pasó pasivo (${token.length}); llenando placa ${plate} + Buscar`);
      await page.locator(S.plateInput).first().fill(plate).catch((e) => log(`fill: ${(e as Error).message}`));
      await wait(600);
      await page.locator(S.submit).first().click().catch((e) => log(`click: ${(e as Error).message}`));
    } else {
      log(`Turnstile NO pasó pasivo → resuélvelo en la ventana (placa ${plate} + verificación + Buscar)`);
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
  }
}
