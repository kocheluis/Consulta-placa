import { SectionKind, SectionStatus, SourceId, formatPlateDisplay, type SourceResult } from '@app/shared';
import type { Page } from 'patchright';
import type { CaptchaSolver } from '../captcha/index.js';
import { PORTAL_SELECTORS } from '../selectors.js';
import { ocrImage } from '../ocr/index.js';
import { parseSunarpOcr } from './ocr-parser.js';

const S = PORTAL_SELECTORS.sunarp;
const TURNSTILE_SEL = S.turnstileResponse ?? 'input[name="cf-turnstile-response"]';
const DATA_ENDPOINT = 'getDatosVehiculo';

export interface SunarpScrapeOptions {
  /** Solver de respaldo (CapSolver) si el navegador stealth no auto-pasa el Turnstile. */
  captcha?: CaptchaSolver;
  timeoutMs: number;
}

/**
 * Scraper de SUNARP (consulta vehicular).
 *
 * El portal está protegido por **Cloudflare Turnstile** y devuelve los datos del
 * vehículo como **IMAGEN** (no HTML) — anti-scraping. Flujo:
 *  1. Cargar con navegador **stealth** (patchright) → el Turnstile se auto-resuelve
 *     (token en `cf-turnstile-response`). Fallback: resolverlo con CapSolver e inyectarlo.
 *  2. Enviar; interceptar la respuesta del endpoint `getDatosVehiculo` → PNG base64.
 *  3. **OCR** de la imagen → `parseSunarpOcr` → SourceResult REGISTRAL.
 * Ante cualquier fallo devuelve UNAVAILABLE (permite reporte parcial, FR-034).
 */
export async function scrapeSunarp(
  page: Page,
  plateNormalized: string,
  opts: SunarpScrapeOptions,
): Promise<SourceResult[]> {
  const plateDisplay = formatPlateDisplay(plateNormalized);
  const unavailable = (reason: string): SourceResult[] => [
    {
      kind: SectionKind.REGISTRAL,
      source: SourceId.SUNARP,
      status: SectionStatus.UNAVAILABLE,
      fetchedAt: null,
      errorReason: reason,
    },
  ];

  // Capturar la imagen de datos en cuanto responda el endpoint getDatosVehiculo.
  let dataImage: string | null = null;
  page.on('response', (resp) => {
    if (!resp.url().includes(DATA_ENDPOINT)) return;
    void resp
      .json()
      .then((body: unknown) => {
        const imagen = (body as { model?: { imagen?: string } } | null)?.model?.imagen;
        if (imagen) dataImage = imagen;
      })
      .catch(() => {});
  });

  try {
    page.setDefaultTimeout(opts.timeoutMs);
    await page.goto(S.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator(S.plateInput).first().fill(plateNormalized);

    // 1) Turnstile: esperar el token que genera el navegador stealth (pasivo).
    let token = await waitForToken(page, 20000);

    // 2) Fallback: resolver con el solver de pago (CapSolver) e inyectar el token.
    if (!token && opts.captcha) {
      const sitekey = await page
        .locator('[data-sitekey]')
        .first()
        .getAttribute('data-sitekey')
        .catch(() => null);
      if (sitekey) {
        const solved = await opts.captcha.solveTurnstile(sitekey, S.url).catch(() => '');
        if (solved) {
          await injectToken(page, solved);
          token = solved;
        }
      }
    }
    if (!token) return unavailable('SUNARP_TURNSTILE_NO_RESUELTO');

    // 3) Enviar; la imagen llega por la respuesta interceptada arriba.
    await page.locator(S.submit).first().click();
    for (let i = 0; i < 25 && !dataImage; i++) await page.waitForTimeout(1000);

    const img = dataImage;
    if (!img) return unavailable('SUNARP_SIN_DATOS');

    // 4) OCR + parse del certificado (la data viene como imagen).
    const text = await ocrImage(Buffer.from(img, 'base64'));
    return parseSunarpOcr(text, plateDisplay);
  } catch (err) {
    return unavailable(err instanceof Error ? err.message : 'SUNARP_ERROR');
  }
}

/** Espera a que el campo cf-turnstile-response tenga token (hasta `ms`). */
async function waitForToken(page: Page, ms: number): Promise<string> {
  const steps = Math.ceil(ms / 1000);
  for (let i = 0; i < steps; i++) {
    const v = await page.locator(TURNSTILE_SEL).first().inputValue().catch(() => '');
    if (v) return v;
    await page.waitForTimeout(1000);
  }
  return '';
}

/** Inyecta en el campo oculto del Turnstile un token resuelto por el solver. */
async function injectToken(page: Page, token: string): Promise<void> {
  await page.evaluate(
    (args: { sel: string; value: string }) => {
      const g = globalThis as unknown as {
        document?: { querySelector(s: string): { value: string; dispatchEvent(e: unknown): void } | null };
        Event: new (type: string, init?: { bubbles?: boolean }) => unknown;
      };
      const el = g.document?.querySelector(args.sel);
      if (el) {
        el.value = args.value;
        el.dispatchEvent(new g.Event('input', { bubbles: true }));
        el.dispatchEvent(new g.Event('change', { bubbles: true }));
      }
    },
    { sel: TURNSTILE_SEL, value: token },
  );
}
