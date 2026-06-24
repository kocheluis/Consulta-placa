import { createWorker } from 'tesseract.js';
import type { CaptchaSolver } from './index.js';

/**
 * Solver local y GRATUITO basado en OCR (Tesseract.js). No requiere cuenta ni
 * clave. Resuelve CAPTCHAs de imagen con texto (p. ej. SUNARP). NO resuelve
 * reCAPTCHA v2 (SBS) — para eso se necesita un servicio de pago.
 *
 * La precisión del OCR es variable; conviene reintentar (la cola ya reintenta el
 * job) y, si hace falta, preprocesar la imagen. La primera ejecución descarga los
 * datos del idioma (se cachean localmente).
 */
export class LocalImageSolver implements CaptchaSolver {
  constructor(private readonly lang = 'eng') {}

  async solveImage(imageBase64: string): Promise<string> {
    const worker = await createWorker(this.lang);
    try {
      const buffer = Buffer.from(imageBase64, 'base64');
      const { data } = await worker.recognize(buffer);
      // Los CAPTCHA de texto no llevan espacios; se limpia el ruido del OCR.
      return data.text.replace(/[^A-Za-z0-9]/g, '').trim();
    } finally {
      await worker.terminate();
    }
  }

  async solveRecaptchaV2(): Promise<string> {
    throw new Error(
      'El solver local (OCR) no resuelve reCAPTCHA v2. Configura CAPTCHA_PROVIDER=capsolver|2captcha con su clave para SBS.',
    );
  }

  async solveRecaptchaV3(): Promise<string> {
    throw new Error('El solver local (OCR) no resuelve reCAPTCHA v3 (SBS). Usa CAPTCHA_PROVIDER=capsolver.');
  }

  async solveTurnstile(): Promise<string> {
    throw new Error(
      'El solver local (OCR) no resuelve Cloudflare Turnstile. Configura CAPTCHA_PROVIDER=capsolver|2captcha con su clave para SUNARP.',
    );
  }
}
