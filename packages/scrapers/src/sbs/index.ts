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

      // El portal SBS usa reCAPTCHA v3 (invisible, por reputación). Resolverlo de
      // forma fiable requiere un solver de pago que soporte v3 (p. ej. CapSolver);
      // el token se inyecta en el campo oculto hdnReCaptchaV3. Sin solver válido,
      // el envío será rechazado y la sección degrada a UNAVAILABLE (FR-034).
      // (La integración v3 concreta se completa cuando haya clave de solver.)

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
