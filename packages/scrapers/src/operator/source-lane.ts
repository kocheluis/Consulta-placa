import { chromium, type BrowserContext, type Page } from 'playwright';
import { join } from 'node:path';
import { createCaptchaSolver, type CaptchaSolver } from '../captcha/index.js';
import type { OperatorSourceResult } from './sources.js';

/**
 * "Carril" de una fuente LIGERA transpuesto sobre un lote de placas. En vez de abrir y cerrar
 * un Chrome por placa, abre 1 Chromium + contexto UNA vez y, por cada placa, abre una página
 * nueva en el MISMO contexto (las cookies/sesión persisten → re-consulta como en el flujo manual
 * de SAT de las capturas) y llama al runner (cada runner hace su propio page.goto). Cierra el
 * navegador UNA sola vez al final. Un error en una placa NO aborta al resto del lote.
 *
 * `launchBrowser`/`solver` son inyectables → se prueba el reúso y el aislamiento de errores sin
 * Chrome real. Es el primitivo de las fuentes ligeras del motor por lotes (SAT/MTC/SBS/APESEG/Callao).
 */
export type LightRunner = (page: Page, plate: string, solver: CaptchaSolver, shot: string) => Promise<OperatorSourceResult>;

export interface LaneItem {
  plate: string;
  /** Carpeta de salida de esa placa (para el screenshot de la fuente). */
  outDir: string;
}
export interface LaneResult {
  plate: string;
  source: string;
  result: OperatorSourceResult;
  ms: number;
}
export interface LaneBrowser {
  ctx: Pick<BrowserContext, 'newPage'>;
  close: () => Promise<void>;
}
export interface LightLaneOpts {
  headless?: boolean;
  captchaProvider?: string;
  captchaApiKey: string;
  /** Callback por placa terminada (para actualizar el % del pedido / entregar apenas lista). */
  onResult?: (r: LaneResult) => void;
  /** Inyectable para tests (default: Chromium headless + contexto es-PE). */
  launchBrowser?: () => Promise<LaneBrowser>;
  /** Inyectable para tests (default: createCaptchaSolver por env). */
  solver?: CaptchaSolver;
}

export async function runLightLane(
  sourceId: string,
  runner: LightRunner,
  items: LaneItem[],
  opts: LightLaneOpts,
): Promise<Map<string, LaneResult>> {
  const results = new Map<string, LaneResult>();
  if (!items.length) return results;
  const solver = opts.solver ?? createCaptchaSolver({ provider: opts.captchaProvider ?? 'capsolver', apiKey: opts.captchaApiKey });
  const launch = opts.launchBrowser ?? (async (): Promise<LaneBrowser> => {
    const browser = await chromium.launch({ headless: opts.headless ?? true });
    const ctx = await browser.newContext({ locale: 'es-PE' });
    return { ctx, close: async () => { await browser.close().catch(() => {}); } };
  });
  const { ctx, close } = await launch();
  try {
    for (const it of items) {
      const shot = join(it.outDir, `${sourceId}.png`);
      const t0 = Date.now();
      let result: OperatorSourceResult;
      const page = await ctx.newPage();
      try {
        result = await runner(page, it.plate, solver, shot);
      } catch (e) {
        result = { source: sourceId.toUpperCase(), label: sourceId, category: 'OTRO', status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
      } finally {
        await page.close().catch(() => {});
      }
      const r: LaneResult = { plate: it.plate, source: sourceId, result, ms: Date.now() - t0 };
      results.set(it.plate, r);
      opts.onResult?.(r);
    }
  } finally {
    await close();
  }
  return results;
}
