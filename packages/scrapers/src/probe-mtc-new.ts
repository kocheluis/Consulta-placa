/* eslint-disable no-console */
// Probe del NUEVO portal CITV del MTC (rec.mtc.gob.pe/Citv/ArConsultaCitv). El viejo
// (portal.mtc.gob.pe/reportedgtt/form/frmConsultaCITV.aspx) MURIÓ (302 → cuelga 60s). El nuevo
// reusa los mismos IDs (#selBUS_Filtro, #texFiltro, #imgCaptcha, #texCaptcha, #btnBuscar) pero es
// jQuery/AJAX. Corre el flujo con CapSolver y VUELCA el resultado para adaptar el parser.
//   VPS: set -a; . /root/placape.env; set +a; DISPLAY=:99 npx tsx packages/scrapers/src/probe-mtc-new.ts ADY067
import { chromium } from 'playwright';
import { createCaptchaSolver } from './captcha/index.js';

const URL = 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const plate = (process.argv[2] ?? 'ADY067').toUpperCase().replace(/[^A-Z0-9]/g, '');
const KEY = process.env.CAPTCHA_API_KEY ?? '';

(async () => {
  if (!KEY) { console.log('falta CAPTCHA_API_KEY'); process.exit(1); }
  const solver = createCaptchaSolver({ provider: process.env.CAPTCHA_PROVIDER ?? 'capsolver', apiKey: KEY });
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ locale: 'es-PE' });
    const page = await ctx.newPage();
    let dialog = '';
    page.on('dialog', (d) => { dialog = d.message(); d.accept().catch(() => {}); });
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(1500);
    console.log('cargó:', await page.title());

    const sel = page.locator('#selBUS_Filtro');
    console.log('opciones del filtro:', (await sel.locator('option').allTextContents()).join(' | '));

    const OK = /VIGENTE|VENCIDO|APROBADO|C-\d/i;                 // el resultado trae certificados
    const NODATA = /no se encontr|no existe|sin registro|no cuenta/i;
    const CAPERR = /(captcha|c[oó]digo)[^]{0,30}(incorrect|inv[aá]lid|err)|ingrese.*captcha/i;
    let done = false;
    for (let i = 1; i <= 4 && !done; i++) {
      if (i > 1) { await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await wait(1500); }
      await sel.selectOption({ label: 'Placa' }).catch(async () => { await sel.selectOption({ index: 1 }).catch(() => {}); });
      await wait(500);
      await page.locator('#texFiltro').fill(plate);
      // Captcha imagen (NO refrescar: leer la que ya cargó). Espera a que deje de estar "Cargando..".
      const img = page.locator('#imgCaptcha');
      await img.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      await wait(1200);
      const cap = (await solver.solveImage((await img.screenshot()).toString('base64'))).trim();
      await page.locator('#texCaptcha').fill(cap);
      const filled = await page.locator('#texCaptcha').inputValue().catch(() => '');
      dialog = '';
      await page.locator('#btnBuscar').click().catch(() => {});
      await wait(6000);
      const body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
      const modal = (await page.locator('#divModalCenter').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      const blob = `${dialog} ${modal} ${body}`;
      console.log(`intento ${i}: captcha OCR="${cap}" filled="${filled}" · dialog="${dialog.slice(0, 60)}" · modal="${modal.slice(0, 80)}"`);
      if (CAPERR.test(dialog) || CAPERR.test(modal)) { console.log('  → captcha incorrecto, reintento'); continue; }
      if (NODATA.test(blob)) { console.log('  → SIN REGISTRO CITV'); done = true; }
      if (OK.test(body)) {
        console.log('  → RESULTADO ENCONTRADO. Tablas con datos:');
        const tables = (await page.locator('table.table').allInnerTexts().catch(() => [])) as string[];
        tables.forEach((t, k) => { const s = t.replace(/\s+/g, ' ').trim(); if (s && OK.test(s)) console.log(`  [tabla ${k}] ${s.slice(0, 500)}`); });
        const idx = body.search(OK);
        console.log('  BODY:', body.slice(Math.max(0, idx - 60), idx + 400).replace(/\n{2,}/g, ' '));
        done = true;
      }
      if (!done && i === 4) console.log('  → sin resultado ni error claro tras 4 intentos');
      await page.screenshot({ path: `mtc-new-${plate}.png`, fullPage: true }).catch(() => {});
    }
  } catch (e) { console.log('ERR', (e as Error).message); }
  finally { await browser.close().catch(() => {}); }
  process.exit(0);
})();
