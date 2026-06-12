import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

/**
 * Pool simple de un navegador Chromium headless reutilizable. Cada consulta
 * obtiene un BrowserContext aislado (cookies/sesión propias) y lo cierra al final.
 */
export class BrowserPool {
  private browser: Browser | null = null;

  async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  /** Ejecuta `fn` con una página en un contexto aislado y limpia al terminar. */
  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const browser = await this.getBrowser();
    let context: BrowserContext | null = null;
    try {
      context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
        locale: 'es-PE',
      });
      const page = await context.newPage();
      return await fn(page);
    } finally {
      await context?.close();
    }
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }
}
