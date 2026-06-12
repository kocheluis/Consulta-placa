import { SectionKind, SectionStatus, SourceId, type SourceResult } from '@app/shared';
import type { Scraper, ScraperContext } from '../types.js';
import { parseSbs } from './parser.js';

const SBS_URL = 'https://servicios.sbs.gob.pe/reportesoat/';

/**
 * Scraper del reporte SOAT/siniestralidad de la SBS. El portal usa Google
 * reCAPTCHA v2, resuelto vía el solver inyectado. Ante fallo degrada a
 * secciones UNAVAILABLE para permitir el reporte parcial (FR-034).
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
      await page.goto(SBS_URL, { waitUntil: 'domcontentloaded' });

      await page.locator('input[name="placa"], #placa, input[type="text"]').first().fill(plateNormalized);

      // reCAPTCHA v2: obtener sitekey y resolver vía el servicio externo.
      const sitekey = await page
        .locator('.g-recaptcha, [data-sitekey]')
        .first()
        .getAttribute('data-sitekey')
        .catch(() => null);
      if (sitekey) {
        const token = await ctx.captcha.solveRecaptchaV2(sitekey, SBS_URL);
        await page.evaluate((t) => {
          const el = document.querySelector<HTMLTextAreaElement>('#g-recaptcha-response');
          if (el) el.value = t;
        }, token);
      }

      await page.locator('button[type="submit"], #btnConsultar').first().click();
      await page.waitForLoadState('networkidle');

      return parseSbs(await page.content());
    } catch (err) {
      return unavailable(err instanceof Error ? err.message : 'SBS_ERROR');
    }
  },
};
