/* eslint-disable no-console */
// Vuelca la estructura del reporte SBS (SOAT + siniestralidad) y las opciones de tipo de seguro
// (SOAT / Vehicular / CAT), para dar más detalle de siniestralidad (#3) y evaluar consultar CAT (#4).
// Uso en el VPS: cd /root/app && npx tsx packages/scrapers/src/probe-sbs-dump.ts ADY067
// Lee CAPTCHA_API_KEY de /root/placape.env (o OPERATOR_ENV_FILE) — no hace falta exportarla.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createCaptchaSolver } from './captcha/index.js';

(function loadEnvFile() {
  const f = process.env.OPERATOR_ENV_FILE ?? '/root/placape.env';
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[1]) process.env[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '');
    }
  } catch { /* sin archivo → nada */ }
})();

const plate = (process.argv[2] ?? 'ADY067').toUpperCase().replace(/[^A-Z0-9]/g, '');
const key = process.env.CAPTCHA_API_KEY ?? '';
if (!key) { console.error('Falta CAPTCHA_API_KEY (¿está en placape.env / OPERATOR_ENV_FILE?)'); process.exit(1); }
const solver = createCaptchaSolver({ provider: process.env.CAPTCHA_PROVIDER ?? 'capsolver', apiKey: key });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SBS_SITEKEY = '6Ldq0D0hAAAAAJ2EfmS-gFvA1NprMh2MBcxtRLAL';
const URL = 'https://servicios.sbs.gob.pe/reportesoat/';

const b = await chromium.launch({ headless: true });
try {
  const p = await (await b.newContext({ locale: 'es-PE' })).newPage();
  p.setDefaultTimeout(40000);
  console.log('SBS DUMP · placa', plate);
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });

  // Opciones de tipo de seguro (SOAT / Vehicular / CAT): id + value + etiqueta.
  const radios = await p.$$eval('#ctl00_MainBodyContent_rblOpcionesSeguros input, input[name*="rblOpcionesSeguros"]',
    (els) => els.map((e, i) => ({ i, id: (e as HTMLInputElement).id, value: (e as HTMLInputElement).value, label: (e.closest('td,label')?.textContent || '').replace(/\s+/g, ' ').trim() }))).catch(() => []);
  console.log('Opciones de tipo de seguro:', JSON.stringify(radios));

  const OK = /resultado de (la )?b[uú]squeda|listado de p[oó]lizas|n[uú]mero de accidentes|no se encontr|no registra/i;
  let done = false;
  for (let i = 1; i <= 3 && !done; i++) {
    if (i > 1) { await p.reload({ waitUntil: 'networkidle' }); await wait(1000); }
    await p.locator('#ctl00_MainBodyContent_rblOpcionesSeguros_0').check().catch(() => {}); // 0 = SOAT
    await p.locator('#ctl00_MainBodyContent_txtPlaca').fill(plate);
    const token = await solver.solveRecaptchaV3(SBS_SITEKEY, URL, 'homepage');
    await p.evaluate(`(function(tok){function set(s){document.querySelectorAll(s).forEach(function(e){e.value=tok;});}set('#ctl00_MainBodyContent_hdnReCaptchaV3');set('[name="g-recaptcha-response"]');set('#g-recaptcha-response');})(${JSON.stringify(token)})`);
    await p.locator('#ctl00_MainBodyContent_btnIngresarPla').click();
    await wait(5000);
    await p.waitForLoadState('networkidle').catch(() => {});
    const body = (await p.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
    if (!OK.test(body)) { console.log(`intento ${i}: reCAPTCHA rechazado / sin datos, reintento…`); continue; }

    console.log('\n===== SBS BODY innerText (primeros 8000) =====\n' + body.slice(0, 8000));
    const tables = await p.$$eval('table', (ts) => ts.map((t, i) => {
      const rows = Array.from(t.querySelectorAll('tr')).map((tr) =>
        Array.from(tr.querySelectorAll('th,td')).map((c) => (c.textContent || '').trim()));
      return { i, rowCount: rows.length, firstRows: rows.slice(0, 8), htmlHead: t.outerHTML.slice(0, 1600) };
    }));
    console.log(`\n===== ${tables.length} TABLE(S) =====`);
    for (const t of tables) {
      console.log(`\n-- table #${t.i} · ${t.rowCount} filas --`);
      console.log('  filas:', JSON.stringify(t.firstRows));
      console.log('  HTML(head):', t.htmlHead.replace(/\s+/g, ' '));
    }
    done = true;
  }
  if (!done) console.log('\n✖ No se obtuvo el reporte SBS en 3 intentos.');
} finally {
  await b.close();
  process.exit(0);
}
