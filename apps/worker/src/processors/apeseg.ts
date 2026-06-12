import { apesegScraper, BrowserPool, createCaptchaSolver } from '@app/scrapers';
import type { SourceResult } from '@app/shared';
import { config } from '../config.js';

const captcha = createCaptchaSolver(config.captcha);

/** Ejecuta el scraper APESEG (estado SOAT) en una página aislada. */
export async function runApeseg(
  pool: BrowserPool,
  plateNormalized: string,
): Promise<SourceResult[]> {
  return pool.withPage((page) =>
    apesegScraper.fetch(plateNormalized, { page, captcha, timeoutMs: config.scraperTimeoutMs }),
  );
}
