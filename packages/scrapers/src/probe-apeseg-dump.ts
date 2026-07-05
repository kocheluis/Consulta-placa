/* eslint-disable no-console */
// Vuelca la estructura y la respuesta REAL de la consulta SOAT de APESEG (soat.com.pe / apeseg.org.pe),
// para reconstruir el scraper: SBS está congelado en "MAYO 2024" y no ve SOAT renovados después → hay
// que usar APESEG (tiempo real). Este probe: (1) inspecciona el form (inputs, action, iframes, captcha),
// (2) captura las requests de red, (3) resuelve el captcha de imagen y consulta la placa, (4) vuelca el
// body + tablas de la respuesta.
//
// Uso en el VPS: cd /root/app && npx tsx packages/scrapers/src/probe-apeseg-dump.ts B9K236
// Lee CAPTCHA_API_KEY de /root/placape.env (o OPERATOR_ENV_FILE) — no hace falta exportarla.
import { readFileSync } from 'node:fs';
import { chromium, type Page, type Frame } from 'playwright';
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

const plate = (process.argv[2] ?? 'B9K236').toUpperCase().replace(/[^A-Z0-9]/g, '');
const target = process.argv[3] ?? 'https://www.soat.com.pe/servicios-soat/';
const key = process.env.CAPTCHA_API_KEY ?? '';
if (!key) { console.error('Falta CAPTCHA_API_KEY (¿está en placape.env / OPERATOR_ENV_FILE?)'); process.exit(1); }
const solver = createCaptchaSolver({ provider: process.env.CAPTCHA_PROVIDER ?? 'capsolver', apiKey: key });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Busca en la página y en todos los frames el primer contexto que tenga `selector`. */
async function ctxWith(page: Page, selector: string): Promise<Page | Frame | null> {
  if (await page.locator(selector).count().catch(() => 0)) return page;
  for (const fr of page.frames()) { if (await fr.locator(selector).count().catch(() => 0)) return fr; }
  return null;
}

