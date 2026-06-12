import { chromium, type Page, type Locator } from 'playwright';
import { PORTAL_SELECTORS } from './selectors.js';

/**
 * Script de descubrimiento de selectores. Abre cada portal oficial con un
 * navegador real y vuelca la estructura del formulario (inputs, botones, iframes
 * y data-sitekey de reCAPTCHA) para identificar los selectores reales y
 * actualizarlos en `selectors.ts`.
 *
 * Usa solo APIs de Playwright del lado Node (getAttribute/textContent) para
 * evitar problemas de serialización de `page.evaluate` bajo tsx.
 *
 * Uso: `npm run -w @app/worker discover-selectors`
 */

async function attrs(el: Locator) {
  const [id, name, type, placeholder, cls, sitekey, src, value] = await Promise.all([
    el.getAttribute('id').catch(() => null),
    el.getAttribute('name').catch(() => null),
    el.getAttribute('type').catch(() => null),
    el.getAttribute('placeholder').catch(() => null),
    el.getAttribute('class').catch(() => null),
    el.getAttribute('data-sitekey').catch(() => null),
    el.getAttribute('src').catch(() => null),
    el.getAttribute('value').catch(() => null),
  ]);
  const text = (await el.textContent().catch(() => ''))?.trim().slice(0, 40) || null;
  return { id, name, type, placeholder, cls, sitekey, src, value, text };
}

async function collect(page: Page, selector: string) {
  const els = await page.locator(selector).all();
  const out = [];
  for (const el of els.slice(0, 30)) out.push(await attrs(el));
  return out;
}

async function dumpForm(page: Page, label: string): Promise<void> {
  const info = {
    inputs: await collect(page, 'input, select, textarea'),
    buttons: await collect(page, 'button, input[type=submit], a[role=button]'),
    recaptcha: await collect(page, '[data-sitekey], .g-recaptcha'),
    iframes: await collect(page, 'iframe'),
  };
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(info, null, 2));
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [key, sel] of Object.entries(PORTAL_SELECTORS)) {
      const context = await browser.newContext({ locale: 'es-PE' });
      const page = await context.newPage();
      try {
        await page.goto(sel.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(3500); // dar tiempo a SPAs a renderizar
        await dumpForm(page, `${key.toUpperCase()} — ${sel.url}`);
      } catch (err) {
        console.error(`[${key}] error:`, (err as Error).message);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log('\nActualiza packages/scrapers/src/selectors.ts con los valores reales.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
