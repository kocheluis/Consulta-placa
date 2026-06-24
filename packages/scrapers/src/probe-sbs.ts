/* eslint-disable no-console */
import { chromium } from 'playwright';
import { createCaptchaSolver } from './captcha/index.js';

/**
 * Prueba EN VIVO de SBS (reportesoat) — reCAPTCHA v3 (score) vía CapSolver.
 * Uso: npx tsx packages/scrapers/src/probe-sbs.ts BTF268
 */
const plate = (process.argv[2] ?? 'BTF268').toUpperCase().replace(/[^A-Z0-9]/g, '');
const key = process.env.CAPTCHA_API_KEY ?? '';
if (!key) { console.error('Falta CAPTCHA_API_KEY'); process.exit(1); }
const solver = createCaptchaSolver({ provider: process.env.CAPTCHA_PROVIDER ?? 'capsolver', apiKey: key });
const OUT = 'd:/Jose/Proyecto_Consulta_placa/validacion-fuentes';
const URL = 'https://servicios.sbs.gob.pe/reportesoat/';
const SITEKEY = '6Ldq0D0hAAAAAJ2EfmS-gFvA1NprMh2MBcxtRLAL';
const ACTION = 'homepage';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch({ headless: true });
try {
  const p = await (await b.newContext({ locale: 'es-PE' })).newPage();
  p.setDefaultTimeout(45000);
  console.log(`SBS · placa ${plate}`);
  await p.goto(URL, { waitUntil: 'networkidle' });
  await wait(1500);

  // SOAT ya viene marcado por defecto; aseguramos.
  await p.locator('#ctl00_MainBodyContent_rblOpcionesSeguros_0').check().catch(() => {});
  await p.locator('#ctl00_MainBodyContent_txtPlaca').fill(plate);

  console.log('Resolviendo reCAPTCHA v3 con CapSolver (puede tardar 10-40s)…');
  const token = await solver.solveRecaptchaV3(SITEKEY, URL, ACTION);
  console.log('   token v3 recibido (len', token.length, ')');

  // Inyecta el token en el hidden y en cualquier g-recaptcha-response.
  // (string-eval para evitar el bug __name de tsx/esbuild dentro de evaluate)
  await p.evaluate(
    `(function(tok){function set(s){document.querySelectorAll(s).forEach(function(e){e.value=tok;});}set('#ctl00_MainBodyContent_hdnReCaptchaV3');set('[name="g-recaptcha-response"]');set('#g-recaptcha-response');})(${JSON.stringify(token)})`,
  );

  await p.locator('#ctl00_MainBodyContent_btnIngresarPla').click();
  await wait(6000);
  await p.waitForLoadState('networkidle').catch(() => {});

  const body = (await p.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ').trim();
  await p.screenshot({ path: `${OUT}/sbs-rev.png`, fullPage: true });
  // Marcadores de éxito vs error.
  const err = body.match(/(captcha|recaptcha|robot|verificaci[oó]n)[^.\n]{0,60}/i)?.[0];
  const ok = body.match(/(p[oó]liza|aseguradora|vigencia|SOAT|inicio de vigencia|n[oú]mero de certificado|no se encontr|no registra|no cuenta)[^.\n]{0,80}/i)?.[0];
  console.log('\n--- resultado ---');
  console.log('ok:', ok ?? 'NINGUNO');
  console.log('posible error:', err ?? 'ninguno');
  console.log('\ntexto (recorte):', body.slice(0, 600));
  console.log(`\nscreenshot: ${OUT}/sbs-rev.png`);
} catch (e) {
  console.error('ERROR:', (e as Error).message);
} finally {
  await b.close();
  process.exit(0);
}
