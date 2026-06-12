import { sbsScraper, BrowserPool, createCaptchaSolver } from '@app/scrapers';
import type { SourceResult } from '@app/shared';
import { config } from '../config.js';

const captcha = createCaptchaSolver(config.captcha);

/** Ejecuta el scraper SBS (SOAT + siniestralidad) en una página aislada. */
export async function runSbs(pool: BrowserPool, plateNormalized: string): Promise<SourceResult[]> {
  return pool.withPage((page) =>
    sbsScraper.fetch(plateNormalized, { page, captcha, timeoutMs: config.scraperTimeoutMs }),
  );
}
