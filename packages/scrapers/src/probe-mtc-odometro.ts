/* eslint-disable no-console */
/**
 * PROBE DEFINITIVO: ¿la consulta CITV del MTC (rec.mtc.gob.pe/Citv/ArConsultaCitv) expone el
 * KILOMETRAJE / ODÓMETRO por placa? El portal es jQuery/AJAX → la vista renderizada podría NO
 * mostrar el km aunque la RESPUESTA de red sí lo traiga. Este probe captura TODAS las respuestas
 * de red tras "Buscar" (y el body renderizado) y busca km/kilometraje/odómetro. Resuelve la
 * contradicción entre las fuentes (unas dicen que sí, otras que la RTV "no audita el odómetro").
 *
 *   VPS: set -a; . /root/placape.env; set +a; DISPLAY=:99 npx tsx packages/scrapers/src/probe-mtc-odometro.ts ATL056
 * (ATL056 tiene CITV VIGENTE → hay resultado que inspeccionar.)
 */
import { chromium } from 'playwright';
import { createCaptchaSolver } from './captcha/index.js';

const URL = 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const plate = (process.argv[2] ?? 'ATL056').toUpperCase().replace(/[^A-Z0-9]/g, '');
const KEY = process.env.CAPTCHA_API_KEY ?? '';
const RX_KM = /kilometraj|kil[oó]metr|kilometr|od[oó]metr|\bkm\b|recorrid|mileage/i;

(async () => {
  if (!KEY) { console.log('falta CAPTCHA_API_KEY'); process.exit(1); }
  const solver = createCaptchaSolver({ provider: process.env.CAPTCHA_PROVIDER ?? 'capsolver', apiKey: KEY });
  const browser = await chromium.launch({ headless: true });
  const captured: Array<{ url: string; ct: string; body: string }> = [];
  try {
    const ctx = await browser.newContext({ locale: 'es-PE' });
    const page = await ctx.newPage();
    page.on('response', (resp) => {
      const u = resp.url();
      if (/\.(js|css|png|jpe?g|svg|gif|woff2?|ico)(\?|$)/i.test(u)) return;
      void resp.text().then((t) => { if (t && t.length > 2) captured.push({ url: u, ct: resp.headers()['content-type'] ?? '', body: t }); }).catch(() => {});
    });
    let dialog = '';
    page.on('dialog', (d) => { dialog = d.message(); d.accept().catch(() => {}); });
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(1500);
    const sel = page.locator('#selBUS_Filtro');

    for (let i = 1; i <= 4; i++) {
      if (i > 1) { await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await wait(1500); }
      await sel.selectOption({ label: 'Placa' }).catch(async () => { await sel.selectOption({ index: 1 }).catch(() => {}); });
      await wait(500);
      await page.locator('#texFiltro').fill(plate);
      const img = page.locator('#imgCaptcha');
      await img.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      await wait(1200);
      const cap = (await solver.solveImage((await img.screenshot()).toString('base64'))).trim();
      await page.locator('#texCaptcha').fill(cap);
      captured.length = 0; dialog = '';
      await page.locator('#btnBuscar').click().catch(() => {});
      await wait(6000);
      const body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
      if (/(captcha|c[oó]digo)/i.test(dialog) && /(incorrect|inv[aá]lid|no es v)/i.test(dialog)) { console.log(`intento ${i}: captcha rechazado → reintento`); continue; }
      const conCert = /C-\d{4}-/.test(body);
      console.log(`\nintento ${i}: dialog="${dialog.slice(0, 70)}" · resultado con certificado=${conCert}`);
      console.log(`\n================ ¿KM EN EL BODY RENDERIZADO? → ${RX_KM.test(body) ? 'SÍ' : 'NO'} ================`);
      if (RX_KM.test(body)) { const ix = body.search(RX_KM); console.log('  contexto:', body.slice(Math.max(0, ix - 80), ix + 200)); }
      console.log(`\n================ RESPUESTAS DE RED TRAS "BUSCAR" (${captured.length}) ================`);
      for (const r of captured) {
        const hasKm = RX_KM.test(r.body);
        console.log(`\n--- ${r.ct} · ${r.url}\n    KM=${hasKm ? '★ SÍ ★' : 'no'} · ${r.body.length} bytes`);
        if (hasKm) { const ix = r.body.search(RX_KM); console.log('  ★ CONTEXTO KM:', r.body.slice(Math.max(0, ix - 100), ix + 250).replace(/\s+/g, ' ')); }
        else console.log('  muestra:', r.body.slice(0, 260).replace(/\s+/g, ' '));
      }
      // Además: nombres de todos los campos/labels de la respuesta (por si el km está con otro nombre).
      const labels = Array.from(new Set((body.match(/[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]{3,30}(?=\s*:|\s{2,})/g) ?? []).map((s) => s.trim()))).slice(0, 40);
      console.log('\n================ ETIQUETAS/CAMPOS visibles (para ver si el km va con otro nombre) ================');
      console.log(labels.join(' | '));
      break;
    }
  } catch (e) { console.log('ERR', (e as Error).message); }
  finally { await browser.close().catch(() => {}); }
  process.exit(0);
})();
