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
  /**
   * Modo HÍBRIDO: si el Turnstile pasivo no pasa, ESPERA a que un humano lo pase
   * a mano en la ventana (clearance real, IP+fingerprint correctos → sin SIN_DATOS),
   * en vez de usar CapSolver. La cookie cf_clearance queda en el perfil persistente
   * → las siguientes consultas corren solas hasta que expire (~30 min).
   */
  manualTurnstile?: boolean;
  /** Segundos a esperar el clic humano en modo híbrido (def. 180). */
  manualWaitMs?: number;
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

  // Capturar el sitekey del Turnstile de la petición al challenge de Cloudflare
  // (SUNARP lo renderiza por JS, no está en el DOM). El sitekey viaja en la URL.
  let detectedSitekey: string | null = null;
  page.on('request', (req) => {
    if (detectedSitekey) return;
    const u = req.url();
    if (!u.includes('challenges.cloudflare.com')) return;
    const m = u.match(/0x4[A-Za-z0-9_-]{18,}/);
    if (m) detectedSitekey = m[0];
  });

  try {
    // Hook del Turnstile: captura el/los callback(s) de `turnstile.render` para
    // poder dispararlos con el token de CapSolver. SUNARP (Angular) habilita la
    // consulta vía ese callback, no solo leyendo el campo cf-turnstile-response.
    await page.addInitScript(() => {
      const w = globalThis as Record<string, unknown>;
      const cbs: Array<(t: string) => void> = [];
      w.__cfCallbacks = cbs;
      let real: { render?: (c: unknown, p: unknown) => unknown } | undefined;
      try {
        Object.defineProperty(w, 'turnstile', {
          configurable: true,
          get: () => real,
          set: (v: { render?: (c: unknown, p: unknown) => unknown }) => {
            real = v;
            if (v && typeof v.render === 'function') {
              const orig = v.render.bind(v);
              v.render = (c: unknown, p: unknown) => {
                const params = p as { callback?: (t: string) => void } | undefined;
                if (params && typeof params.callback === 'function') cbs.push(params.callback);
                return orig(c, p);
              };
            }
          },
        });
      } catch {
        /* si no se puede interceptar, seguimos con la inyección del campo */
      }
    });

    page.setDefaultTimeout(opts.timeoutMs);
    await page.goto(S.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator(S.plateInput).first().fill(plateNormalized);

    // 1) Turnstile: esperar el token que genera el navegador stealth (pasivo).
    let token = await waitForToken(page, 20000);

    // 1.5) HÍBRIDO: si no pasó solo, esperar el clic HUMANO en la ventana. La
    // clearance real (IP+fingerprint correctos) evita el SIN_DATOS de CapSolver.
    if (!token && opts.manualTurnstile) {
      console.log(
        '\n👉 [SUNARP] PASA LA VERIFICACIÓN ("No soy un robot") EN LA VENTANA QUE SE ABRIÓ.\n' +
          '   Esperando tu clic… (se guarda la sesión, así las siguientes consultas corren solas)\n',
      );
      token = await waitForToken(page, opts.manualWaitMs ?? 180000);
      if (token) console.log('[SUNARP] ✓ verificación manual detectada → continuando automático…');
    }

    // 2) Fallback: resolver con el solver de pago (CapSolver) e inyectar el token.
    if (!token && opts.captcha) {
      const sitekey = detectedSitekey ?? (await findTurnstileSitekey(page));
      console.log(
        `[SUNARP] stealth no pasó el Turnstile; sitekey=${sitekey ?? 'NO ENCONTRADO'}${
          detectedSitekey ? ' (de la red)' : ''
        } → ${sitekey ? 'llamando a CapSolver…' : 'sin sitekey no se puede usar CapSolver'}`,
      );
      if (sitekey) {
        const solved = await opts.captcha.solveTurnstile(sitekey, S.url).catch((e) => {
          console.warn(`[SUNARP] CapSolver falló: ${e instanceof Error ? e.message : String(e)}`);
          return '';
        });
        if (solved) {
          await injectToken(page, solved);
          await fireTurnstileCallback(page, solved);
          token = solved;
          console.log('[SUNARP] CapSolver resolvió el Turnstile ✓ (token inyectado + callback)');
        }
      }
    }
    if (!token) return unavailable('SUNARP_TURNSTILE_NO_RESUELTO');

    // 3) Enviar; la imagen llega por la respuesta interceptada arriba.
    await page.waitForTimeout(800); // deja que la app procese el callback del token
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

/**
 * Busca el sitekey del Turnstile en la página: primero el atributo `data-sitekey`
 * del widget; si no, escanea el HTML por el patrón de sitekey de Cloudflare
 * (`0x4AAAA…`). Necesario para que CapSolver pueda resolver el Turnstile.
 */
async function findTurnstileSitekey(page: Page): Promise<string | null> {
  const fromAttr = await page
    .locator('[data-sitekey]')
    .first()
    .getAttribute('data-sitekey', { timeout: 2500 })
    .catch(() => null);
  if (fromAttr) return fromAttr;
  return page
    .evaluate(() => {
      const g = globalThis as unknown as { document?: { documentElement?: { outerHTML?: string } } };
      const html = g.document?.documentElement?.outerHTML ?? '';
      const m = html.match(/0x4[A-Za-z0-9_-]{20,}/);
      return m ? m[0] : null;
    })
    .catch(() => null);
}

/**
 * Dispara el/los callback(s) del Turnstile capturados por el hook con el token
 * resuelto, para que la app (Angular) lo registre y habilite la consulta.
 */
async function fireTurnstileCallback(page: Page, token: string): Promise<void> {
  await page
    .evaluate((tok: string) => {
      const w = globalThis as Record<string, unknown>;
      const cbs = (w.__cfCallbacks as Array<(t: string) => void> | undefined) ?? [];
      for (const cb of cbs) {
        try {
          cb(tok);
        } catch {
          /* ignore */
        }
      }
    }, token)
    .catch(() => {});
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
