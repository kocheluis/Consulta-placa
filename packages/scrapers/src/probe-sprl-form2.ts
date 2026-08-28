/* eslint-disable no-console */
// Valida EN VIVO el flujo de búsqueda vehicular del SPRL rediseñado (ago-2026):
// área→"Propiedad Vehicular" (dropdown ABIERTO, scoped) → [sin oficina primero] → placa → Buscar.
// Reporta si la búsqueda dispara sin oficina o exige oficina (nuevo asterisco*).
// Uso: npx tsx src/probe-sprl-form2.ts [PLACA] [OFICINA]
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { findChrome, chromeFlags } from './operator/chrome-path.js';
import { sprlIsLogged, sprlLogin } from './operator/sprl-login.js';

const envPath = 'd:/Jose/Proyecto_Consulta_placa/.env';
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!;
  }
}

const plate = (process.argv[2] ?? 'CUP664').toUpperCase().replace(/[^A-Z0-9]/g, '');
const oficina = (process.argv[3] ?? 'LIMA').toUpperCase();
const PORT = 9224;
const PROFILE = 'd:/Jose/Proyecto_Consulta_placa/.cdp-sprl-profile';
const INGRESO = 'https://sprl.sunarp.gob.pe/sprl/ingreso';
const PARTIDA = 'https://sprl.sunarp.gob.pe/sprl/main/partidas-base-grafica-registral';
const OUT = 'd:/Jose/Proyecto_Consulta_placa/validacion-fuentes';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CHROME = findChrome();

/** Opciones del dropdown ABIERTO (los cerrados persisten ocultos en el DOM → jamás leer global). */
const openDropdown = (page: Page) => page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');

async function pickFromSelect(page: Page, selIdx: number, optionRx: RegExp): Promise<string> {
  const sel = page.locator('nz-select').nth(selIdx);
  await sel.locator('.ant-select-selector').first().click({ timeout: 4000 }).catch(() => {});
  await wait(700);
  const opt = openDropdown(page).locator('.ant-select-item-option-content', { hasText: optionRx }).first();
  const found = await opt.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
  if (!found) { await page.keyboard.press('Escape').catch(() => {}); return 'NO_ENCONTRADA'; }
  await opt.click().catch(() => {});
  await wait(800);
  return (await sel.innerText({ timeout: 1500 }).catch(() => '?')).replace(/\s+/g, ' ').trim();
}

