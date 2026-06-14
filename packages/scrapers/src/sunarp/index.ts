import { SectionKind, SectionStatus, SourceId, formatPlateDisplay, type SourceResult } from '@app/shared';
import type { Scraper, ScraperContext } from '../types.js';
import { PORTAL_SELECTORS } from '../selectors.js';
import { parseSunarp } from './parser.js';

const S = PORTAL_SELECTORS.sunarp;

/**
 * Scraper de la consulta vehicular SUNARP.
 *
 * Flujo (portal protegido con Cloudflare Turnstile): cargar página → ingresar
 * placa → leer el sitekey del widget Turnstile → resolver el token con el solver
 * inyectado (CapSolver/2Captcha) → depositarlo en `cf-turnstile-response` → enviar
 * → leer el HTML del resultado → delegar el parseo a `parseSunarp` (parser puro).
 *
 * Los selectores viven en `../selectors.ts` para ajustarlos en un solo lugar.
 * Ante cualquier fallo devuelve UNAVAILABLE para permitir el reporte parcial.
 */
export const sunarpScraper: Scraper = {
  id: SourceId.SUNARP,

  async fetch(plateNormalized: string, ctx: ScraperContext): Promise<SourceResult[]> {
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

    try {
      const { page, timeoutMs } = ctx;
      page.setDefaultTimeout(timeoutMs);
      await page.goto(S.url, { waitUntil: 'domcontentloaded' });

      await page.locator(S.plateInput).first().fill(plateNormalized);

      // Cloudflare Turnstile: leer el sitekey del widget, resolver el token con
      // el solver y depositarlo en el campo oculto cf-turnstile-response.
      if (S.turnstileResponse) {
        const sitekey = await page
          .locator('[data-sitekey]')
          .first()
          .getAttribute('data-sitekey')
          .catch(() => null);
        if (!sitekey) return unavailable('SUNARP_TURNSTILE_SITEKEY_NO_ENCONTRADO');
        const token = await ctx.captcha.solveTurnstile(sitekey, S.url);
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
          { sel: S.turnstileResponse, value: token },
        );
      }

      await page.locator(S.submit).first().click();
      if (S.resultReady) {
        await page.locator(S.resultReady).first().waitFor({ state: 'visible' }).catch(() => {});
      } else {
        await page.waitForLoadState('networkidle');
      }

      return parseSunarp(await page.content(), plateDisplay);
    } catch (err) {
      return unavailable(err instanceof Error ? err.message : 'SUNARP_ERROR');
    }
  },
};
