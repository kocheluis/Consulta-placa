/* eslint-disable no-console */
// DISCOVERY del flujo "Impuesto Vehicular · Búsqueda por placa" del SAT de Lima (VirtualSAT).
// Vuelca la estructura REAL de cada paso para escribir el scraper (Capa B) SIN adivinar selectores:
//   (1) estructura del módulo (forms/inputs/SELECTS con sus options/botones/tabs/captcha),
//   (2) selecciona "Impuesto Vehicular" + "Búsqueda por placa" y re-vuelca (el postback cambia el DOM),
//   (3) placa + captcha de imagen (CapSolver) + Buscar → vuelca la LISTA DE CONTRIBUYENTES (tabla+links),
//   (4) clic en el 1er contribuyente → vuelca la TABLA DE CUOTAS (Año/Cuota/Total/Pagado/Estado/Referencia).
//
// Uso en el VPS: cd /root/app && npx tsx packages/scrapers/src/probe-sat-impuesto.ts CHU444
//   (opcional) pasar otra URL de entrada como 2º argumento si el módulo directo no carga.
// Lee CAPTCHA_API_KEY de /root/placape.env (o OPERATOR_ENV_FILE) — no hace falta exportarla.
import { readFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
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

const plate = (process.argv[2] ?? 'CHU444').toUpperCase().replace(/[^A-Z0-9]/g, '');
const target = process.argv[3] ?? 'https://www.sat.gob.pe/VirtualSAT/modulos/BusquedaTributario.aspx';
const key = process.env.CAPTCHA_API_KEY ?? '';
if (!key) { console.error('Falta CAPTCHA_API_KEY (¿está en placape.env / OPERATOR_ENV_FILE?)'); process.exit(1); }
const solver = createCaptchaSolver({ provider: process.env.CAPTCHA_PROVIDER ?? 'capsolver', apiKey: key });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Vuelca inputs/selects (con sus options)/botones + tabs/links + imgs de captcha del contexto. */
async function dump(p: Page, tag: string): Promise<void> {
  const inputs = await p.$$eval('input,button', (els) => els.map((e) => ({
    tag: e.tagName, type: (e as HTMLInputElement).type || '', id: e.id, name: (e as HTMLInputElement).name || '',
    val: ((e as HTMLInputElement).value || '').slice(0, 24), txt: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    vis: (e as HTMLElement).offsetParent !== null,
  })).filter((e) => e.vis || e.id || e.name)).catch(() => []);
  const selects = await p.$$eval('select', (ss) => ss.map((s) => ({
    id: s.id, name: s.name, options: Array.from(s.options).map((o) => ({ v: o.value, t: (o.textContent || '').trim() })),
  }))).catch(() => []);
  const tabs = await p.$$eval('a,li,button,div[role="tab"]', (els) => els
    .map((e) => ({ id: e.id, txt: (e.textContent || '').replace(/\s+/g, ' ').trim() }))
    .filter((e) => /impuesto vehicular|impuesto predial|arbitrios|alcabala|multas|b[uú]squeda por placa/i.test(e.txt) && e.txt.length < 60)).catch(() => []);
  const imgs = await p.$$eval('img', (is) => is.filter((i) => /captcha|codigo|seguridad/i.test(i.src + i.className + i.id)).map((i) => ({ id: i.id, cls: i.className, src: i.src.slice(0, 60) }))).catch(() => []);
  console.log(`\n===== ${tag} · inputs/botones =====\n`, JSON.stringify(inputs));
  console.log(`===== ${tag} · SELECTS (con options) =====\n`, JSON.stringify(selects));
  console.log(`===== ${tag} · tabs/opciones (texto clave) =====\n`, JSON.stringify(tabs));
  console.log(`===== ${tag} · captcha imgs =====\n`, JSON.stringify(imgs));
}

/** Vuelca todas las tablas (hasta 15 filas) y todos los links con texto — para ver contribuyentes/cuotas. */
async function dumpTables(p: Page, tag: string): Promise<void> {
  const tables = await p.$$eval('table', (ts) => ts.map((t, i) => ({
    i, id: t.id, rows: Array.from(t.querySelectorAll('tr')).slice(0, 15).map((tr) => Array.from(tr.querySelectorAll('th,td')).map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim())),
  })).filter((t) => t.rows.some((r) => r.length))).catch(() => []);
  const links = await p.$$eval('a', (as) => as.map((a) => ({ id: a.id, href: (a.getAttribute('href') || '').slice(0, 80), txt: (a.textContent || '').replace(/\s+/g, ' ').trim() })).filter((a) => a.txt && a.txt.length < 60 && (/\d{6,}/.test(a.txt) || /LOGISTIC|E\.I\.R\.L|S\.A|ARENAZA|contribuyente|seleccion|\d{4}/i.test(a.txt) || /__doPostBack/.test(a.href)))).catch(() => []);
  console.log(`\n===== ${tag} · TABLAS (${tables.length}) =====`);
  for (const t of tables) console.log(`-- table #${t.i} id=${t.id} --\n`, JSON.stringify(t.rows));
  console.log(`===== ${tag} · LINKS (contribuyentes/postback) =====\n`, JSON.stringify(links));
}

