import type { SourceResult } from '@app/shared';
import type { Page } from 'playwright';
import type { CaptchaSolver } from './captcha/index.js';

export interface ScraperContext {
  page: Page;
  captcha: CaptchaSolver;
  timeoutMs: number;
}

/**
 * Contrato uniforme de un scraper de fuente. Aísla la fragilidad externa:
 * un cambio en un portal solo afecta a su módulo, no a la API/UI.
 */
export interface Scraper {
  readonly id: string;
  /** Ejecuta la consulta para una placa normalizada y devuelve uno o más SourceResult. */
  fetch(plateNormalized: string, ctx: ScraperContext): Promise<SourceResult[]>;
}

/**
 * Parser puro: HTML/estructura → SourceResult. Separado de la navegación para
 * poder testear contra fixtures sin red ni navegador.
 */
export interface SourceParser<TInput = string> {
  parse(input: TInput): SourceResult[];
}
