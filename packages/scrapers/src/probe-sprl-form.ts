/* eslint-disable no-console */
// Diagnóstico EN VIVO del formulario SPRL "Visualización e impresión de partida" (post-rediseño ago-2026).
// Vuelca: red completa (con fallos), nz-selects con sus opciones REALES (leídas del dropdown ABIERTO),
// radios, botones y el resultado de una búsqueda por placa. Corre desde IP residencial con el perfil local.
// Uso: npx tsx src/probe-sprl-form.ts [PLACA]
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { findChrome, chromeFlags } from './operator/chrome-path.js';
import { sprlIsLogged, sprlLogin } from './operator/sprl-login.js';

// Carga .env de la raíz (SPRL_USER/SPRL_PASS) sin dependencias.
const envPath = 'd:/Jose/Proyecto_Consulta_placa/.env';
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!;
  }
}

const plate = (process.argv[2] ?? 'CUP664').toUpperCase().replace(/[^A-Z0-9]/g, '');
const PORT = 9224;
const PROFILE = 'd:/Jose/Proyecto_Consulta_placa/.cdp-sprl-profile';
const INGRESO = 'https://sprl.sunarp.gob.pe/sprl/ingreso';
const PARTIDA = 'https://sprl.sunarp.gob.pe/sprl/main/partidas-base-grafica-registral';
const OUT = 'd:/Jose/Proyecto_Consulta_placa/validacion-fuentes';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CHROME = findChrome();
if (!CHROME) { console.error('sin chrome'); process.exit(1); }

const net: string[] = [];