const solveInto = async (p: Page): Promise<string> => {
  const img = p.locator('img.captcha_class, img[src*="captcha" i], img[id*="aptcha" i]').first();
  if (!(await img.count().catch(() => 0))) { console.log('!! no encontré img de captcha'); return ''; }
  const b64 = (await img.screenshot().catch(() => Buffer.from(''))).toString('base64');
  const cap = (await solver.solveImage(b64).catch((e) => { console.log('solveImage:', (e as Error).message); return ''; })).trim();
  console.log('captcha resuelto:', JSON.stringify(cap));
  const capInput = p.locator('input[id*="aptcha" i], input[name*="aptcha" i], #ctl00_cplPrincipal_txtCaptcha').first();
  if (await capInput.count().catch(() => 0)) await capInput.fill(cap).catch(() => {});
  else console.log('!! no encontré input de captcha');
  return cap;
};

const b = await chromium.launch({ headless: true });
try {
  const ctx = await b.newContext({ locale: 'es-PE', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' });
  const p = await ctx.newPage();
  p.setDefaultTimeout(40000);

  console.log('SAT IMPUESTO DUMP · placa', plate, '· target', target);
  await p.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto:', (e as Error).message));
  await wait(2000);
  console.log('\n>> URL tras goto:', p.url());
  await dump(p, 'PASO 0 · inicial');

  // ── PASO 1: tab "Impuesto Vehicular" + opción "Búsqueda por placa" ──
  const vehTab = p.locator('a:has-text("Impuesto Vehicular"), button:has-text("Impuesto Vehicular"), [role="tab"]:has-text("Impuesto Vehicular")').first();
  if (await vehTab.count().catch(() => 0)) { await vehTab.click().catch((e) => console.log('click tab veh:', (e as Error).message)); await wait(1500); console.log('>> clic en tab Impuesto Vehicular'); }
  // El "Seleccione una opción de búsqueda" es un <select>: elegimos la option que diga "placa".
  for (const sel of await p.locator('select').all()) {
    const opts = await sel.locator('option').allTextContents().catch(() => []);
    const placaOpt = opts.find((o) => /placa/i.test(o));
    if (placaOpt) { await sel.selectOption({ label: placaOpt }).catch((e) => console.log('selectOption placa:', (e as Error).message)); await wait(1500); console.log('>> seleccioné opción:', JSON.stringify(placaOpt)); break; }
  }
  await dump(p, 'PASO 1 · tras elegir vehicular/por-placa');

  // ── PASO 2: placa + captcha + Buscar ──
  const placaInput = p.locator('input[id*="laca" i], input[name*="laca" i], input[placeholder*="laca" i]').first();
  if (!(await placaInput.count().catch(() => 0))) { console.log('!! no encontré input de placa (revisa el dump del PASO 1)'); }
  else {
    await placaInput.fill(plate).catch((e) => console.log('fill placa:', (e as Error).message));
    await solveInto(p);
    await Promise.all([
      p.waitForLoadState('domcontentloaded').catch(() => {}),
      p.locator('input[value*="Buscar" i], button:has-text("Buscar"), a:has-text("Buscar"), #ctl00_cplPrincipal_btnBuscar').first().click().catch((e) => console.log('click Buscar:', (e as Error).message)),
    ]);
    await wait(3500);
    await p.waitForLoadState('networkidle').catch(() => {});
    const body = (await p.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
    console.log('\n===== PASO 2 · body innerText (primeros 2500) =====\n' + body.slice(0, 2500));
    await dumpTables(p, 'PASO 2 · lista de contribuyentes');
    await p.screenshot({ path: '/root/out/sat-impuesto-1.png', fullPage: true }).catch(() => {});

    // ── PASO 3: clic en el 1er contribuyente → tabla de cuotas ──
    const contrib = p.locator('table a, a[href*="__doPostBack"]').filter({ hasText: /\d{4,}|LOGISTIC|ARENAZA|E\.I\.R\.L|S\.A/i }).first();
    if (await contrib.count().catch(() => 0)) {
      console.log('\n>> clic en 1er contribuyente:', JSON.stringify((await contrib.textContent().catch(() => '') ?? '').trim()));
      await Promise.all([p.waitForLoadState('domcontentloaded').catch(() => {}), contrib.click().catch((e) => console.log('click contrib:', (e as Error).message))]);
      await wait(3500);
      await p.waitForLoadState('networkidle').catch(() => {});
      const body2 = (await p.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
      console.log('\n===== PASO 3 · body innerText (primeros 2500) =====\n' + body2.slice(0, 2500));
      await dumpTables(p, 'PASO 3 · tabla de cuotas');
      await p.screenshot({ path: '/root/out/sat-impuesto-2.png', fullPage: true }).catch(() => {});
    } else console.log('!! no encontré link de contribuyente para clicar (revisa LINKS del PASO 2)');
  }
  console.log('\n(screenshots: /root/out/sat-impuesto-1.png, /root/out/sat-impuesto-2.png)');
} finally {
  await b.close();
  process.exit(0);
}