const b = await chromium.launch({ headless: true });
try {
  const ctx = await b.newContext({ locale: 'es-PE', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' });
  const p = await ctx.newPage();
  p.setDefaultTimeout(40000);

  // Captura la SECUENCIA de la API de APESEG (captcha → verify → login → certificados): método,
  // URL, header Authorization, postData y CUERPO de respuesta. Con esto se reconstruye el chain de
  // tokens sin adivinar y se escribe un scraper por `fetch` (sin DOM).
  const apiCalls: string[] = [];
  p.on('response', async (r) => {
    const req = r.request();
    const u = r.url();
    if (!/apeseg\.org\.pe\/(captcha-api|consulta-soat)\/api|\/certificados\//i.test(u)) return;
    let body = '';
    try { body = (await r.text()).slice(0, 2500); } catch { body = '<sin cuerpo>'; }
    const h = req.headers();
    const auth = h['authorization'] || h['x-token'] || h['token'] || '';
    apiCalls.push(
      `\n>>> ${req.method()} ${u}\n    status: ${r.status()}` +
      (auth ? `\n    Authorization: ${auth.slice(0, 80)}` : '') +
      (req.postData() ? `\n    reqData: ${req.postData()!.slice(0, 500)}` : '') +
      `\n    RESP: ${body}`,
    );
  });

  console.log('APESEG DUMP · placa', plate, '· target', target);
  await p.goto(target, { waitUntil: 'networkidle', timeout: 60000 });
  await wait(2500);

  // ── (1) Estructura: forms, inputs, iframes, imgs de captcha (página + frames) ──
  const dumpStructure = async (where: Page | Frame, tag: string) => {
    const forms = await where.$$eval('form', (fs) => fs.map((f) => ({ action: f.action, method: f.method, id: f.id }))).catch(() => []);
    const inputs = await where.$$eval('input,select,button', (els) => els.map((e) => ({
      tag: e.tagName, type: (e as HTMLInputElement).type || '', id: e.id, name: (e as HTMLInputElement).name || '',
      ph: (e as HTMLInputElement).placeholder || '', txt: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
    }))).catch(() => []);
    const imgs = await where.$$eval('img', (is) => is.filter((i) => /captcha|codigo/i.test(i.src + i.className + i.id)).map((i) => ({ src: i.src, id: i.id, cls: i.className }))).catch(() => []);
    console.log(`\n===== ${tag} · forms =====`, JSON.stringify(forms));
    console.log(`===== ${tag} · inputs/botones =====`, JSON.stringify(inputs));
    console.log(`===== ${tag} · captcha imgs =====`, JSON.stringify(imgs));
  };
  await dumpStructure(p, 'PÁGINA');
  const frames = p.frames().filter((f) => f !== p.mainFrame());
  console.log(`\n===== IFRAMES (${frames.length}) =====`, JSON.stringify(frames.map((f) => f.url())));
  for (let i = 0; i < frames.length; i++) await dumpStructure(frames[i]!, `IFRAME#${i}`);

  // ── (2) Consulta real: placa + captcha de imagen + submit ──
  const placaSel = 'input[name*="laca" i], input[id*="laca" i], input[placeholder*="laca" i]';
  const capSel = 'input[name*="aptcha" i], input[id*="aptcha" i], input[placeholder*="digo" i], input[placeholder*="aptcha" i]';
  const imgSel = 'img[src*="captcha" i], img[class*="aptcha" i], img[id*="aptcha" i]';
  const btnSel = 'button:has-text("Consultar"), input[type="submit"], button[type="submit"], a:has-text("Consultar")';

  const cx = (await ctxWith(p, placaSel)) ?? p;
  console.log('\n>> contexto del form:', cx === p ? 'página principal' : 'iframe');
  const placaInput = cx.locator(placaSel).first();
  const capInput = cx.locator(capSel).first();
  const img = cx.locator(imgSel).first();

  if (!(await placaInput.count().catch(() => 0))) { console.log('!! no encontré input de placa — revisa el dump de estructura arriba.'); }
  else {
    await placaInput.fill(plate).catch((e) => console.log('fill placa:', (e as Error).message));
    let cap = '';
    if (await img.count().catch(() => 0)) {
      const b64 = (await img.screenshot().catch(() => Buffer.from(''))).toString('base64');
      cap = (await solver.solveImage(b64).catch((e) => { console.log('solveImage:', (e as Error).message); return ''; })).trim();
      console.log('captcha resuelto:', JSON.stringify(cap));
      if (await capInput.count().catch(() => 0)) await capInput.fill(cap).catch(() => {});
      else console.log('!! no encontré input de captcha');
    } else console.log('!! no encontré img de captcha (¿reCAPTCHA? ¿otro selector?)');

    await cx.locator(btnSel).first().click().catch((e) => console.log('click:', (e as Error).message));
    await wait(8000); // deja completar la cadena captcha→verify→login→certificados y sus respuestas
    await p.waitForLoadState('networkidle').catch(() => {});

    // La respuesta puede quedar en la página o en un iframe → busca el texto del resultado en todos.
    const resCx = (await ctxWith(p, 'text=/vigente|compa[nñ][ií]a|certificado|no se encontr|no registr/i')) ?? p;
    const body = (await resCx.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
    console.log('\n===== RESPUESTA · body innerText (primeros 5000) =====\n' + body.slice(0, 5000));
    const tables = await resCx.$$eval('table', (ts) => ts.map((t, i) => ({
      i, rows: Array.from(t.querySelectorAll('tr')).slice(0, 12).map((tr) => Array.from(tr.querySelectorAll('th,td')).map((c) => (c.textContent || '').trim())),
    }))).catch(() => []);
    console.log(`\n===== TABLAS (${tables.length}) =====`);
    for (const t of tables) console.log(`-- table #${t.i} --\n`, JSON.stringify(t.rows));
    await p.screenshot({ path: '/root/out/apeseg-probe.png', fullPage: true }).catch(() => {});
    console.log('\n(screenshot: /root/out/apeseg-probe.png)');
  }

  await wait(1500); // deja resolver los cuerpos de respuesta pendientes antes de imprimir
  console.log('\n===== API APESEG (secuencia con cuerpos de respuesta) =====');
  for (const c of apiCalls) console.log(c);
} finally {
  await b.close();
  process.exit(0);
}
