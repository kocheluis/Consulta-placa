import { scrapeSunarp, StealthBrowserPool, createCaptchaSolver } from '@app/scrapers';
import { SectionKind, SectionStatus, SourceId, type SourceResult } from '@app/shared';
import { config } from '../config.js';

// Solver de respaldo (CapSolver) por si el navegador stealth no pasa el Turnstile.
// Con CAPTCHA_PROVIDER=local es un no-op (no resuelve Turnstile) y se ignora.
const captcha = createCaptchaSolver(config.captcha);

/**
 * Ejecuta el scraper SUNARP (stealth + OCR) en una página del pool stealth.
 * Nunca lanza: ante un error del pool/navegador devuelve UNAVAILABLE con el
 * motivo, para que SUNARP siempre figure en el reporte y el error sea visible.
 */
export async function runSunarp(
  pool: StealthBrowserPool,
  plateNormalized: string,
): Promise<SourceResult[]> {
  try {
    const result = await pool.withPage((page) =>
      scrapeSunarp(page, plateNormalized, { captcha, timeoutMs: config.scraperTimeoutMs }),
    );
    const registral = result.find((r) => r.source === SourceId.SUNARP);
    if (registral?.status === SectionStatus.UNAVAILABLE) {
      console.warn(`[SUNARP] no disponible: ${registral.errorReason ?? 'sin motivo'}`);
    }
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'SUNARP_POOL_ERROR';
    console.error(`[SUNARP] error de navegador/pool: ${reason}`);
    return [
      {
        kind: SectionKind.REGISTRAL,
        source: SourceId.SUNARP,
        status: SectionStatus.UNAVAILABLE,
        fetchedAt: null,
        errorReason: reason,
      },
    ];
  }
}
