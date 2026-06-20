import { chromium, type BrowserContext, type Page } from 'patchright';

export interface StealthPoolOptions {
  /** `false` (con ventana) es lo más sigiloso y lo validado en dev. En servidores
   *  sin display se usa `true` (requiere validar que el Turnstile siga pasando). */
  headless?: boolean;
  /** Directorio del perfil persistente (reusa la "clearance" de Cloudflare). */
  userDataDir?: string;
  /** Canal del navegador real. `chrome` (Google Chrome) es lo validado. */
  channel?: 'chrome' | 'chromium' | 'msedge';
}

/**
 * Pool de navegador "stealth" basado en **patchright** (Playwright parcheado
 * anti-detección) con **contexto persistente** y Chrome real. Esta combinación
 * pasa el Cloudflare Turnstile de SUNARP de forma pasiva, sin pagar un solver.
 *
 * Comparte un único contexto (y su sesión/cookies de Cloudflare) entre páginas.
 * Si el contexto muere (p. ej. en dev cierras la ventana de Chrome) se relanza
 * automáticamente. La promesa cacheada serializa el arranque (sin carreras de
 * concurrencia que choquen por el mismo perfil).
 */
export class StealthBrowserPool {
  private contextPromise: Promise<BrowserContext> | null = null;
  private readonly headless: boolean;
  private readonly userDataDir: string;
  private readonly channel: NonNullable<StealthPoolOptions['channel']>;

  constructor(opts: StealthPoolOptions = {}) {
    this.headless = opts.headless ?? false;
    this.userDataDir = opts.userDataDir ?? '.stealth-profile';
    this.channel = opts.channel ?? 'chrome';
  }

  private launch(): Promise<BrowserContext> {
    return chromium.launchPersistentContext(this.userDataDir, {
      channel: this.channel,
      headless: this.headless,
      viewport: null,
      locale: 'es-PE',
    });
  }

  private getContext(): Promise<BrowserContext> {
    if (!this.contextPromise) this.contextPromise = this.launch();
    return this.contextPromise;
  }

  /** Ejecuta `fn` con una página nueva del contexto stealth y la cierra al terminar. */
  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    let page: Page;
    try {
      page = await (await this.getContext()).newPage();
    } catch {
      // El contexto pudo cerrarse (ventana cerrada en dev) o no haber arrancado:
      // descarta el cacheado, relanza y reintenta una vez.
      this.contextPromise = null;
      page = await (await this.getContext()).newPage();
    }
    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    const p = this.contextPromise;
    this.contextPromise = null;
    if (!p) return;
    try {
      const ctx = await p;
      await ctx.close();
    } catch {
      /* el contexto ya estaba cerrado */
    }
  }
}
