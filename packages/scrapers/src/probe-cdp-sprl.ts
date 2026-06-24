/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { chromium, type Page, type Locator } from 'playwright';

const SPRL_KEY = 'sUIZJFw36fA7GzpS'; // environment.cryptKey (AES-128); IV = primeros 16 bytes
function sprlDecrypt(b64: string): unknown | null {
  try {
    const blob = Buffer.from(b64.trim(), 'base64');
    if (blob.length < 32 || blob.length % 16 !== 0) return null;
    const d = crypto.createDecipheriv('aes-128-cbc', Buffer.from(SPRL_KEY, 'utf8'), blob.subarray(0, 16));
    const out = Buffer.concat([d.update(blob.subarray(16)), d.final()]).toString('utf8');
    try { return JSON.parse(out); } catch { return out; }
  } catch {
    return null;
  }
}

/**
 * SPRL (Servicio de Publicidad Registral en Línea) por HÍBRIDO CDP.
 *
 * El SPRL migró a una API REST (`*.paas.sunarp.gob.pe/v1/sunarp-services/...`)
 * que devuelve JSON EN CLARO (ya no el SOAP cifrado). La búsqueda por PLACA usa
 * Cloudflare Turnstile (NO captcha de imagen) → pasa pasivo en Chrome limpio.
 *
 * Flujo (manual del operador, automatizado):
 *   1. Chrome limpio (Turnstile pasivo) en perfil SPRL persistente.
 *   2. Login manual la 1ª vez (la sesión queda en el perfil).
 *   3. Área "Propiedad Vehicular" (nz-select) → aparece "Buscar por: Placa".
 *      Oficina Registral (nz-select BUSCABLE: se escribe la sede) + N° de placa.
 *   4. Buscar → "Ver Asientos" (GRATIS) → asientos + N° de TÍTULO (para Síguelo)
 *      + cadena de dueños. Intercepta las respuestas REST (JSON claro).
 *
 * Uso: npx tsx packages/scrapers/src/probe-cdp-sprl.ts BTF268 LIMA
 */
const plate = (process.argv[2] ?? 'BTF268').toUpperCase().replace(/[^A-Z0-9]/g, '');
const oficina = (process.argv[3] ?? 'LIMA').toUpperCase();
const PORT = 9224;
const PROFILE = 'd:/Jose/Proyecto_Consulta_placa/.cdp-sprl-profile';
const INGRESO = 'https://sprl.sunarp.gob.pe/sprl/ingreso';
const PARTIDA = 'https://sprl.sunarp.gob.pe/sprl/main/partidas-base-grafica-registral';
const OUT = 'd:/Jose/Proyecto_Consulta_placa/validacion-fuentes';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
].find((p) => existsSync(p));
if (!CHROME) { console.error('No encontré chrome.exe.'); process.exit(1); }

const api: Array<{ url: string; json: unknown }> = [];

/** Click en una nz-select (Ant Design) y elige opción por texto (lista corta). */
async function pickNzSelect(sel: Locator, page: Page, optionText: RegExp, label: string): Promise<boolean> {
  try {
    await sel.locator('.ant-select-selector').first().click({ timeout: 5000 });
    await wait(500);
    const opt = page.locator('.ant-select-item-option-content', { hasText: optionText }).first();
    await opt.waitFor({ state: 'visible', timeout: 5000 });
    await opt.click();
    await wait(800);
    console.log(`   ✓ ${label}`);
    return true;
  } catch (e) {
    console.warn(`   ✗ ${label}: ${(e as Error).message}`);
    return false;
  }
}

/** nz-select BUSCABLE (lista larga virtualizada): abre, escribe el filtro, elige exacto. */
async function pickSearchable(sel: Locator, page: Page, value: string, label: string): Promise<boolean> {
  try {
    await sel.locator('.ant-select-selector').first().click({ timeout: 5000 });
    await wait(400);
    const search = page.locator('.ant-select-selection-search-input:visible').first();
    await search.fill(value);
    await wait(900);
    const opt = page.locator('.ant-select-item-option-content', { hasText: new RegExp(`^\\s*${value}\\s*$`, 'i') }).first();
    await opt.waitFor({ state: 'visible', timeout: 5000 });
    await opt.click();
    await wait(800);
    console.log(`   ✓ ${label}`);
    return true;
  } catch (e) {
    console.warn(`   ✗ ${label}: ${(e as Error).message}`);
    return false;
  }
}

