import { scrapeSunarp, StealthBrowserPool, createCaptchaSolver } from '@app/scrapers';
import type { SourceResult } from '@app/shared';
import { config } from '../config.js';

// Solver de respaldo (CapSolver) por si el navegador stealth no pasa el Turnstile.
// Con CAPTCHA_PROVIDER=local es un no-op (no resuelve Turnstile) y se ignora.
const captcha = createCaptchaSolver(config.captcha);

/** Ejecuta el scraper SUNARP (stealth + OCR) en una página del pool stealth. */
export async function runSunarp(
  pool: StealthBrowserPool,
  plateNormalized: string,
): Promise<SourceResult[]> {
  return pool.withPage((page) =>
    scrapeSunarp(page, plateNormalized, { captcha, timeoutMs: config.scraperTimeoutMs }),
  );
}
