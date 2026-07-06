/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { findChrome, chromeFlags } from './operator/chrome-path.js';

// Passphrase CryptoJS del bundle SIGM (chunk-6WAWKTVD.js · cryptKey). Cifra/​descifra las
// respuestas del api-gateway en formato OpenSSL "Salted__" (MD5 EvpKDF → aes-256-cbc),
// idéntico a Síguelo. Las claves del JSON son base64: cmVzcG9uc2U="response", dglwbw="tipo".
const SIGM_KEY = 'c4m4VsB3QV5PPK3ruDWK4TitjiDR4BVAvjKaA35v1SPPnXN1Up';
function sigmDecrypt(b64: string): string | null {
  try {
    const data = Buffer.from(b64, 'base64');
    if (data.subarray(0, 8).toString('latin1') !== 'Salted__') return null;
    const salt = data.subarray(8, 16);
    let dd = Buffer.alloc(0), bb = Buffer.alloc(0);
    while (dd.length < 48) { bb = crypto.createHash('md5').update(Buffer.concat([bb, Buffer.from(SIGM_KEY, 'utf8'), salt])).digest(); dd = Buffer.concat([dd, bb]); }
    const c = crypto.createDecipheriv('aes-256-cbc', dd.subarray(0, 32), dd.subarray(32, 48));
    return Buffer.concat([c.update(data.subarray(16)), c.final()]).toString('utf8');
  } catch { return null; }
}

/**
 * PROBE de descubrimiento del SIGM (Sistema Informativo de Garantías Mobiliarias, SUNARP).
 * Consulta GRATUITA "Por Bien" → Placa. Objetivo: ver si hay una API JSON detrás (como APESEG)
 * o si toca raspar la tabla del DOM, y volcar la estructura REAL para construir el parser.
 *
 * Flujo (según screenshots del usuario):
 *   1. https://sigm.sunarp.gob.pe/garantias-mobiliarias/inicio  (Turnstile pasivo: "¡Operación exitosa!")
 *   2. cerrar el modal de bienvenida (×)
 *   3. pestaña "Por Bien" → radio "Placa" → escribir placa → "Consultar"
 *   4. capturar: llamadas XHR/fetch (url+body) + innerText de la tabla de resultados + screenshot
 *
 * Uso (VPS con Xvfb):  DISPLAY=:99 npx tsx packages/scrapers/src/probe-sigm.ts CHP605
 */
const URL = 'https://sigm.sunarp.gob.pe/garantias-mobiliarias/inicio';
const PORT = Number(process.env.CDP_SIGM_PORT ?? 9226);
const PROFILE = process.env.CDP_SIGM_PROFILE ?? join(process.cwd(), '.cdp-sigm-profile');
const OUT = process.env.SIGM_OUT ?? join(process.cwd(), 'sigm-probe');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connectOrLaunch(chrome: string): Promise<Browser> {
  try { return await chromium.connectOverCDP(`http://localhost:${PORT}`); }
  catch { /* lanzar */ }
  const proc = spawn(chrome, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...chromeFlags(), URL], { detached: false, stdio: 'ignore' });
  proc.on('error', (e) => console.log(`spawn: ${e.message}`));
  for (let i = 0; i < 20; i++) { await wait(700); try { return await chromium.connectOverCDP(`http://localhost:${PORT}`); } catch { /* retry */ } }
  throw new Error('no conecté al Chrome CDP del SIGM');
}

/** Espera el Turnstile pasivo (mismo patrón que cdp-sunarp): input cf-turnstile-response con token. */
async function esperarTurnstile(page: Page): Promise<boolean> {
  for (let a = 0; a < 3; a++) {
    if (a > 0) { console.log(`  Turnstile no pasó → recarga ${a}/2`); await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}); }
    console.log(`  esperando Turnstile pasivo (intento ${a + 1}/3)…`);
    for (let i = 0; i < 20; i++) {
      await wait(1000);
      const tok = await page.locator('input[name="cf-turnstile-response"]').first().inputValue({ timeout: 1000 }).catch(() => '');
      if (tok) { console.log(`  Turnstile pasó (${tok.length})`); return true; }
    }
  }
  return false;
}

