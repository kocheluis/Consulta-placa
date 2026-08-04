/* eslint-disable no-console */
// DISCOVERY del flujo "Impuesto Vehicular · Búsqueda por placa" del SAT de Lima (VirtualSAT).
// El módulo directo (BusquedaTributario.aspx) REBOTA a principal.aspx (la reja "Consultas en línea"):
// el contenido vive en iframe(s) y/o hay que entrar por "Consulta Tributos". Este probe explora:
//   PASO 0: árbol de FRAMES + TODOS los links/botones/inputs/selects de cada frame (para ver la reja),
//   PASO 1: clic en "Consulta Tributos"/"Tributo detalles" → re-vuelca frames/estructura,
//   PASO 2: clic en tab "Impuesto Vehicular" + opción "Búsqueda por placa" → vuelca el form,
//   PASO 3: placa + captcha (CapSolver) + Buscar → LISTA DE CONTRIBUYENTES (tabla+links),
//   PASO 4: clic en 1er contribuyente → TABLA DE CUOTAS.
// Cada paso es best-effort y vuelca lo que haya (nunca crashea). Uso en el VPS:
//   cd /root/app && npx tsx packages/scrapers/src/probe-sat-impuesto.ts CHU444
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

const plate = (process.argv[2] ?? 'CHU444').toUpperCase().replace(/[^A-Z0-9]/g, '');
const target = process.argv[3] ?? 'https://www.sat.gob.pe/VirtualSAT/modulos/BusquedaTributario.aspx';
const key = process.env.CAPTCHA_API_KEY ?? '';
if (!key) { console.error('Falta CAPTCHA_API_KEY (¿está en placape.env / OPERATOR_ENV_FILE?)'); process.exit(1); }
const solver = createCaptchaSolver({ provider: process.env.CAPTCHA_PROVIDER ?? 'capsolver', apiKey: key });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Ctx = Page | Frame;

/** Vuelca inputs/selects(+options)/botones/anchors de UN contexto (page o frame). */
async function dumpCtx(ctx: Ctx, tag: string): Promise<void> {
  const inputs = await ctx.$$eval('input,button', (els) => els.map((e) => ({
    tag: e.tagName, type: (e as HTMLInputElement).type || '', id: e.id, name: (e as HTMLInputElement).name || '',
    val: ((e as HTMLInputElement).value || '').slice(0, 24), txt: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
  })).filter((e) => e.id || e.name || e.txt || e.val)).catch(() => []);
  const selects = await ctx.$$eval('select', (ss) => ss.map((s) => ({
    id: s.id, name: s.name, options: Array.from(s.options).map((o) => ({ v: o.value, t: (o.textContent || '').trim() })),
  }))).catch(() => []);
  const links = await ctx.$$eval('a,[onclick],div[role="button"],li[onclick]', (els) => els.map((e) => ({
    tag: e.tagName, id: e.id, href: (e.getAttribute('href') || '').slice(0, 70), onclick: (e.getAttribute('onclick') || '').slice(0, 70),
    txt: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
  })).filter((e) => e.txt && e.txt.length < 50)).catch(() => []);
  const imgs = await ctx.$$eval('img', (is) => is.filter((i) => /captcha|codigo|seguridad/i.test(i.src + i.className + i.id)).map((i) => ({ id: i.id, cls: i.className }))).catch(() => []);
  if (inputs.length) console.log(`  [${tag}] inputs/botones:`, JSON.stringify(inputs));
  if (selects.length) console.log(`  [${tag}] SELECTS:`, JSON.stringify(selects));
  if (links.length) console.log(`  [${tag}] links/clickables:`, JSON.stringify(links));
  if (imgs.length) console.log(`  [${tag}] captcha imgs:`, JSON.stringify(imgs));
  if (!inputs.length && !selects.length && !links.length) console.log(`  [${tag}] (vacío)`);
}

/** Vuelca el árbol de frames + la estructura de cada uno. */
async function dumpAll(p: Page, step: string): Promise<void> {
  const frames = p.frames();
  console.log(`\n========== ${step} · URL=${p.url()} · ${frames.length} frame(s) ==========`);
  for (let i = 0; i < frames.length; i++) {
    const fr = frames[i]!;
    await dumpCtx(fr, fr === p.mainFrame() ? 'main' : `frame#${i}:${fr.url().slice(0, 55)}`);
  }
}

/** Vuelca tablas (≤15 filas) + links en TODOS los frames (para ver contribuyentes/cuotas). */
async function dumpTables(p: Page, step: string): Promise<void> {
  console.log(`\n========== ${step} · TABLAS/LINKS ==========`);
  for (const fr of p.frames()) {
    const tables = await fr.$$eval('table', (ts) => ts.map((t, i) => ({
      i, id: t.id, rows: Array.from(t.querySelectorAll('tr')).slice(0, 15).map((tr) => Array.from(tr.querySelectorAll('th,td')).map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim())),
    })).filter((t) => t.rows.some((r) => r.join('').length))).catch(() => []);
    const links = await fr.$$eval('a', (as) => as.map((a) => ({ id: a.id, href: (a.getAttribute('href') || '').slice(0, 80), txt: (a.textContent || '').replace(/\s+/g, ' ').trim() })).filter((a) => a.txt && a.txt.length < 60)).catch(() => []);
    if (tables.length) { console.log(`  -- ${fr === p.mainFrame() ? 'main' : fr.url().slice(0, 55)} --`); for (const t of tables) console.log(`     table#${t.i} id=${t.id}:`, JSON.stringify(t.rows)); }
    if (links.length) console.log(`     links:`, JSON.stringify(links));
  }
}

