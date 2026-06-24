/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

/**
 * DISCOVERY: API de subastas de vehículos SINIESTRADOS de Superbid (RIMAC/etc.).
 *
 * Superbid.com.pe es un SPA (datos vía API `*.superbid.net`). Este probe abre un
 * Chrome limpio por CDP (IP residencial), busca "siniestro", e intercepta TODAS las
 * respuestas JSON de la API para descubrir: (1) el endpoint de listado de lotes,
 * (2) la estructura de un lote, (3) dónde está el ANEXO "boleta SUNARP" (PDF con la
 * placa + VIN). Con eso se construye la fuente real `operator/superbid.ts`.
 *
 * Uso: npx tsx packages/scrapers/src/probe-cdp-superbid.ts [termino]
 */
const termino = process.argv[2] ?? 'siniestro';
const PORT = 9225;
const PROFILE = 'd:/Jose/Proyecto_Consulta_placa/.cdp-superbid-profile';
const URL = 'https://www.superbid.com.pe/';
const OUT = 'd:/Jose/Proyecto_Consulta_placa/validacion-fuentes';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
].find((p) => existsSync(p));
if (!CHROME) { console.error('No encontré chrome.exe.'); process.exit(1); }

const api: Array<{ url: string; body: string }> = [];

async function dumpOfertas(page: Page, label: string) {
  const links = await page.$$eval('a[href*="/oferta/"]', (els) =>
    [...new Set(els.map((e) => (e as HTMLAnchorElement).href))].slice(0, 25),
  ).catch(() => []);
  console.log(`   [${label}] ofertas (${links.length}):`);
  for (const l of links.slice(0, 12)) console.log('     ', l.replace('https://www.superbid.com.pe', ''));
  return links;
}

console.log(`Lanzando Chrome (CDP :${PORT}) → Superbid · buscar "${termino}"`);
const proc = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', URL], { detached: false, stdio: 'ignore' });
proc.on('error', (e) => console.error('spawn:', e.message));
await wait(5000);

try {
  const browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
  console.log('Conectado por CDP ✓');
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  page.on('response', (resp) => {
    const u = resp.url();
    if (!/superbid\.net|api[.-]|event-query|search|offer|lote?s?|product/i.test(u)) return;
    if (/\.(js|css|png|jpe?g|svg|woff2?|ttf|otf|gif|ico)(\?|$)/i.test(u)) return;
    resp.text().then((b) => {
      if (!b || b.length < 5 || b[0] === '<') return; // saltar HTML
      api.push({ url: u, body: b.slice(0, 8000) });
      console.log('📥', u.slice(0, 90));
    }).catch(() => {});
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await wait(4000);

  // Buscar "siniestro".
  const box = page.locator('input[placeholder*="Buscar" i], input[type="search"], #search, input[name*="search" i]').first();
  if (await box.isVisible().catch(() => false)) {
    console.log(`→ buscando "${termino}"…`);
    await box.click().catch(() => {});
    await box.fill(termino).catch(() => {});
    await box.press('Enter').catch(() => {});
    await wait(6000);
  } else {
    console.log('⚠️ no hallé el buscador; quedo en la home');
  }
  await page.screenshot({ path: `${OUT}/superbid-1-busqueda.png`, fullPage: true }).catch(() => {});
  const ofertas = await dumpOfertas(page, 'búsqueda');

  // Abrir la primera oferta para descubrir el detalle + el anexo (boleta).
  if (ofertas.length) {
    console.log(`\n→ abriendo lote: ${ofertas[0]!.slice(-60)}`);
    await page.goto(ofertas[0]!, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await wait(6000);
    // Clic en el tab/botón "Anexos" para cargar los adjuntos (boleta PDF).
    const anexTab = page.locator('button:has-text("Anexos"), [role="tab"]:has-text("Anexos"), a:has-text("Anexos")').first();
    if (await anexTab.isVisible().catch(() => false)) { console.log('→ clic "Anexos"'); await anexTab.click().catch(() => {}); await wait(4000); }
    await page.screenshot({ path: `${OUT}/superbid-2-lote.png`, fullPage: true }).catch(() => {});
    // Capturar TODOS los <a>/<button> que parezcan PDF/anexo con su href.
    const pdfLinks = await page.$$eval('a, button', (els) =>
      els.map((e) => ({ t: (e.textContent || '').trim().slice(0, 50), h: (e as HTMLAnchorElement).href || (e.getAttribute('data-href') || e.getAttribute('href') || '') }))
        .filter((x) => /\.pdf|[A-Z]{3}\d{3}|bolet|anexo|sunarp/i.test(x.t + ' ' + x.h)),
    ).catch(() => []);
    console.log(`   links tipo PDF/placa (${pdfLinks.length}):`);
    for (const a of pdfLinks.slice(0, 20)) console.log('     ', JSON.stringify(a.t), '→', (a.h || '(sin href)').slice(0, 100));
    // Buscar enlaces a anexos / PDF / boleta.
    const anexos = await page.$$eval('a', (els) =>
      els.map((e) => ({ t: (e.textContent || '').trim().slice(0, 40), h: (e as HTMLAnchorElement).href }))
        .filter((x) => /anexo|adjunt|bolet|\.pdf|documento|descarg/i.test(x.t + ' ' + x.h)),
    ).catch(() => []);
    console.log(`   anexos/PDF detectados (${anexos.length}):`);
    for (const a of anexos.slice(0, 15)) console.log('     ', a.t, '→', a.h.slice(0, 90));
    // Botones que podrían abrir anexos.
    const btns = await page.$$eval('button, [role="tab"]', (els) =>
      [...new Set(els.map((e) => (e.textContent || '').trim()).filter((t) => /anexo|adjunt|bolet|documento|detalle/i.test(t)))].slice(0, 15),
    ).catch(() => []);
    if (btns.length) console.log('   botones anexo:', JSON.stringify(btns));
  }

  writeFileSync(`${OUT}/superbid-api.json`, JSON.stringify({ termino, ofertas, api }, null, 2), 'utf8');
  console.log(`\n=== ${api.length} respuestas API capturadas ===`);
  for (const r of api) { console.log('→', r.url.slice(0, 95)); console.log('   ', r.body.slice(0, 160).replace(/\s+/g, ' ')); }
  console.log(`\n✓ Guardado en ${OUT}/superbid-api.json (+ superbid-1/2 .png)`);
  await browser.close().catch(() => {});
} catch (e) {
  console.error('ERROR:', (e as Error).message);
} finally {
  console.log('\n(Chrome queda abierto; ciérralo cuando quieras.)');
  process.exit(0);
}
