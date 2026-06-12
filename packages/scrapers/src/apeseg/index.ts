import { SectionKind, SectionStatus, SourceId, type SourceResult } from '@app/shared';
import type { Scraper, ScraperContext } from '../types.js';
import { parseApeseg } from './parser.js';

const APESEG_URL = 'https://www.apeseg.org.pe/consultas-soat/';

/**
 * Scraper de la consulta SOAT de APESEG (fuente complementaria de SBS para el
 * estado del SOAT). Degrada a UNAVAILABLE ante fallo.
 */
export const apesegScraper: Scraper = {
  id: SourceId.APESEG,

  async fetch(plateNormalized: string, ctx: ScraperContext): Promise<SourceResult[]> {
    try {
      const { page, timeoutMs } = ctx;
      page.setDefaultTimeout(timeoutMs);
      await page.goto(APESEG_URL, { waitUntil: 'domcontentloaded' });
      await page.locator('input[name="placa"], #placa, input[type="text"]').first().fill(plateNormalized);
      await page.locator('button[type="submit"], #btnBuscar').first().click();
      await page.waitForLoadState('networkidle');
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
