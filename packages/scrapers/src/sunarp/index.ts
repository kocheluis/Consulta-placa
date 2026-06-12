import { SectionKind, SectionStatus, SourceId, formatPlateDisplay, type SourceResult } from '@app/shared';
import type { Scraper, ScraperContext } from '../types.js';
import { PORTAL_SELECTORS } from '../selectors.js';
import { parseSunarp } from './parser.js';

const S = PORTAL_SELECTORS.sunarp;

/**
 * Scraper de la consulta vehicular SUNARP.
 *
 * Flujo (portal protegido con CAPTCHA de imagen): cargar página → ingresar placa
 * → resolver CAPTCHA vía el solver inyectado → enviar → leer el HTML del resultado
 * → delegar el parseo a `parseSunarp` (parser puro, testeado con fixtures).
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

      // Resolución de CAPTCHA de imagen (si el portal lo presenta).
      if (S.captchaImage && S.captchaInput) {
        const captchaImg = page.locator(S.captchaImage).first();
        if (await captchaImg.count()) {
          const buf = await captchaImg.screenshot();
          const text = await ctx.captcha.solveImage(buf.toString('base64'));
          await page.locator(S.captchaInput).first().fill(text);
        }
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