const main = async (): Promise<void> => {
  let browser: Browser | null = await chromium.connectOverCDP(`http://localhost:${PORT}`, { timeout: 4000 }).catch(() => null);
  if (!browser) {
    console.log(`lanzando Chrome CDP :${PORT}…`);
    spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...chromeFlags(), INGRESO], { detached: false, stdio: 'ignore' });
    for (let i = 0; i < 20 && !browser; i++) { await wait(700); browser = await chromium.connectOverCDP(`http://localhost:${PORT}`, { timeout: 4000 }).catch(() => null); }
  } else console.log('Chrome CDP reusado');
  if (!browser) { console.error('no conecté'); process.exit(1); }
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.setDefaultTimeout(15000);

  // Red COMPLETA: respuestas (status+url) y requests FALLIDAS (el catálogo de áreas puede estar muriendo).
  page.on('response', (r) => { const u = r.url(); if (/sunarp|paas|ocp/i.test(u) && !/\.(js|css|png|woff|svg|ico)/i.test(u)) net.push(`RESP ${r.status()} ${u.slice(0, 140)}`); });
  page.on('requestfailed', (r) => { const u = r.url(); if (/sunarp|paas|ocp/i.test(u)) net.push(`FAIL ${r.failure()?.errorText ?? '?'} ${u.slice(0, 140)}`); });

  // Login (reusa sesión del perfil; si no, login automático con creds del .env).
  let logged = await sprlIsLogged(page);
  for (let i = 0; i < 20 && !logged; i++) { await wait(1000); logged = await sprlIsLogged(page); }
  if (!logged) {
    console.log('sin sesión → login automático…');
    const r = await sprlLogin(page, ctx, { user: process.env.SPRL_USER ?? '', pass: process.env.SPRL_PASS ?? '', log: (m) => console.log('  login:', m), shotPath: `${OUT}/sprl-form-login.png` });
    if (!r.ok) { console.error('LOGIN FALLÓ', r.locked ? '(LOCKOUT)' : ''); process.exit(1); }
  }
  console.log('sesión OK → navegando a la página de partida…');
  net.length = 0; // solo la red de la página de partida
  await page.goto(PARTIDA, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.locator('nz-select').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await wait(4000); // deja cargar catálogos

  // ── Inventario del formulario ──
  const selects = page.locator('nz-select');
  const nSel = await selects.count().catch(() => 0);
  console.log(`\n=== nz-selects: ${nSel} ===`);
  for (let i = 0; i < nSel; i++) {
    const sel = selects.nth(i);
    const visible = await sel.isVisible().catch(() => false);
    const text = (await sel.innerText({ timeout: 1500 }).catch(() => '?')).replace(/\s+/g, ' ').trim();
    console.log(`sel${i}: visible=${visible} texto="${text.slice(0, 60)}"`);
    if (!visible) continue;
    await sel.locator('.ant-select-selector').first().click({ timeout: 3000 }).catch(() => {});
    await wait(700);
    // SOLO el dropdown ABIERTO (no el contenedor global: los cerrados quedan en el DOM)
    const openDrop = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
    const opts = (await openDrop.locator('.ant-select-item-option-content').allInnerTexts().catch(() => []))
      .map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    console.log(`   opciones(${opts.length}): [${opts.slice(0, 12).join(' | ')}]`);
    await page.keyboard.press('Escape').catch(() => {});
    await wait(300);
  }

  const radios = await page.locator('label.ant-radio-wrapper, label[nz-radio]').allInnerTexts().catch(() => []);
  console.log(`\nradios: [${radios.map((r) => r.trim()).join(' | ')}]`);
  const buttons = await page.locator('button:visible').allInnerTexts().catch(() => []);
  console.log(`botones visibles: [${buttons.map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ')}]`);
  const numero = page.locator('#numero');
  console.log(`#numero: count=${await numero.count().catch(() => 0)} visible=${await numero.first().isVisible().catch(() => false)}`);
  const bodyTop = (await page.locator('body').innerText({ timeout: 4000 }).catch(() => '')).replace(/\s+/g, ' ').slice(0, 500);
  console.log(`\nbody: "${bodyTop}"`);
  await page.screenshot({ path: `${OUT}/sprl-form-estado.png`, fullPage: true }).catch(() => {});

  console.log(`\n=== red de la página (${net.length}) ===`);
  for (const l of net) console.log(' ', l);

  // ── Búsqueda de prueba por placa ──
  console.log(`\n=== búsqueda de prueba: ${plate} ===`);
  // radio/valor "Placa" si existe como radio custom
  const placaRadio = page.locator('label.ant-radio-wrapper, label[nz-radio]').filter({ hasText: /placa/i }).first();
  if (await placaRadio.isVisible().catch(() => false)) { await placaRadio.click().catch(() => {}); console.log('radio Placa clicado'); await wait(500); }
  const num = page.locator('#numero:visible').first();
  await num.click().catch(() => {});
  await num.fill('').catch(() => {});
  await num.type(plate, { delay: 50 }).catch(() => {});
  console.log(`#numero valor="${await num.inputValue().catch(() => '?')}"`);
  let ts = '';
  for (let i = 0; i < 60 && !ts; i++) { ts = await page.locator('input[name="cf-turnstile-response"]').first().inputValue({ timeout: 400 }).catch(() => ''); if (!ts) await wait(500); }
  console.log(`turnstile=${ts.length}`);
  const respP = page.waitForResponse((r) => /mostrar-resultado/i.test(r.url()), { timeout: 30000 }).catch(() => null);
  // clic al botón de búsqueda REAL: primero uno cercano al input (mismo form), si no el 1º "Buscar" visible
  const btns = page.locator('button:visible');
  const nB = await btns.count().catch(() => 0);
  const btnTexts: string[] = [];
  for (let i = 0; i < nB; i++) btnTexts.push((await btns.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim());
  console.log('candidatos a Buscar:', JSON.stringify(btnTexts));
  let clicked = -1;
  for (let i = 0; i < nB; i++) { if (/buscar/i.test(btnTexts[i] ?? '') && !/servicio/i.test(btnTexts[i] ?? '')) { await btns.nth(i).click().catch(() => {}); clicked = i; break; } }
  console.log(`clic en botón #${clicked} ("${btnTexts[clicked] ?? ''}")`);
  const resp = await respP;
  console.log(`respuesta búsqueda: ${resp ? `${resp.status()} ${resp.url().slice(0, 120)}` : 'NULL (no disparó)'}`);
  await wait(3000);
  const rows = await page.locator('.ant-table-tbody tr').count().catch(() => 0);
  const body2 = (await page.locator('body').innerText({ timeout: 4000 }).catch(() => '')).replace(/\s+/g, ' ');
  const tits = [...new Set((body2.match(/\b20\d{2}\s*-\s*\d{6,8}\b/g) ?? []).map((s) => s.replace(/\s+/g, '')))];
  console.log(`filas tabla=${rows} · títulos en DOM=${JSON.stringify(tits)}`);
  await page.screenshot({ path: `${OUT}/sprl-form-resultado.png`, fullPage: true }).catch(() => {});
  console.log(`\n=== red total (${net.length}) ===`);
  for (const l of net.slice(-25)) console.log(' ', l);
  writeFileSync(`${OUT}/sprl-form-diag.json`, JSON.stringify({ plate, nSel, radios, buttons: btnTexts, net }, null, 2), 'utf8');
  console.log(`\nguardado: ${OUT}/sprl-form-{estado,resultado}.png + sprl-form-diag.json`);
  console.log('(Chrome queda abierto)');
  process.exit(0);
};
main().catch((e) => { console.error('PROBE ERROR:', e); process.exit(1); });
