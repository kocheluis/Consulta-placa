import { CapSolverSolver } from './capsolver.js';
import { TwoCaptchaSolver } from './twocaptcha.js';
import { LocalImageSolver } from './local.js';

/**
 * Cliente intercambiable de resolución de CAPTCHA. Soporta reCAPTCHA v2 (SBS)
 * y CAPTCHA de imagen (SUNARP). El proveedor concreto (2Captcha/CapSolver) se
 * configura por entorno; en tests se inyecta un mock.
 */
export interface CaptchaSolver {
  /** Resuelve un reCAPTCHA v2 dado su sitekey y la URL de la página. */
  solveRecaptchaV2(sitekey: string, url: string): Promise<string>;
  /** Resuelve un CAPTCHA de imagen (base64) y devuelve el texto. */
  solveImage(imageBase64: string): Promise<string>;
}

export interface CaptchaConfig {
  provider: string;
  apiKey: string;
}

/** Solver no-op para entornos sin clave (lanza si se invoca). Útil en dev/tests. */
export class NoopCaptchaSolver implements CaptchaSolver {
  async solveRecaptchaV2(): Promise<string> {
    throw new Error('CAPTCHA solver no configurado (CAPTCHA_API_KEY ausente)');
  }
  async solveImage(): Promise<string> {
    throw new Error('CAPTCHA solver no configurado (CAPTCHA_API_KEY ausente)');
  }
}

/**
 * Crea el solver según configuración:
 *  - `local` / `tesseract`: OCR local gratuito (imágenes; resuelve SUNARP, no SBS).
 *  - `capsolver` (por defecto con clave) / `2captcha`: servicios de pago (imágenes + reCAPTCHA v2).
 * Sin clave y sin proveedor local, devuelve el Noop → los scrapers degradan a
 * "no disponible" en lugar de fallar (FR-034).
 */
export function createCaptchaSolver(cfg: CaptchaConfig): CaptchaSolver {
  const provider = cfg.provider.toLowerCase();
  if (provider === 'local' || provider === 'tesseract') return new LocalImageSolver();
  if (!cfg.apiKey) return new NoopCaptchaSolver();
  switch (provider) {
    case '2captcha':
    case 'twocaptcha':
      return new TwoCaptchaSolver(cfg.apiKey);
    case 'capsolver':
    default:
      return new CapSolverSolver(cfg.apiKey);
  }
}