const main = async (): Promise<void> => {
  let browser: Browser | null = await chromium.connectOverCDP(`http://localhost:${PORT}`, { timeout: 4000 }).catch(() => null);
  if (!browser) {
    if (!CHROME) { console.error('sin chrome'); process.exit(1); }
    spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...chromeFlags(), INGRESO], { detached: false, stdio: 'ignore' });
    for (let i = 0; i < 20 && !browser; i++) { await wait(700); browser = await chromium.connectOverCDP(`http://localhost:${PORT}`, { timeout: 4000 }).catch(() => null); }
  } else console.log('Chrome CDP reusado');
  if (!browser) { console.error('no conecté'); process.exit(1); }
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.setDefaultTimeout(15000);

  let logged = await sprlIsLogged(page);
  for (let i = 0; i < 15 && !logged; i++) { await wait(1000); logged = await sprlIsLogged(page); }
  if (!logged) {
    const r = await sprlLogin(page, ctx, { user: process.env.SPRL_USER ?? '', pass: process.env.SPRL_PASS ?? '', log: (m) => console.log('  login:', m), shotPath: `${OUT}/sprl-form2-login.png` });
    if (!r.ok) { console.error('LOGIN FALLÓ'); process.exit(1); }
  }
  console.log('sesión OK');
  await page.goto(PARTIDA, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.locator('nz-select').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await wait(3500);

  // ── ÁREA → Propiedad Vehicular (sel1 = 2º select; verificado por probe-sprl-form) ──
  const areaResult = await pickFromSelect(page, 1, /propiedad\s+vehicular/i);
  console.log(`área seleccionada: "${areaResult}"`);
  await wait(1200); // el sub-form cambia al cambiar el área

  // inventario tras el cambio de área
  const radios = (await page.locator('label.ant-radio-wrapper, label[nz-radio]').allInnerTexts().catch(() => [])).map((r) => r.trim()).filter(Boolean);
  console.log(`radios ahora: [${radios.join(' | ')}]`);
  const nSel = await page.locator('nz-select').count().catch(() => 0);
  for (let i = 0; i < nSel; i++) {
    const t = (await page.locator('nz-select').nth(i).innerText({ timeout: 1000 }).catch(() => '?')).replace(/\s+/g, ' ').trim();
    console.log(`sel${i}: "${t.slice(0, 50)}"`);
  }

  // radio "Placa" si existe
  const placaRadio = page.locator('label.ant-radio-wrapper, label[nz-radio]').filter({ hasText: /placa/i }).first();
  if (await placaRadio.isVisible().catch(() => false)) { await placaRadio.click().catch(() => {}); console.log('radio Placa clicado'); await wait(600); }

  // placa
  const num = page.locator('#numero:visible').first();
  await num.click().catch(() => {});
  await num.fill('').catch(() => {});
  await num.type(plate, { delay: 50 }).catch(() => {});
  console.log(`#numero="${await num.inputValue().catch(() => '?')}"`);

  let ts = '';
  for (let i = 0; i < 60 && !ts; i++) { ts = await page.locator('input[name="cf-turnstile-response"]').first().inputValue({ timeout: 400 }).catch(() => ''); if (!ts) await wait(500); }
  console.log(`turnstile=${ts.length}`);

  // ── Intento 1: SIN oficina (¿sigue siendo opcional?) ──
  const tryBuscar = async (tag: string): Promise<boolean> => {
    const respP = page.waitForResponse((r) => /mostrar-resultado/i.test(r.url()), { timeout: 25000 }).catch(() => null);
    const btns = page.locator('button:visible').filter({ hasText: /buscar/i });
    const nB = await btns.count().catch(() => 0);
    let clicked = false;
    for (let i = 0; i < nB; i++) { const b = btns.nth(i); if (await b.isEnabled().catch(() => false)) { await b.click().catch(() => {}); clicked = true; break; } }
    const resp = await respP;
    console.log(`[${tag}] clic=${clicked} → respuesta: ${resp ? `${resp.status()} ${resp.url().slice(60, 150)}` : 'NULL'}`);
    if (!resp) {
      const toast = (await page.locator('.ant-notification, .ant-message, nz-alert').allInnerTexts().catch(() => [])).join(' · ').replace(/\s+/g, ' ').trim();
      if (toast) console.log(`[${tag}] toast/alerta: "${toast.slice(0, 200)}"`);
    }
    await wait(2500);
    const rows = await page.locator('.ant-table-tbody tr').count().catch(() => 0);
    const body = (await page.locator('body').innerText({ timeout: 4000 }).catch(() => '')).replace(/\s+/g, ' ');
    const tits = [...new Set((body.match(/\b20\d{2}\s*-\s*\d{6,8}\b/g) ?? []).map((s) => s.replace(/\s+/g, '')))];
    console.log(`[${tag}] filas=${rows} · títulos=${JSON.stringify(tits)} · partida=${/\d{8}/.test(body.slice(0, 3000))}`);
    return !!resp;
  };

  const fired = await tryBuscar('SIN oficina');
  if (!fired) {
    console.log(`→ seleccionando oficina ${oficina} y reintentando…`);
    // sel0 = oficina (buscable): abrir, tipear y elegir del dropdown abierto
    const sel0 = page.locator('nz-select').nth(0);
    await sel0.locator('.ant-select-selector').first().click({ timeout: 4000 }).catch(() => {});
    await wait(500);
    await page.locator('.ant-select-selection-search-input:visible').first().fill(oficina).catch(() => {});
    await wait(900);
    const opt = openDropdown(page).locator('.ant-select-item-option-content', { hasText: new RegExp(`^\\s*${oficina}\\s*$`, 'i') }).first();
    if (await opt.isVisible().catch(() => false)) await opt.click().catch(() => {});
    else { console.log('   (sin match exacto, pruebo contains)'); await openDropdown(page).locator('.ant-select-item-option-content', { hasText: new RegExp(oficina, 'i') }).first().click().catch(() => {}); }
    await wait(800);
    console.log(`oficina: "${(await sel0.innerText().catch(() => '?')).replace(/\s+/g, ' ').trim()}"`);
    // re-verificar placa (el cambio de oficina puede resetear el form)
    const v = await num.inputValue().catch(() => '');
    if (v !== plate) { await num.click().catch(() => {}); await num.fill('').catch(() => {}); await num.type(plate, { delay: 50 }).catch(() => {}); }
    await tryBuscar('CON oficina');
  }
  await page.screenshot({ path: `${OUT}/sprl-form2-final.png`, fullPage: true }).catch(() => {});
  console.log(`captura: ${OUT}/sprl-form2-final.png`);
  process.exit(0);
};
main().catch((e) => { console.error('PROBE ERROR:', e); process.exit(1); });
