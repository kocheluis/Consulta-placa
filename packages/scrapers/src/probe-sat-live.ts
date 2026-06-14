import { chromium, type Frame, type Page } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createCaptchaSolver } from './captcha/index.js';

/**
 * Prueba EN VIVO del scraper de papeletas SAT Lima (reCAPTCHA v2 vía CapSolver).
 * Hace el flujo completo y vuelca el resultado para escribir el parser.
 *
 * Requiere CAPTCHA_API_KEY (CapSolver) en el entorno.
 * Uso: npm run -w @app/worker probe-sat-live -- CHU444
 */

const plate = (process.argv[2] ?? 'CHU444').toUpperCase().replace(/[^A-Z0-9]/g, '');
const key = process.env.CAPTCHA_API_KEY ?? '';
const PAGE_URL = 'https://www.sat.gob.pe/VirtualSAT/modulos/papeletas.aspx';
const SITEKEY = '6Ldy_wsTAAAAAGYM08RRQAMvF96g9O_SNQ9_hFIJ';

if (!key) {
  console.error('Falta CAPTCHA_API_KEY (CapSolver) en el entorno.');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'sat', '__captured__');
mkdirSync(outDir, { recursive: true });
// Funciona con CapSolver o 2Captcha según CAPTCHA_PROVIDER.
const provider = process.env.CAPTCHA_PROVIDER ?? 'capsolver';
const solver = createCaptchaSolver({ provider, apiKey: key });
console.log(`Proveedor de CAPTCHA: ${provider}`);

/** Busca, entre el frame principal y todos los frames, el que contiene el selector. */
async function findFrameWith(page: Page, selector: string): Promise<Frame | null> {
  for (const f of page.frames()) {
    if (await f.locator(selector).count().catch(() => 0)) return f;
  }
  return null;
}

const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ locale: 'es-PE' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);

  // 1) Crear sesión.
  console.log('1) Creando sesión en SAT…');
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // 2) Clic en "Consulta de papeletas" dentro del frame del menú → carga el formulario.
  const menuFrame = page.frames().find((f) => /bienvenida/i.test(f.url())) ?? page.mainFrame();
  const papeletasLink = menuFrame.locator('a[href*="papeletas.aspx"]').first();
  if (await papeletasLink.count()) {
    console.log('2) Abriendo formulario de papeletas…');
    await papeletasLink.click();
    await page.waitForTimeout(3500);
  }

  // 3) Ubicar el frame con el formulario.
  const formFrame = await findFrameWith(page, '#tipoBusquedaPapeletas');
  if (!formFrame) {
    console.error('No se encontró el formulario de papeletas.');
    writeFileSync(join(outDir, 'live-debug.html'), await page.content(), 'utf8');
    process.exit(1);
  }

  // 4) Seleccionar "Búsqueda por Placa" e ingresar la placa.
  console.log(`3) Seleccionando placa e ingresando ${plate}…`);
  await formFrame.selectOption('#tipoBusquedaPapeletas', 'busqPlaca').catch(() => {});
  await formFrame.waitForTimeout(1000);
  await formFrame.locator('#ctl00_cplPrincipal_txtPlaca').fill(plate);

  // 5) Resolver reCAPTCHA v2 con CapSolver e inyectar el token.
  console.log('4) Resolviendo reCAPTCHA v2 con CapSolver (puede tardar ~10-30s)…');
  const token = await solver.solveRecaptchaV2(SITEKEY, PAGE_URL);
  console.log('   token recibido, inyectando…');
  await formFrame.evaluate(
    `(function(){var els=document.querySelectorAll('#g-recaptcha-response,[name=g-recaptcha-response]');els.forEach(function(e){e.value=${JSON.stringify(token)};e.style.display='block';});})()`,
  );

  // 6) Enviar.
  console.log('5) Enviando consulta…');
  await formFrame.locator('#ctl00_cplPrincipal_CaptchaContinue').click();
  await page.waitForTimeout(6000);

  // 7) Capturar resultado.
  const resultFrame = (await findFrameWith(page, '#ctl00_cplPrincipal_txtPlaca')) ?? formFrame;
  const html = await resultFrame.content();
  writeFileSync(join(outDir, 'live-result.html'), html, 'utf8');
  await page.screenshot({ path: join(outDir, 'live-result.png'), fullPage: true }).catch(() => {});

  // Texto visible resumido para inspección rápida.
  const bodyText = (await resultFrame.locator('body').innerText().catch(() => '')).slice(0, 2000);
  console.log('\n===== TEXTO DEL RESULTADO (recortado) =====\n', bodyText);
  console.log(`\n✓ Guardado live-result.html / .png en ${outDir}`);
} catch (err) {
  console.error('ERROR:', (err as Error).message);
} finally {
  await browser.close();
  process.exit(0);
}
