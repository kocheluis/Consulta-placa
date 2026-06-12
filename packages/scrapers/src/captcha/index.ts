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
 * Crea el solver según configuración. La integración HTTP real con el proveedor
 * (CapSolver/2Captcha) se implementa aquí; se deja la estructura lista.
 */
export function createCaptchaSolver(cfg: CaptchaConfig): CaptchaSolver {
  if (!cfg.apiKey) return new NoopCaptchaSolver();
  // TODO(impl): integración HTTP con el proveedor configurado.
  return new NoopCaptchaSolver();
}
