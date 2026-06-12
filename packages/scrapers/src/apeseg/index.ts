import { SectionKind, SectionStatus, SourceId, type SourceResult } from '@app/shared';
import type { Scraper, ScraperContext } from '../types.js';
import { PORTAL_SELECTORS } from '../selectors.js';
import { parseApeseg } from './parser.js';

const S = PORTAL_SELECTORS.apeseg;

/**
 * Scraper de la consulta SOAT de APESEG (fuente complementaria de SBS para el
 * estado del SOAT). Selectores en `../selectors.ts`. Degrada a UNAVAILABLE ante fallo.
 */
export const apesegScraper: Scraper = {
  id: SourceId.APESEG,

  async fetch(plateNormalized: string, ctx: ScraperContext): Promise<SourceResult[]> {
    try {
      const { page, timeoutMs } = ctx;
      page.setDefaultTimeout(timeoutMs);
      await page.goto(S.url, { waitUntil: 'domcontentloaded' });
      await page.locator(S.plateInput).first().fill(plateNormalized);
      await page.locator(S.submit).first().click();
      if (S.resultReady) {
        await page.locator(S.resultReady).first().waitFor({ state: 'visible' }).catch(() => {});
      } else {
        await page.waitForLoadState('networkidle');
      }
      return parseApeseg(await page.content());
    } catch (err) {
      return [
        {
          kind: SectionKind.SEGUROS,
          source: SourceId.APESEG,
          status: SectionStatus.UNAVAILABLE,
          fetchedAt: null,
          errorReason: err instanceof Error ? err.message : 'APESEG_ERROR',
        },
      ];
    }
  },
};
