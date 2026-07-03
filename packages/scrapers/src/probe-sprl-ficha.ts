/* eslint-disable no-console */
// Probe OPCIÓN A: ¿la PARTIDA/ficha del SPRL (gratis) trae la VERSIÓN + características del
// vehículo (N° Versión, Carrocería, Cilindrada, Combustible…) que hoy solo salen en la boleta
// de pago? Usa el SLOT 2 del SPRL. NO scrapea Síguelo: solo abre la partida por placa y VUELCA
// el contenido (txt/html/png) para inspeccionar. Login: UN solo intento, aborta si detecta
// bloqueo por IP (para no arriesgar la cuenta).
//   VPS:   DISPLAY=:99 npx tsx packages/scrapers/src/probe-sprl-ficha.ts BZI234
// Comparar contra la boleta de muestra: BZI234 → N° Versión "A 200 PROGRESSIVE", HATCHBACK, 1.332 L.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium, type Page, type Locator, type Browser } from 'playwright';
import { findChrome, chromeFlags } from './operator/chrome-path.js';
import { sprlSlots } from './operator/sprl-slots.js';

const INGRESO = 'https://sprl.sunarp.gob.pe/sprl/ingreso';
const PARTIDA = 'https://sprl.sunarp.gob.pe/sprl/main/partidas-base-grafica-registral';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const plate = (process.argv[2] ?? 'BZI234').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function pickNzSelect(sel: Locator, page: Page, optionText: RegExp): Promise<void> {
  await sel.locator('.ant-select-selector').first().click({ timeout: 5000 }).catch(() => {});
  await wait(500);
  const opt = page.locator('.ant-select-item-option-content', { hasText: optionText }).first();
  await opt.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  await opt.click().catch(() => {});
  await wait(800);
}

