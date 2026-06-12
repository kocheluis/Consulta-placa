import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PORTAL_SELECTORS } from './selectors.js';

/**
 * Prueba interactiva (human-in-the-loop) de SUNARP. Abre un navegador VISIBLE,
 * ingresa la placa y espera a que la persona resuelva el Cloudflare Turnstile y
 * pulse "Realizar Busqueda". Luego captura el HTML y un screenshot del resultado
 * para escribir el parser real.
 *
 * Uso: npm run -w @app/worker probe-sunarp -- ABC123
 */

const plate = (process.argv[2] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
if (!plate) {
  console.error('Uso: npm run -w @app/worker probe-sunarp -- <PLACA>   (ej. ABC123)');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'sunarp', '__captured__');
mkdirSync(outDir, { recursive: true });

const S = PORTAL_SELECTORS.sunarp;

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}

const browser = await chromium.launch({ headless: false });
try {
  const context = await browser.newContext({ locale: 'es-PE' });
  const page = await context.newPage();
  await page.goto(S.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  try {
    await page.locator(S.plateInput).first().fill(plate);
    console.log(`\n✓ Placa "${plate}" ingresada en la ventana del navegador.`);
  } catch {
    console.log('\n(No pude autollenar la placa; ingrésala tú en la ventana.)');
  }

  console.log('\n>>> En la VENTANA del navegador:');
  console.log('    1. Resuelve el Cloudflare Turnstile si aparece (marca la casilla).');
  console.log('    2. Pulsa "Realizar Busqueda".');
  console.log('    3. Cuando veas el RESULTADO en pantalla, vuelve aquí y pulsa ENTER.\n');

  // Captura cuando el usuario pulsa ENTER, o automáticamente a los 4 minutos.
  await Promise.race([waitForEnter(), page.waitForTimeout(240000)]);

  const html = await page.content();
  writeFileSync(join(outDir, 'result.html'), html, 'utf8');
  await page.screenshot({ path: join(outDir, 'result.png'), fullPage: true });
  console.log(`\n✓ Capturado en: ${outDir}`);
  console.log('  - result.html (para escribir el parser)');
  console.log('  - result.png (captura de pantalla)');
} finally {
  await browser.close();
  process.exit(0);
}
