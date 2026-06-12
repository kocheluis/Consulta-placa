import { sunarpScraper, BrowserPool, createCaptchaSolver } from '@app/scrapers';
import type { SourceResult } from '@app/shared';
import { config } from '../config.js';

const captcha = createCaptchaSolver(config.captcha);

/** Ejecuta el scraper SUNARP dentro de una página aislada del pool. */
export async function runSunarp(
  pool: BrowserPool,
  plateNormalized: string,
): Promise<SourceResult[]> {
  return pool.withPage((page) =>
    sunarpScraper.fetch(plateNormalized, {
      page,
      captcha,
      timeoutMs: config.scraperTimeoutMs,
    }),
  );
}
