/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

/**
 * Síguelo Plus por HÍBRIDO CDP (Chrome limpio + connectOverCDP). El Turnstile
 * pasa PASIVO y Playwright conduce el form (oficina/año/título) + BUSCAR.
 * Descubre el paso "Detalle de seguimiento → Asiento de inscripción → ojo" e
 * intercepta la API `siguelo/asientoinscripcion` (con el PRECIO de la transacción).
 *
 * Uso: npx tsx packages/scrapers/src/probe-cdp-siguelo.ts LIMA 2020 02305829
 */
const argv = process.argv.slice(2);
const manual = argv.includes('--manual');
const pos = argv.filter((a) => !a.startsWith('--'));
const oficina = (pos[0] ?? 'LIMA').toUpperCase();
const anio = pos[1] ?? '2020';
const titulo = pos[2] ?? '02305829';
const PORT = 9223;
const PROFILE = 'd:/Jose/Proyecto_Consulta_placa/.cdp-siguelo-profile';
const URL = 'https://sigueloplus.sunarp.gob.pe/siguelo/';
const OUT = 'd:/Jose/Proyecto_Consulta_placa/validacion-fuentes';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
].find((p) => existsSync(p));
if (!CHROME) { console.error('No encontré chrome.exe.'); process.exit(1); }

const api: Array<{ url: string; body: string }> = [];

async function dumpButtons(page: Page, label: string) {
  const btns = await page.$$eval('button, a', (els) =>
    els.map((e) => (e.textContent || '').trim()).filter((t) => t && t.length < 40).slice(0, 30),
  ).catch(() => []);
  console.log(`   [${label}] botones/links:`, JSON.stringify([...new Set(btns)]));
}

console.log(`Lanzando Chrome limpio (CDP :${PORT})…`);
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
    if (!/siguelo|api-gateway\.sunarp|asiento|inscripcion/i.test(u)) return;
    if (/\.(js|css|png|jpg|jpeg|svg|woff2?|ico)(\?|$)/i.test(u)) return;
    resp.text().then((b) => {
      if (!b || b.length < 5) return;
      api.push({ url: u, body: b.slice(0, 4000) });
      console.log('📥 API:', u.slice(-55));
    }).catch(() => {});
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await wait(2000);
  await page.locator('button:has-text("Acepto")').first().click({ timeout: 3000 }).catch(() => {});

  // Modo --manual: NO llenar ni esperar nada; el operador hace TODO a mano y solo
  // capturamos la red (prueba decisiva de si CDP rompe el flujo de Síguelo).
  if (!manual) {
    // Llenar el formulario disparando eventos de Angular (change/input/blur).
    console.log(`Llenando: Título · ${oficina} · ${anio} · ${titulo}`);
    const fireEvents = (el: Element) => {
      for (const t of ['input', 'change', 'blur']) el.dispatchEvent(new Event(t, { bubbles: true }));
    };
    await page.locator('input[name="optradio"]').first().check().catch(() => {});
    await page.locator('input[name="optradio"]').first().evaluate(fireEvents).catch(() => {});
    await wait(400);
    await page.selectOption('#cboOficina', { label: oficina }).catch((e) => console.warn('oficina:', (e as Error).message));
    await page.locator('#cboOficina').evaluate(fireEvents).catch(() => {});
    await page.selectOption('#cboAnio', { label: anio }).catch((e) => console.warn('año:', (e as Error).message));
    await page.locator('#cboAnio').evaluate(fireEvents).catch(() => {});
    const ti = page.locator('input[name="numeroTitulo"]');
    await ti.click().catch(() => {});
    await ti.fill(titulo).catch(() => {});
    await ti.evaluate(fireEvents).catch(() => {});
    await wait(500);

    console.log('Esperando Turnstile PASIVO (Chrome limpio)…');
    let token = '';
    for (let i = 0; i < 45 && !token; i++) { await wait(1000); token = await page.locator('input[name="cf-turnstile-response"]').first().inputValue().catch(() => ''); }
    console.log(token ? `✓ Turnstile pasó PASIVO (${token.length})` : '⚠️ Turnstile NO pasó pasivo');
    writeFileSync(`${OUT}/siguelo-form.html`, await page.content(), 'utf8');
  } else {
    console.log('Modo --manual: no toco nada. Haz TODO en la ventana (llenar + Turnstile + BUSCAR + navegar).');
  }

  // MODO OPERADOR-ASISTIDO: NO auto-clic ni navegación (interferían). Los campos ya
  // están llenos; el operador pasa el Turnstile + BUSCAR + navega, y capturamos la red.
  await page.screenshot({ path: `${OUT}/siguelo-cdp-1.png`, fullPage: true }).catch(() => {});
  const buscar = page.locator('button:has-text("BUSCAR")').first();
  const enabled = await buscar.isEnabled().catch(() => false);
  console.log('\n' + '='.repeat(64));
  console.log('  AHORA TÚ, en la ventana de Chrome de Síguelo:');
  console.log('   1) Si ves el checkbox de Cloudflare "Verifique que es un ser');
  console.log('      humano" → HAZ CLIC en él (eso habilita BUSCAR).');
  console.log(`   2) Verifica los campos (LIMA · 2020 · ${titulo}) y clic BUSCAR.`);
  console.log('   3) En el resultado: "Detalle de seguimiento" → "Asiento de');
  console.log('      inscripción" → clic en el ÍCONO DEL OJO del asiento.');
  console.log(`  (BUSCAR ahora mismo: ${enabled ? 'HABILITADO' : 'disabled → clic el checkbox'})`);
  console.log('  Capturo la red en vivo; corto apenas llegue el precio. Tienes 180s.');
  console.log('='.repeat(64) + '\n');

  // Capturar hasta tener el precio (endpoint asientoinscripcion o body con monto).
  const gotPrice = () => api.some((r) => /asientoinscripcion/i.test(r.url) || /precio|monto|importe|US\$|S\/\s*\d/i.test(r.body));
  for (let i = 0; i < 180 && !gotPrice(); i++) await wait(1000);
  await page.screenshot({ path: `${OUT}/siguelo-cdp-3-final.png`, fullPage: true }).catch(() => {});
  await dumpButtons(page, 'estado final');
  writeFileSync(`${OUT}/siguelo-cdp-api.json`, JSON.stringify(api, null, 2), 'utf8');
  console.log(`\n=== ${api.length} respuestas API capturadas ${gotPrice() ? '(✓ precio detectado)' : '(sin precio)'} ===`);
  for (const r of api) {
    console.log('→', r.url);
    console.log('   body[0..300]:', r.body.slice(0, 300).replace(/\s+/g, ' '));
  }
  await browser.close().catch(() => {});
} catch (e) {
  console.error('ERROR:', (e as Error).message);
} finally {
  console.log('\n(Chrome queda abierto; ciérralo cuando quieras.)');
  process.exit(0);
}
