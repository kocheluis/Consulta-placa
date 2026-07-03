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

    // Filtro = Placa.
    const sel = page.locator('#selBUS_Filtro');
    console.log('opciones del filtro:', (await sel.locator('option').allTextContents()).join(' | '));
    await sel.selectOption({ label: 'Placa' }).catch(async () => { await sel.selectOption({ index: 1 }).catch(() => {}); });
    await wait(600);
    await page.locator('#texFiltro').fill(plate);

    // Captcha imagen. #btnCaptcha suele (re)generar la imagen → clic y espera a que deje "Cargando..".
    const img = page.locator('#imgCaptcha');
    await page.locator('#btnCaptcha').click().catch(() => {});
    await wait(1500);
    await img.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await wait(500);
    const cap = (await solver.solveImage((await img.screenshot()).toString('base64'))).trim();
    console.log('captcha OCR:', cap);
    await page.locator('#texCaptcha').fill(cap);
    await page.locator('#btnBuscar').click();
    await wait(7000);

    const body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
    const modal = (await page.locator('#divModalCenter').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    console.log('--- DIALOG:', dialog || '(ninguno)');
    console.log('--- MODAL:', modal.slice(0, 250) || '(vacío)');
    const tables = (await page.locator('table.table').allInnerTexts().catch(() => [])) as string[];
    console.log(`--- TABLAS (${tables.length}) ---`);
    tables.forEach((t, i) => { const s = t.replace(/\s+/g, ' ').trim(); if (s) console.log(`[tabla ${i}] ${s.slice(0, 400)}`); });
    const idx = body.search(new RegExp(`${plate}|certificad|vigente|vencido|resultado|no se`, 'i'));
    console.log('--- BODY (contexto) ---');
    console.log(body.slice(Math.max(0, idx - 20), idx + 500).replace(/\n{2,}/g, '\n'));
    await page.screenshot({ path: `mtc-new-${plate}.png`, fullPage: true }).catch(() => {});
    console.log(`screenshot: mtc-new-${plate}.png`);
  } catch (e) { console.log('ERR', (e as Error).message); }
  finally { await browser.close().catch(() => {}); }
  process.exit(0);
})();