/** Clic en el 1er elemento cuyo texto matchee `rx`, en CUALQUIER frame. Devuelve el frame donde clicó. */
async function clickByText(p: Page, rx: RegExp, sel = 'a,button,[role="tab"],[onclick],li,span,div'): Promise<Ctx | null> {
  for (const fr of p.frames()) {
    const loc = fr.locator(sel).filter({ hasText: rx }).first();
    if (await loc.count().catch(() => 0)) { await loc.click({ timeout: 8000 }).catch((e) => console.log('  click err:', (e as Error).message)); return fr; }
  }
  return null;
}

const b = await chromium.launch({ headless: true });
try {
  const ctx = await b.newContext({ locale: 'es-PE', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' });
  const p = await ctx.newPage();
  p.setDefaultTimeout(40000);

  console.log('SAT IMPUESTO DUMP v2 · placa', plate, '· target', target);
  await p.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto:', (e as Error).message));
  await wait(2500);
  await dumpAll(p, 'PASO 0 · reja inicial');

  // ── PASO 1: navegar DIRECTO al módulo "Tributo detalles" (tributosRef.aspx?tri=V = Vehicular) ──
  // La reja vive en el frame bienvenida.aspx; su link trae el mysession de la sesión. Ir directo a esa
  // URL es más robusto que clicar dentro del frameset (el link apunta a otro target y el frame no cambia).
  let modUrl = '';
  for (const fr of p.frames()) {
    const a = fr.locator('a[href*="tributosRef.aspx"], a:has-text("Tributo detalles")').first();
    if (await a.count().catch(() => 0)) {
      const href = await a.getAttribute('href').catch(() => '');
      if (href) { modUrl = new URL(href, fr.url()).toString(); break; }
    }
  }
  console.log('\n>> PASO 1: módulo Tributo detalles →', modUrl || 'NO ENCONTRADO');
  if (modUrl) { await p.goto(modUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('  goto mod:', (e as Error).message)); await wait(2500); }
  await dumpAll(p, 'PASO 1 · módulo tributosRef (impuesto vehicular)');

  // ── PASO 2: tab "Impuesto Vehicular" + opción "Búsqueda por placa" ──
  await clickByText(p, /impuesto\s+vehicular/i);
  await wait(1500);
  for (const fr of p.frames()) {
    for (const sel of await fr.locator('select').all()) {
      const opts = await sel.locator('option').allTextContents().catch(() => []);
      const placaOpt = opts.find((o) => /placa/i.test(o));
      if (placaOpt) { await sel.selectOption({ label: placaOpt }).catch((e) => console.log('  selectOption:', (e as Error).message)); console.log('>> opción elegida:', JSON.stringify(placaOpt)); await wait(1500); break; }
    }
  }
  await dumpAll(p, 'PASO 2 · form impuesto vehicular por placa');

  // ── PASO 3: placa + captcha + Buscar ──
  let filled = false;
  for (const fr of p.frames()) {
    const placaInput = fr.locator('input[id*="laca" i], input[name*="laca" i], input[placeholder*="laca" i]').first();
    if (!(await placaInput.count().catch(() => 0))) continue;
    await placaInput.fill(plate).catch((e) => console.log('  fill placa:', (e as Error).message));
    const img = fr.locator('img.captcha_class, img[src*="captcha" i], img[id*="aptcha" i]').first();
    if (await img.count().catch(() => 0)) {
      const b64 = (await img.screenshot().catch(() => Buffer.from(''))).toString('base64');
      const cap = (await solver.solveImage(b64).catch((e) => { console.log('  solveImage:', (e as Error).message); return ''; })).trim();
      console.log('>> captcha:', JSON.stringify(cap));
      await fr.locator('input[id*="aptcha" i], input[name*="aptcha" i], #ctl00_cplPrincipal_txtCaptcha').first().fill(cap).catch(() => {});
    } else console.log('!! sin img de captcha en este frame');
    await Promise.all([p.waitForLoadState('domcontentloaded').catch(() => {}), fr.locator('input[value*="Buscar" i], button:has-text("Buscar"), a:has-text("Buscar")').first().click().catch((e) => console.log('  click Buscar:', (e as Error).message))]);
    filled = true; break;
  }
  if (!filled) console.log('!! no encontré input de placa en ningún frame (revisa PASO 2)');
  await wait(4000);
  await p.waitForLoadState('networkidle').catch(() => {});
  await dumpTables(p, 'PASO 3 · lista de contribuyentes');
  await p.screenshot({ path: '/root/out/sat-impuesto-1.png', fullPage: true }).catch(() => {});

  // ── PASO 4: clic en 1er contribuyente → cuotas ──
  const clicked = await clickByText(p, /LOGISTIC|ARENAZA|E\.I\.R\.L|S\.A\.|\d{6,}/i, 'table a, a[href*="__doPostBack"], tr[onclick], a');
  console.log(`\n>> PASO 4: clic en contribuyente → ${clicked ? 'OK' : 'NO ENCONTRADO'}`);
  await wait(4000);
  await p.waitForLoadState('networkidle').catch(() => {});
  await dumpTables(p, 'PASO 4 · tabla de cuotas');
  await p.screenshot({ path: '/root/out/sat-impuesto-2.png', fullPage: true }).catch(() => {});
  console.log('\n(screenshots: /root/out/sat-impuesto-1.png, /root/out/sat-impuesto-2.png)');
} finally {
  await b.close();
  process.exit(0);
}
