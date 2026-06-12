import { SectionKind, SectionStatus, SourceId, type SourceResult } from '@app/shared';
import type { Scraper, ScraperContext } from '../types.js';
import { PORTAL_SELECTORS } from '../selectors.js';
import { parseSbs } from './parser.js';

const S = PORTAL_SELECTORS.sbs;

/**
 * Scraper del reporte SOAT/siniestralidad de la SBS. El portal usa Google
 * reCAPTCHA v2, resuelto vía el solver inyectado. Selectores en `../selectors.ts`.
 * Ante fallo degrada a UNAVAILABLE para permitir el reporte parcial (FR-034).
 */
export const sbsScraper: Scraper = {
  id: SourceId.SBS,

  async fetch(plateNormalized: string, ctx: ScraperContext): Promise<SourceResult[]> {
    const unavailable = (reason: string): SourceResult[] => [
      { kind: SectionKind.SEGUROS, source: SourceId.SBS, status: SectionStatus.UNAVAILABLE, fetchedAt: null, errorReason: reason },
      { kind: SectionKind.SINIESTRALIDAD, source: SourceId.SBS, status: SectionStatus.UNAVAILABLE, fetchedAt: null, errorReason: reason },
    ];

    try {
      const { page, timeoutMs } = ctx;
      page.setDefaultTimeout(timeoutMs);
      await page.goto(S.url, { waitUntil: 'domcontentloaded' });

      await page.locator(S.plateInput).first().fill(plateNormalized);

      // reCAPTCHA v2: obtener sitekey y resolver vía el servicio externo.
      if (S.recaptchaSitekeyEl) {
        const sitekey = await page
          .locator(S.recaptchaSitekeyEl)
          .first()
          .getAttribute('data-sitekey')
          .catch(() => null);
        if (sitekey) {
          const token = await ctx.captcha.solveRecaptchaV2(sitekey, S.url);
          await page.evaluate((t) => {
            const el = document.querySelector<HTMLTextAreaElement>('#g-recaptcha-response');
            if (el) el.value = t;
          }, token);
        }
      }

      await page.locator(S.submit).first().click();
      if (S.resultReady) {
        await page.locator(S.resultReady).first().waitFor({ state: 'visible' }).catch(() => {});
      } else {
        await page.waitForLoadState('networkidle');
      }

      return parseSbs(await page.content());
    } catch (err) {
      return unavailable(err instanceof Error ? err.message : 'SBS_ERROR');
    }
  },
};
