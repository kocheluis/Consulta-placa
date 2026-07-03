/* eslint-disable no-console */
// Vuelca la ESTRUCTURA real de la tabla de resultados de Callao para una placa, para afinar el
// parser (conteo de papeletas + beneficio de pronto pago) sin adivinar. Uso en el VPS:
//   cd /root/app && npx tsx packages/scrapers/src/probe-callao-dump.ts ADY067
// Lee CAPTCHA_API_KEY de /root/placape.env (o OPERATOR_ENV_FILE) — no hace falta exportarla.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createCaptchaSolver } from './captcha/index.js';
import { evalCaptchaMath } from './operator/sources.js';

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

const b = await chromium.launch({ headless: true });
try {
  const p = await (await b.newContext({ locale: 'es-PE' })).newPage();
  p.setDefaultTimeout(40000);
  let dialog = '';
  p.on('dialog', (d) => { dialog = d.message(); d.accept().catch(() => {}); });
  console.log('Callao DUMP · placa', plate);
  await p.goto('https://pagopapeletascallao.pe/', { waitUntil: 'networkidle' });
  await wait(2000);
  const tipo = p.locator('#tipo_busqueda');
  const selPlaca = async () => {
    if (await tipo.count()) {
      const opts = await tipo.locator('option').allTextContents();
      const po = opts.find((o) => /placa/i.test(o));
      if (po) await tipo.selectOption({ label: po }).catch(() => {});
      await wait(500);
    }
  };
  const valor = p.locator('#valor_busqueda');
  const capInput = p.locator('#captcha');
  const capImg = p.locator('img[src^="data:image"]').first();
  const ERR = /error al ingresar/i; // robusto al mojibake ("cÃ³digo de seguridad")
  const NODATA = /no hay resultados para mostrar/i;

  let dumped = false;
  for (let i = 1; i <= 8 && !dumped; i++) {
    if (i > 1) { await p.reload({ waitUntil: 'networkidle' }); await wait(1500); }
    await selPlaca();
    await valor.fill(plate);
    await capImg.waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
    const raw = (await solver.solveImage((await capImg.screenshot()).toString('base64'))).trim();
    const sol = evalCaptchaMath(raw);
    console.log(`intento ${i}: captcha="${raw}"${sol !== raw ? ` → ${sol}` : ''}`);
    await capInput.fill(sol);
    dialog = '';
    await p.locator('button:has-text("Buscar"), input[value*="Buscar" i]').first().click().catch(() => {});
    await wait(4500);
    const body = (await p.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
    if (ERR.test(body) || /captcha|seguridad/i.test(dialog)) { console.log('   captcha rechazado, reintento…'); continue; }

    // Éxito (o SIN_REGISTRO): volcar la estructura para afinar el parser.
    console.log('\n===== ' + (NODATA.test(body) ? 'SIN PAPELETAS' : 'CON RESULTADOS') + ' =====');
    console.log('\n===== BODY innerText (primeros 7000) =====\n' + body.slice(0, 7000));
    const tables = await p.$$eval('table', (ts) => ts.map((t, i) => {
      const rows = Array.from(t.querySelectorAll('tr')).map((tr) =>
        Array.from(tr.querySelectorAll('th,td')).map((c) => (c.textContent || '').trim()));
      return { i, rowCount: rows.length, firstRows: rows.slice(0, 6), htmlHead: t.outerHTML.slice(0, 1600) };
    }));
    console.log(`\n===== ${tables.length} TABLE(S) =====`);
    for (const t of tables) {
      console.log(`\n-- table #${t.i} · ${t.rowCount} filas --`);
      console.log('  primeras filas:', JSON.stringify(t.firstRows));
      console.log('  HTML(head):', t.htmlHead.replace(/\s+/g, ' '));
    }
    dumped = true;
  }
  if (!dumped) console.log('\n✖ No se pudo pasar el captcha en 8 intentos.');
} finally {
  await b.close();
  process.exit(0);
}
