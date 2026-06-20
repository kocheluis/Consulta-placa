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
 * Comparte un único contexto (y su sesión/cookies de Cloudflare) entre páginas;
 * cada consulta abre y cierra su propia página.
 */
export class StealthBrowserPool {
  private context: BrowserContext | null = null;
  private readonly headless: boolean;
  private readonly userDataDir: string;
  private readonly channel: NonNullable<StealthPoolOptions['channel']>;

  constructor(opts: StealthPoolOptions = {}) {
    this.headless = opts.headless ?? false;
    this.userDataDir = opts.userDataDir ?? '.stealth-profile';
    this.channel = opts.channel ?? 'chrome';
  }

  private async getContext(): Promise<BrowserContext> {
    if (!this.context) {
      this.context = await chromium.launchPersistentContext(this.userDataDir, {
        channel: this.channel,
        headless: this.headless,
        viewport: null,
        locale: 'es-PE',
      });
    }
    return this.context;
  }

  /** Ejecuta `fn` con una página nueva del contexto stealth y la cierra al terminar. */
  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const context = await this.getContext();
    const page = await context.newPage();
    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    if (!this.context) return;
    const ctx = this.context;
    this.context = null;
    await ctx.close().catch(() => {});
  }
}