async function main(): Promise<void> {
  const placas = process.argv.slice(2).map((p) => p.toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean);
  if (!placas.length) placas.push('CHP605');
  const chrome = findChrome();
  if (!chrome) { console.error('No encontré chrome.exe'); process.exit(1); }
  console.log(`SIGM probe · placas=${placas.join(',')} · CDP :${PORT}`);

  const api: Array<{ url: string; status: number; ct: string; body: string }> = [];
  let browser: Browser | null = null;
  try {
    browser = await connectOrLaunch(chrome);
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());

    // Captura TODA respuesta XHR/fetch que parezca de datos (json o url relevante).
    page.on('response', (resp) => {
      const u = resp.url();
      const ct = (resp.headers()['content-type'] ?? '');
      const isJson = /json/i.test(ct);
      const dataPath = /consulta|buscar|afecta|folio|deudor|acreedor|busqueda/i.test(u) && !/\.(js|css|png|svg|woff2?|ttf|otf|eot|jpe?g|gif|ico|map)(\?|$)/i.test(u);
      if (!isJson && !dataPath) return;
      void resp.text().then((t) => {
        if (t && t.length > 2 && !/<!DOCTYPE html|<html/i.test(t.slice(0, 200))) {
          api.push({ url: u, status: resp.status(), ct, body: t });
        }
      }).catch(() => {});
    });

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const paso = await esperarTurnstile(page);
    if (!paso) console.log('  ⚠️ Turnstile NO pasó pasivo (en VPS quizá haya que resolverlo o usar CapSolver).');
    await wait(2000);

    // Volcar el HTML de los overlays para referencia (modal de bienvenida + tour guiado).
    const overlayHtml = await page.locator('.cdk-overlay-container').first().innerHTML().catch(() => '');
    try { writeFileSync(OUT + '-overlay.html', overlayHtml); } catch { /* */ }

    // ── Cerrar el modal de bienvenida. Primero la X; si no se va, se REMUEVE por JS (el
    //    form de consulta vive FUERA del modal → removerlo es seguro). ⚠️ Nunca clickear
    //    "Clic aquí" (.tutorial-container button) → navega a los videos tutoriales. ──
    for (let round = 0; round < 3; round++) {
      await page.locator('.ant-modal-close, button[aria-label="Close"]').first().click({ force: true, timeout: 1500 }).catch(() => {});
      await wait(500);
      if (!(await page.locator('nz-modal-container').first().isVisible().catch(() => false))) break;
    }
    if (await page.locator('nz-modal-container').first().isVisible().catch(() => false)) {
      console.log('  modal persiste tras la X → removiéndolo por JS');
      await page.evaluate(() => document.querySelectorAll('nz-modal-container, .cdk-overlay-backdrop, .ant-modal-mask, .ant-modal-wrap, .cdk-global-overlay-wrapper').forEach((e) => e.remove())).catch(() => {});
      await wait(400);
    }
    console.log(`  modal cerrado · url: ${page.url()}`);

    // Debug: pestañas disponibles.
    const tabs = await page.locator('[role="tab"]').allInnerTexts().catch(() => []);
    console.log(`  pestañas: ${JSON.stringify(tabs)}`);

    // ── Pestaña "Por Bien" + radio "Placa" (una sola vez) ──
    const tab = page.locator('[role="tab"]:has-text("Por Bien")').first();
    await tab.click({ timeout: 4000 }).catch(async () => { await tab.click({ force: true, timeout: 3000 }).catch((e) => console.log(`  tab Por Bien: ${(e as Error).message}`)); });
    await wait(1200);
    await page.locator('label:has-text("Placa")').first().click({ force: true, timeout: 3000 }).catch(() => {});
    await wait(400);

    // ── Consulta por placa: rellena numeroPlaca, Consultar (visible), lee la tabla RENDERIZADA
    //    (así no hace falta descifrar la respuesta), y cierra el modal "Aceptar" del vacío. ──
    async function consultar(pl: string): Promise<{ empty: boolean; rows: number; tabla: string }> {
      const inp = page.locator('input[formcontrolname="numeroPlaca"]').first();
      await inp.fill('', { timeout: 4000 }).catch(() => {});
      await inp.fill(pl, { timeout: 4000 }).catch((e) => console.log(`  [${pl}] fill: ${(e as Error).message}`));
      await wait(400);
      const before = api.length;
      await page.locator('button:has-text("Consultar"):visible').first().click({ timeout: 5000 }).catch(async () => {
        await page.locator('button:has-text("Consultar"):visible').first().click({ force: true }).catch((e) => console.log(`  [${pl}] Consultar: ${(e as Error).message}`));
      });
      for (let i = 0; i < 15 && api.length === before; i++) await wait(1000); // espera respuesta de /busqueda
      await wait(1500);
      const bodyTxt = await page.locator('body').innerText().catch(() => '');
      const empty = /no se han encontrado registros|no hay datos/i.test(bodyTxt);
      const rows = await page.locator('table tbody tr').count().catch(() => 0);
      const tabla = await page.locator('table').first().innerText().catch(() => '');
      await page.locator('button:has-text("Aceptar")').first().click({ timeout: 2500 }).catch(() => {}); // cierra el alert del vacío
      await wait(700);
      return { empty, rows, tabla };
    }

    let hit: string | null = null;
    console.log('\n── Probando placas ──');
    for (const pl of placas) {
      const r = await consultar(pl);
      console.log(`  [${pl}] → ${r.empty ? 'VACÍO' : `DATOS (${r.rows} fila(s))`}`);
      if (!r.empty && r.rows > 0) {
        hit = pl;
        try { writeFileSync(OUT + '.png', Buffer.from(await page.screenshot({ fullPage: true }))); } catch { /* */ }
        console.log(`\n================ TABLA CON DATOS (${pl}) ================\n${r.tabla}`);
        break;
      }
    }
    if (!hit) console.log('\n⚠️ Ninguna de las placas probadas tiene garantía vigente en SIGM hoy.');

    // ── Abrir el "Detalle" de la 1ª fila para capturar la llamada con acreedor/deudor/monto ──
    if (hit) {
      console.log('  abriendo Detalle de la fila…');
      const before = api.length;
      // La 1ª tbody tr es la measure-row oculta de ant-table (sin controles) → tomo el
      // ícono de la ÚLTIMA celda (col "Detalle") de la fila real (.last()).
      await page.locator('table tbody td:last-child button, table tbody td:last-child a, table tbody td:last-child .anticon, table tbody td:last-child [nz-icon], table tbody td:last-child svg').last()
        .click({ force: true, timeout: 4000 }).catch((e) => console.log(`  Detalle: ${(e as Error).message}`));
      for (let i = 0; i < 12 && api.length === before; i++) await wait(1000);
      await wait(2500);
      try { writeFileSync(OUT + '-detalle.png', Buffer.from(await page.screenshot({ fullPage: true }))); } catch { /* */ }
    }

    console.log('\n================ API/XHR (descifradas) ================');
    const dumps: string[] = [];
    for (const r of api) {
      let dec: string | null = null;
      if (/busqueda|combo|detalle|consulta/i.test(r.url)) { try { dec = sigmDecrypt((JSON.parse(r.body) as { cmVzcG9uc2U?: string }).cmVzcG9uc2U ?? ''); } catch { /* */ } }
      const line = `\n--- ${r.status} ${r.url}\n` + (dec ? `DESCIFRADO: ${dec}` : r.body.slice(0, 300));
      if (/busqueda|detalle/i.test(r.url)) console.log(line);
      dumps.push(line);
    }
    try { writeFileSync(OUT + '.txt', `HIT: ${hit}\n${dumps.join('\n')}`); console.log(`\nDump → ${OUT}.txt`); } catch { /* */ }
  } catch (e) {
    console.error('probe error:', (e as Error).message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    process.exit(0);
  }
}
main();
