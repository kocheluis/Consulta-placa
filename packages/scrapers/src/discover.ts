import { chromium, type Page } from 'playwright';
import { PORTAL_SELECTORS } from './selectors.js';

/**
 * Script de descubrimiento de selectores. Abre cada portal oficial con un
 * navegador real y vuelca la estructura del formulario (inputs, botones, iframes,
 * imágenes y data-sitekey de reCAPTCHA) para identificar los selectores reales y
 * actualizarlos en `selectors.ts`.
 *
 * Uso: `npm run -w @app/worker discover-selectors`
 * (requiere `npx playwright install chromium`). Corre NO-headless para poder
 * resolver manualmente cualquier verificación inicial si hiciera falta.
 */

async function dumpForm(page: Page, label: string): Promise<void> {
  const info = await page.evaluate(() => {
    const attrs = (el: Element) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      name: el.getAttribute('name'),
      type: el.getAttribute('type'),
      placeholder: el.getAttribute('placeholder'),
      classes: el.className || null,
      text: (el.textContent || '').trim().slice(0, 40) || null,
      sitekey: el.getAttribute('data-sitekey'),
      src: el.getAttribute('src'),
    });
    return {
      inputs: Array.from(document.querySelectorAll('input, select, textarea')).map(attrs),
      buttons: Array.from(document.querySelectorAll('button, input[type=submit], a[role=button]')).map(attrs),
      iframes: Array.from(document.querySelectorAll('iframe')).map((f) => f.getAttribute('src')),
      recaptcha: Array.from(document.querySelectorAll('[data-sitekey], .g-recaptcha')).map(attrs),
      images: Array.from(document.querySelectorAll('img')).map((i) => i.getAttribute('src')).slice(0, 20),
    };
  });
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(info, null, 2));
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false });
  try {
    for (const [key, sel] of Object.entries(PORTAL_SELECTORS)) {
      const context = await browser.newContext({ locale: 'es-PE' });
      const page = await context.newPage();
      try {
        await page.goto(sel.url, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(2500); // dar tiempo a SPAs a renderizar
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
  console.log('\nActualiza packages/scrapers/src/selectors.ts con los valores reales encontrados.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