console.log(`Lanzando Chrome (CDP :${PORT}) → SPRL · placa ${plate} · oficina ${oficina}`);
const proc = spawn(
  CHROME,
  [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', INGRESO],
  { detached: false, stdio: 'ignore' },
);
proc.on('error', (e) => console.error('spawn:', e.message));
await wait(5000);

try {
  const browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
  console.log('Conectado por CDP ✓');
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  page.on('response', (resp) => {
    const u = resp.url();
    if (!/sunarp-services/i.test(u)) return;
    if (/captcha\/image/i.test(u)) return;
    resp.json().then((j) => {
      let entry: { url: string; json: unknown } = { url: u, json: j };
      const data = (j as { data?: unknown } | null)?.data;
      if (typeof data === 'string' && data.length > 40) {
        const dec = sprlDecrypt(data);
        if (dec) entry = { url: u, json: { ...(j as object), data: dec } };
      }
      api.push(entry);
      console.log('📥', u.slice(-55));
    }).catch(() => {});
  });

  // ── Paso 1: sesión (rápido), si no, esperar login manual ──
  const isLogged = async () => /SALDO|BUSCAR SERVICIOS|CERRAR SESI|HOLA/.test((await page.locator('body').innerText().catch(() => '')).toUpperCase());
  let logged = false;
  for (let i = 0; i < 8 && !logged; i++) { await wait(1000); logged = await isLogged(); }
  if (!logged) {
    console.log('⏳ Inicia sesión en la ventana (cuenta SPRL). Espero hasta 3 min…');
    for (let i = 0; i < 180 && !logged; i++) { await wait(1000); logged = await isLogged(); }
  }
  console.log(logged ? '✓ Sesión activa' : '⚠️ Sin sesión confirmada; intento igual');

  // ── Paso 2: Visualización e impresión de partida ──
  await page.goto(PARTIDA, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await wait(3000);

  // ── Paso 3: Área "Propiedad Vehicular" (hace aparecer Placa) + Oficina (buscable) ──
  console.log(`   nz-select en página: ${await page.locator('nz-select').count().catch(() => 0)}`);
  const areaSel = page.locator('nz-select').filter({ hasText: /propiedad/i }).first();
  await pickNzSelect(areaSel, page, /propiedad vehicular/i, 'Área = Propiedad Vehicular');
  await wait(1000);
  const ofiSel = page.locator('nz-select').filter({ hasText: /seleccione/i }).first();
  await pickSearchable(ofiSel, page, oficina, `Oficina = ${oficina}`);
  await wait(1000);
  await page.screenshot({ path: `${OUT}/sprl-cdp-1-form.png`, fullPage: true }).catch(() => {});

  // ── Paso 4: Buscar por Placa + número ──
  await page.locator('label.ant-radio-wrapper', { hasText: /^placa$/i }).first().check().catch(() => {});
  await page.locator('#numero').fill(plate).catch((e) => console.warn('placa:', (e as Error).message));
  await wait(400);

  // ── Paso 5: Turnstile pasivo (Chrome limpio) ──
  console.log('   esperando Turnstile pasivo…');
  let token = '';
  for (let i = 0; i < 45 && !token; i++) {
    await wait(1000);
    token = await page.locator('input[name="cf-turnstile-response"]').first().inputValue().catch(() => '');
  }
  console.log(token ? `   ✓ Turnstile (${token.length})` : '   ⚠️ Turnstile no pasó pasivo — marca el checkbox en la ventana');
  await page.screenshot({ path: `${OUT}/sprl-cdp-2-prebuscar.png`, fullPage: true }).catch(() => {});

  // ── Paso 6: Buscar (el botón visible y habilitado) ──
  const buscarBtns = page.locator('button:has-text("Buscar")');
  const nB = await buscarBtns.count().catch(() => 0);
  let clicked = false;
  for (let i = 0; i < nB; i++) {
    const b = buscarBtns.nth(i);
    if ((await b.isVisible().catch(() => false)) && (await b.isEnabled().catch(() => false))) {
      console.log(`→ clic Buscar (#${i})`);
      await b.click().catch((e) => console.warn('Buscar:', (e as Error).message));
      clicked = true;
      break;
    }
  }
  if (!clicked) console.log('⚠️ Buscar sigue disabled — completa Turnstile/campos a mano si hace falta.');
  await wait(6000);
  await page.screenshot({ path: `${OUT}/sprl-cdp-3-resultado.png`, fullPage: true }).catch(() => {});

  // ── Paso 7: Ver Asientos (botón de ícono en la fila de resultado) ──
  // Orden de columnas: Ver Detalle (lupa) · Ver Asientos · Boleta Informativa ($).
  // Enumera los botones de la fila, NO toca la Boleta (cuesta S/6.60).
  const rowBtns = page.locator('.ant-table-tbody tr button, table tbody tr button');
  const nRow = await rowBtns.count().catch(() => 0);
  console.log(`   botones en la fila: ${nRow}`);
  let asientoIdx = -1;
  for (let i = 0; i < nRow; i++) {
    const html = await rowBtns.nth(i).evaluate((el) => el.outerHTML).catch(() => '');
    const icon = (html.match(/nztype="([^"]+)"/)?.[1] ?? '').toLowerCase();
    const isBoleta = /boleta|file|pdf|printer|profile/i.test(html);
    console.log(`   btn#${i} icon="${icon}"${isBoleta ? ' (BOLETA-$, evitar)' : ''}`);
    // El de asientos suele ser el 2º (índice 1); nunca el de boleta.
    if (asientoIdx === -1 && !isBoleta && i >= 1) asientoIdx = i;
  }
  if (asientoIdx === -1 && nRow >= 2) asientoIdx = 1;
  if (asientoIdx >= 0) {
    console.log(`→ clic Ver Asientos (btn#${asientoIdx})`);
    await rowBtns.nth(asientoIdx).click().catch((e) => console.warn('Ver Asientos:', (e as Error).message));
    await wait(4000);
  } else {
    console.log('⚠️ No identifiqué "Ver Asientos" — clic manual (captura activa).');
  }
  await page.screenshot({ path: `${OUT}/sprl-cdp-4-asientos.png`, fullPage: true }).catch(() => {});

  console.log('\n⏳ 75s para completar a mano si hace falta (Ver Asientos / abrir detalle de cada título)…');
  for (let i = 0; i < 75; i++) await wait(1000);
  await page.screenshot({ path: `${OUT}/sprl-cdp-5-final.png`, fullPage: true }).catch(() => {});

  // ── Extraer títulos "2020 - 02305829" (con o sin espacios) de DOM + red ──
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const fullText = bodyText + ' ' + JSON.stringify(api);
  const titulos = [...new Set((fullText.match(/\b20\d{2}\s*-\s*\d{6,8}\b/g) ?? []).map((s) => s.replace(/\s+/g, '')))];

  writeFileSync(`${OUT}/sprl-cdp.json`, JSON.stringify({ plate, oficina, titulos, turnstile: !!token, api }, null, 2), 'utf8');
  console.log(`\n=== ${api.length} respuestas REST · títulos: ${JSON.stringify(titulos)} ===`);
  for (const r of api) {
    console.log('→', r.url.slice(-60));
    console.log('   ', JSON.stringify(r.json).slice(0, 280));
  }
  console.log(`\n✓ Guardado en ${OUT}/sprl-cdp.json (+ sprl-cdp-*.png)`);
  await browser.close().catch(() => {});
} catch (e) {
  console.error('ERROR:', (e as Error).message);
} finally {
  console.log('\n(Chrome queda abierto; ciérralo cuando quieras.)');
  process.exit(0);
}
