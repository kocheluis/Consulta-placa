import { SectionKind, SectionStatus, SourceId, formatPlateDisplay, type SourceResult } from '@app/shared';
import type { Scraper, ScraperContext } from '../types.js';
import { parseSunarp } from './parser.js';

const SUNARP_URL = 'https://www.consultavehicular.sunarp.gob.pe/';

/**
 * Scraper de la consulta vehicular SUNARP.
 *
 * Flujo (portal protegido con CAPTCHA de imagen): cargar página → ingresar placa
 * → resolver CAPTCHA vía el solver inyectado → enviar → leer el HTML del resultado
 * → delegar el parseo a `parseSunarp` (parser puro, testeado con fixtures).
 *
 * La navegación concreta depende del DOM real del portal y debe ajustarse cuando
 * cambie; por eso se mantiene aislada del parser. Ante cualquier fallo devuelve
 * un SourceResult UNAVAILABLE para permitir el reporte parcial (FR-034).
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
      await page.goto(SUNARP_URL, { waitUntil: 'domcontentloaded' });

      // Ingreso de placa. El selector depende del DOM real del portal.
      const plateInput = page.locator('input[name="nroPlaca"], #nroPlaca, input[type="text"]').first();
      await plateInput.fill(plateNormalized);

      // Resolución de CAPTCHA de imagen (si el portal lo presenta).
      const captchaImg = page.locator('img.captcha, #imgCaptcha').first();
      if (await captchaImg.count()) {
        const buf = await captchaImg.screenshot();
        const text = await ctx.captcha.solveImage(buf.toString('base64'));
        await page.locator('input[name="codigoCaptcha"], #codigoCaptcha').first().fill(text);
      }

      await page.locator('button[type="submit"], #btnBuscar').first().click();
      await page.waitForLoadState('networkidle');

      const html = await page.content();
      return parseSunarp(html, plateDisplay);
    } catch (err) {
      return unavailable(err instanceof Error ? err.message : 'SUNARP_ERROR');
    }
  },
};