(async () => {
  const chrome = findChrome();
  if (!chrome) { console.log('no chrome'); process.exit(1); }
  const slot = sprlSlots().find((s) => s.index === 2);
  if (!slot || !slot.user || !slot.pass) { console.log('SLOT 2 no configurado (falta SPRL_USER_2/SPRL_PASS_2)'); process.exit(1); }
  console.log(`SPRL slot 2 (puerto ${slot.port}, perfil ${slot.profile}) → placa ${plate}`);

  const proc = spawn(chrome, [`--remote-debugging-port=${slot.port}`, `--user-data-dir=${slot.profile}`, ...chromeFlags(), INGRESO], { detached: false, stdio: 'ignore' });
  proc.on('error', (e) => console.log('spawn', e.message));
  let browser: Browser | null = null;
  for (let i = 0; i < 25 && !browser; i++) { await wait(700); try { browser = await chromium.connectOverCDP(`http://localhost:${slot.port}`); } catch { /* retry */ } }
  if (!browser) { console.log('no conecté CDP'); proc.kill(); process.exit(1); }

  try {
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const bodyUpper = async () => (await page.locator('body').innerText().catch(() => '')).toUpperCase();
    const isLogged = async () => /SALDO|BUSCAR SERVICIOS|CERRAR SESI|HOLA/.test(await bodyUpper());
    const isLocked = async () => /SUPER[OÓ].{0,15}N[UÚ]MERO DE INTENTOS|VUELVA M[AÁ]S TARDE|DEMASIADOS INTENTOS|CUENTA.{0,25}BLOQUEADA/i.test(await bodyUpper());

    // Espera el re-auth OAuth (la sesión del perfil puede tardar ~20s en renderizar).
    let logged = false;
    for (let i = 0; i < 20 && !logged; i++) { await wait(1000); logged = await isLogged(); }

    if (!logged) {
      console.log('sin sesión → login (1 intento; aborta si bloqueada)…');
      const passVisible = async () => page.locator('input[type="password"]:visible').first().isVisible().catch(() => false);
      if (!(await passVisible())) {
        await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* */ } }).catch(() => {});
        await ctx.clearCookies().catch(() => {});
        await page.goto(INGRESO, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        for (let i = 0; i < 25 && !(await passVisible()); i++) await wait(1000);
      }
      // Fallback: la home del SPRL muestra un botón "INGRESAR" que abre el form (igual que historial.ts).
      if (!(await passVisible())) {
        await page.locator('a:has-text("INGRESAR"), button:has-text("INGRESAR"), a:has-text("Acceder")').first().click({ timeout: 6000 }).catch(() => {});
        for (let i = 0; i < 15 && !(await passVisible()); i++) await wait(1000);
      }
      if (await isLocked()) { console.log('⚠ SLOT 2 BLOQUEADA por SUNARP (exceso de intentos) → aborto, no reintento'); await page.screenshot({ path: `sprl2-locked-${plate}.png`, fullPage: true }).catch(() => {}); proc.kill(); process.exit(0); }
      if (!(await passVisible())) { console.log('no apareció el form de login'); await page.screenshot({ path: `sprl2-noform-${plate}.png`, fullPage: true }).catch(() => {}); proc.kill(); process.exit(0); }
      await page.locator('input[name*="usuario" i], input[formcontrolname*="usuario" i], input[type="text"]:visible').first().fill(slot.user).catch(() => {});
      await page.locator('input[type="password"]:visible').first().fill(slot.pass).catch(() => {});
      let lt = '';
      for (let i = 0; i < 12 && !lt; i++) { await wait(1000); lt = await page.locator('input[name="cf-turnstile-response"]').first().inputValue({ timeout: 800 }).catch(() => ''); }
      console.log(lt ? `Turnstile login ok (${lt.length})` : 'login sin token Turnstile (no requerido)');
      const ing = page.locator('button:has-text("INGRESAR"), button:has-text("Ingresar"), button[type="submit"]');
      for (let i = 0; i < (await ing.count().catch(() => 0)); i++) { const b = ing.nth(i); if ((await b.isVisible().catch(() => false)) && (await b.isEnabled().catch(() => false))) { await b.click().catch(() => {}); break; } }
      for (let i = 0; i < 18 && !(await isLogged()); i++) await wait(1000);
      logged = await isLogged();
      if (!logged && (await isLocked())) { console.log('⚠ SLOT 2 quedó BLOQUEADA tras el intento → aborto'); proc.kill(); process.exit(0); }
    }
    if (!logged) { console.log('no se pudo iniciar sesión (revisa creds o Turnstile manual)'); await page.screenshot({ path: `sprl2-nologin-${plate}.png`, fullPage: true }).catch(() => {}); proc.kill(); process.exit(0); }
    console.log('✓ sesión SPRL activa (slot 2)');

    // Buscar la partida por PLACA (sin oficina; el SPRL busca por placa directo).
    await page.goto(PARTIDA, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.locator('nz-select').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await wait(1500);
    await pickNzSelect(page.locator('nz-select').filter({ hasText: /propiedad/i }).first(), page, /propiedad vehicular/i);
    await wait(800);
    await page.locator('label.ant-radio-wrapper', { hasText: /^placa$/i }).first().check().catch(() => {});
    await wait(500);
    const num = page.locator('#numero');
    await num.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    for (let i = 0; i < 3; i++) { await num.click().catch(() => {}); await num.fill('').catch(() => {}); await num.type(plate, { delay: 60 }).catch(() => {}); await wait(400); if ((await num.inputValue({ timeout: 1000 }).catch(() => '')) === plate) break; }
    for (let i = 0; i < 30; i++) { if (await page.locator('input[name="cf-turnstile-response"]').first().inputValue({ timeout: 1000 }).catch(() => '')) break; await wait(1000); }
    const respP = page.waitForResponse((r) => /mostrar-resultado-partida-veh/i.test(r.url()), { timeout: 30000 }).catch(() => null);
    const buscarBtns = page.locator('button:has-text("Buscar")');
    for (let i = 0; i < (await buscarBtns.count().catch(() => 0)); i++) { const b = buscarBtns.nth(i); if ((await b.isVisible().catch(() => false)) && (await b.isEnabled().catch(() => false))) { await b.click().catch(() => {}); break; } }
    await respP;
    await wait(2500);
    // La fila trae 3 acciones: [0] Ver Detalle · [1] Ver Asientos · [2] Boleta Informativa (pago).
    // Las CARACTERÍSTICAS (versión, carrocería…) deben estar en "Ver Detalle" (col 0), gratis.
    const rowBtns = page.locator('.ant-table-tbody tr button, table tbody tr button, .ant-table-tbody tr a, table tbody tr a');
    const nBtns = await rowBtns.count().catch(() => 0);
    console.log(`acciones en la fila: ${nBtns}`);
    for (let i = 0; i < Math.min(nBtns, 6); i++) {
      const b = rowBtns.nth(i);
      const t = ((await b.getAttribute('title').catch(() => '')) || (await b.getAttribute('aria-label').catch(() => '')) || (await b.innerText().catch(() => ''))).replace(/\s+/g, ' ').trim();
      console.log(`  acción[${i}]: "${t.slice(0, 45)}"`);
    }
    // Clic en "Ver Detalle": por texto/title si el botón lo trae; si no, el 1er botón de la fila.
    const detalle = page.locator('a[title*="detalle" i], button[title*="detalle" i], a:has-text("Ver Detalle"), button:has-text("Ver Detalle")').first();
    if (await detalle.count().catch(() => 0)) { await detalle.click().catch(() => {}); }
    else if (nBtns >= 1) { await rowBtns.nth(0).click().catch(() => {}); }
    await wait(5000);

    // VUELCA todo para inspección.
    const text = await page.locator('body').innerText().catch(() => '');
    const html = await page.content().catch(() => '');
    writeFileSync(`sprl2-ficha-${plate}.txt`, text);
    writeFileSync(`sprl2-ficha-${plate}.html`, html);
    await page.screenshot({ path: `sprl2-ficha-${plate}.png`, fullPage: true }).catch(() => {});

    // Pistas de versión/características (lo que trae la boleta de pago).
    const KEYS = ['versi', 'carrocer', 'combustible', 'cilindrad', 'progressive', 'n° motor', 'categor'];
    console.log('---- ¿LA PARTIDA TRAE LAS CARACTERÍSTICAS? ----');
    const found = KEYS.filter((k) => text.toLowerCase().includes(k));
    console.log('campos hallados:', found.length ? found.join(', ') : '(ninguno)');
    for (const kw of ['versi', 'carrocer', 'cilindrad', 'combustible']) {
      const idx = text.toLowerCase().indexOf(kw);
      if (idx >= 0) console.log(`  [${kw}] …${text.slice(Math.max(0, idx - 15), idx + 90).replace(/\s+/g, ' ')}…`);
    }
    console.log(`(BZI234 esperado en la boleta → N° Versión "A 200 PROGRESSIVE")`);
    console.log(`dumps: sprl2-ficha-${plate}.{txt,html,png}  · texto: ${text.length} chars`);
  } catch (e) { console.log('ERR', (e as Error).message); }
  finally { if (browser) await browser.close().catch(() => {}); proc.kill(); }
  process.exit(0);
})();
