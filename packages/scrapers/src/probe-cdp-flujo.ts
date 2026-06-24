/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { chromium, type Page, type Locator, type BrowserContext } from 'playwright';
import { parseAsiento, pdfBytesToText, construirTimeline, type AsientoRecord } from './operator/asiento-parser.js';
import { scrapeSunarpViaCdp } from './operator/cdp-sunarp.js';

/**
 * FLUJO INTEGRADO SPRL → Síguelo Plus (HÍBRIDO CDP), en la MISMA sesión logueada.
 *
 *   1. SPRL (cuenta del operador, login manual la 1ª vez): Área "Propiedad
 *      Vehicular" + Oficina + Placa → Buscar → "Ver Asientos" (GRATIS).
 *   2. Extrae el TÍTULO (año + número) y el N° de asiento del panel/REST (AES).
 *   3. Abre Síguelo Plus EN LA MISMA SESIÓN/navegador, carga oficina+año+título
 *      y captura el endpoint del precio (asientoinscripcion).
 *
 * Uso: npx tsx packages/scrapers/src/probe-cdp-flujo.ts BTF268 LIMA
 */
const argv = process.argv.slice(2);
const forceLogin = argv.includes('--force-login'); // limpia cookies+storage para probar el login auto
const loginOnly = argv.includes('--login-only'); // corta tras el login (test rápido)
const pos = argv.filter((a) => !a.startsWith('--'));
const plate = (pos[0] ?? 'BTF268').toUpperCase().replace(/[^A-Z0-9]/g, '');
const oficinaArg = (pos[1] ?? '').toUpperCase();
let oficina = oficinaArg || 'LIMA'; // se sobreescribe con la SEDE de la consulta vehicular
const PORT = 9224;
const PROFILE = 'd:/Jose/Proyecto_Consulta_placa/.cdp-sprl-profile';
const INGRESO = 'https://sprl.sunarp.gob.pe/sprl/ingreso';
const PARTIDA = 'https://sprl.sunarp.gob.pe/sprl/main/partidas-base-grafica-registral';
const SIGUELO = 'https://sigueloplus.sunarp.gob.pe/siguelo/';
const OUT = 'd:/Jose/Proyecto_Consulta_placa/validacion-fuentes';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Credenciales SPRL por ENTORNO (el operador las pone en .env; nunca se imprimen).
const SPRL_USER = process.env.SPRL_USER ?? '';
const SPRL_PASS = process.env.SPRL_PASS ?? '';

const SPRL_KEY = 'sUIZJFw36fA7GzpS';
function sprlDecrypt(b64: string): unknown | null {
  try {
    const blob = Buffer.from(b64.trim(), 'base64');
    if (blob.length < 32 || blob.length % 16 !== 0) return null;
    const d = crypto.createDecipheriv('aes-128-cbc', Buffer.from(SPRL_KEY, 'utf8'), blob.subarray(0, 16));
    const out = Buffer.concat([d.update(blob.subarray(16)), d.final()]).toString('utf8');
    try { return JSON.parse(out); } catch { return out; }
  } catch { return null; }
}

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
].find((p) => existsSync(p));
if (!CHROME) { console.error('No encontré chrome.exe.'); process.exit(1); }

const api: Array<{ url: string; json: unknown }> = [];
function hookPage(page: Page, label: string) {
  page.on('response', (resp) => {
    const u = resp.url();
    if (!/sunarp-services|siguelo|asientoinscripcion|api-gateway\.sunarp/i.test(u)) return;
    if (/\.(js|css|png|jpe?g|svg|woff2?|ttf|otf|eot|ico)(\?|$)|version\.json|captcha\/image|assets\//i.test(u)) return;
    resp.text().then((body) => {
      if (!body || body.length < 5) return;
      let parsed: unknown = body;
      try {
        const j = JSON.parse(body) as { data?: unknown };
        parsed = j;
        if (typeof j.data === 'string' && j.data.length > 40) { const dec = sprlDecrypt(j.data); if (dec) parsed = { ...j, data: dec }; }
      } catch { /* texto plano */ }
      api.push({ url: u, json: parsed });
      console.log(`📥 [${label}]`, u.slice(-55));
    }).catch(() => {});
  });
}

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
  } catch (e) { console.warn(`   ✗ ${label}: ${(e as Error).message}`); return false; }
}
async function pickSearchable(sel: Locator, page: Page, value: string, label: string): Promise<boolean> {
  try {
    await sel.locator('.ant-select-selector').first().click({ timeout: 5000 });
    await wait(400);
    await page.locator('.ant-select-selection-search-input:visible').first().fill(value);
    await wait(900);
    const opt = page.locator('.ant-select-item-option-content', { hasText: new RegExp(`^\\s*${value}\\s*$`, 'i') }).first();
    await opt.waitFor({ state: 'visible', timeout: 5000 });
    await opt.click();
    await wait(800);
    console.log(`   ✓ ${label}`);
    return true;
  } catch (e) { console.warn(`   ✗ ${label}: ${(e as Error).message}`); return false; }
}

console.log(`Lanzando flujo completo (Consulta Vehicular → SPRL → Síguelo) · placa ${plate}${oficinaArg ? ` · oficina forzada ${oficinaArg}` : ''}`);
const proc = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', INGRESO], { detached: false, stdio: 'ignore' });
proc.on('error', (e) => console.error('spawn:', e.message));
await wait(5000);

try {
  const browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
  console.log('Conectado por CDP ✓');
  const ctx: BrowserContext = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  hookPage(page, 'SPRL');

  // ── Paso 1/3: Consulta Vehicular (SUNARP) → SEDE (= oficina del SPRL) ──
  console.log(`\n→ [1/3] Consulta Vehicular (SUNARP) · ${plate}…`);
  const sun = await scrapeSunarpViaCdp(plate, { shotPath: `${OUT}/flujo-sunarp.png`, log: (m) => console.log('   [sunarp]', m) }).catch((e) => { console.warn('   sunarp err:', (e as Error).message); return null; });
  const sede = ((sun?.data?.sede as string | undefined) ?? '').trim();
  if (sede) oficina = sede.toUpperCase();
  console.log(sede ? `   ✓ sede=${oficina} · ${(sun?.data?.ownerName as string) ?? ''} · ${(sun?.data?.brand as string) ?? ''} ${(sun?.data?.model as string) ?? ''}` : `   ⚠️ sin sede; uso oficina=${oficina}`);

  // ── Paso 2/3: SPRL — login (reusa sesión; si expiró, login AUTOMÁTICO con .env) ──
  if (forceLogin) {
    console.log('   (--force-login) logout REAL: limpiando cookies + localStorage + sessionStorage…');
    await page.goto(INGRESO, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* */ } }).catch(() => {});
    await ctx.clearCookies().catch(() => {});
    await page.goto(INGRESO, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await wait(2500);
  }
  const isLogged = async () => /SALDO|BUSCAR SERVICIOS|CERRAR SESI|HOLA/.test((await page.locator('body').innerText().catch(() => '')).toUpperCase());
  async function autoLogin(): Promise<boolean> {
    if (await isLogged()) return true;
    if (!SPRL_USER || !SPRL_PASS) return false;
    // Ir al formulario si aún no hay campo de password visible.
    if (!(await page.locator('input[type="password"]:visible').first().isVisible().catch(() => false))) {
      await page.locator('a:has-text("INGRESAR"), button:has-text("INGRESAR"), a:has-text("Acceder")').first().click({ timeout: 5000 }).catch(() => {});
      await wait(3500);
    }
    const pass = page.locator('input[type="password"]:visible').first();
    if (!(await pass.isVisible().catch(() => false))) { console.log('   ⚠️ no hallé el form de login (volqué flujo-login.html)'); writeFileSync(`${OUT}/flujo-login.html`, await page.content().catch(() => ''), 'utf8'); return false; }
    const user = page.locator('input[name*="usuario" i], input[formcontrolname*="usuario" i], input[type="text"]:visible').first();
    await user.fill(SPRL_USER).catch(() => {});
    await pass.fill(SPRL_PASS).catch(() => {});
    console.log('   login automático (creds de .env)…');
    // El Turnstile del login GATEA el botón INGRESAR → esperar a que pase.
    let lt = '';
    for (let i = 0; i < 45 && !lt; i++) { await wait(1000); lt = await page.locator('input[name="cf-turnstile-response"]').first().inputValue({ timeout: 1000 }).catch(() => ''); }
    console.log(lt ? `   ✓ Turnstile login (${lt.length})` : '   ⚠️ Turnstile login no pasó pasivo → quizá haya que marcar el checkbox a mano');
    await page.screenshot({ path: `${OUT}/flujo-login.png`, fullPage: true }).catch(() => {});
    writeFileSync(`${OUT}/flujo-login.html`, await page.content().catch(() => ''), 'utf8');
    // Clic en el INGRESAR visible y habilitado (no uno oculto); fallback: Enter.
    const ing = page.locator('button:has-text("INGRESAR"), button:has-text("Ingresar"), button[type="submit"], input[type="submit"]');
    let clicked = false;
    for (let i = 0; i < (await ing.count().catch(() => 0)); i++) {
      const b = ing.nth(i);
      if ((await b.isVisible().catch(() => false)) && (await b.isEnabled().catch(() => false))) { await b.click().catch(() => {}); clicked = true; break; }
    }
    if (!clicked) await pass.press('Enter').catch(() => {});
    for (let i = 0; i < 12 && !(await isLogged()); i++) await wait(1000);
    if (!(await isLogged())) { await pass.press('Enter').catch(() => {}); for (let i = 0; i < 12 && !(await isLogged()); i++) await wait(1000); }
    return isLogged();
  }
  let logged = false;
  for (let i = 0; i < 8 && !logged; i++) { await wait(1000); logged = await isLogged(); }
  if (!logged) logged = await autoLogin();
  if (!logged) {
    console.log(`⏳ ${SPRL_USER ? 'Login auto no entró (revisa flujo-login.png/html); ' : 'Define SPRL_USER/SPRL_PASS en .env. '}Inicia sesión a mano. Espero 2 min…`);
    for (let i = 0; i < 120 && !logged; i++) { await wait(1000); logged = await isLogged(); }
  }
  console.log(logged ? '✓ Sesión activa' : '⚠️ Sin sesión; intento igual');
  if (loginOnly) { console.log(`\n(--login-only) login ${logged ? 'OK ✓' : 'FALLÓ ✗'}. Form en flujo-login.html/png. Fin.`); await browser.close().catch(() => {}); process.exit(0); }

  // ── SPRL: buscar partida ──
  await page.goto(PARTIDA, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await wait(3000);
  await pickNzSelect(page.locator('nz-select').filter({ hasText: /propiedad/i }).first(), page, /propiedad vehicular/i, 'Área = Propiedad Vehicular');
  await wait(1000);
  await pickSearchable(page.locator('nz-select').filter({ hasText: /seleccione/i }).first(), page, oficina, `Oficina = ${oficina}`);
  await wait(1000);
  // Seleccionar "Placa" y llenar el N° de forma ROBUSTA (esperar el campo, escribir
  // carácter por carácter para que Angular lo registre, y verificar que quedó).
  await page.locator('label.ant-radio-wrapper', { hasText: /^placa$/i }).first().check().catch(() => {});
  await wait(600);
  const num = page.locator('#numero');
  await num.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  let plateOk = false;
  for (let i = 0; i < 3 && !plateOk; i++) {
    await num.click().catch(() => {});
    await num.fill('').catch(() => {});
    await num.type(plate, { delay: 60 }).catch(() => {});
    await num.evaluate((el: HTMLInputElement) => { for (const t of ['input', 'change', 'blur']) el.dispatchEvent(new Event(t, { bubbles: true })); }).catch(() => {});
    await wait(400);
    plateOk = (await num.inputValue({ timeout: 1000 }).catch(() => '')) === plate;
  }
  console.log(plateOk ? `   ✓ Placa ${plate} ingresada` : `   ⚠️ no pude fijar la placa ${plate} (¿campo distinto?)`);
  console.log('   esperando Turnstile pasivo (SPRL)…');
  let tok = '';
  for (let i = 0; i < 45 && !tok; i++) { await wait(1000); tok = await page.locator('input[name="cf-turnstile-response"]').first().inputValue({ timeout: 1000 }).catch(() => ''); }
  console.log(tok ? `   ✓ Turnstile SPRL (${tok.length})` : '   ⚠️ Turnstile SPRL no pasó');
  const buscarBtns = page.locator('button:has-text("Buscar")');
  for (let i = 0; i < (await buscarBtns.count().catch(() => 0)); i++) {
    const b = buscarBtns.nth(i);
    if ((await b.isVisible().catch(() => false)) && (await b.isEnabled().catch(() => false))) { await b.click().catch(() => {}); break; }
  }
  await wait(6000);

  // ── Ver Asientos (btn #1 de la fila; #2 = Boleta $, evitar) ──
  const rowBtns = page.locator('.ant-table-tbody tr button, table tbody tr button');
  if ((await rowBtns.count().catch(() => 0)) >= 2) { await rowBtns.nth(1).click().catch(() => {}); await wait(4000); }
  await page.screenshot({ path: `${OUT}/flujo-1-asientos.png`, fullPage: true }).catch(() => {});

  // ── Extraer título (año + número) ──
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const titulos = [...new Set(((bodyText + ' ' + JSON.stringify(api)).match(/\b20\d{2}\s*-\s*\d{6,8}\b/g) ?? []).map((s) => s.replace(/\s+/g, '')))];
  console.log(`\n=== TÍTULOS desde SPRL: ${JSON.stringify(titulos)} ===`);
  if (!titulos.length) {
    console.log('⚠️ No extraje títulos del SPRL. Revisa flujo-1-asientos.png / completa a mano.');
  }

  // ── Síguelo Plus en la MISMA sesión: BUCLE sobre TODOS los títulos ──
  const SG_PASS = 'sV2zUWiuNo@3uv8nu9ir4';
  const sgDecrypt = (b64: string): string | null => {
    try {
      const data = Buffer.from(b64, 'base64');
      const salt = data.subarray(8, 16);
      let dd = Buffer.alloc(0), bb = Buffer.alloc(0);
      while (dd.length < 48) { bb = crypto.createHash('md5').update(Buffer.concat([bb, Buffer.from(SG_PASS, 'utf8'), salt])).digest(); dd = Buffer.concat([dd, bb]); }
      const c = crypto.createDecipheriv('aes-256-cbc', dd.subarray(0, 32), dd.subarray(32, 48));
      return Buffer.concat([c.update(data.subarray(16)), c.final()]).toString('utf8');
    } catch { return null; }
  };
  const sg = await ctx.newPage();
  hookPage(sg, 'SIGUELO');
  const fire = (el: Element) => { for (const t of ['input', 'change', 'blur']) el.dispatchEvent(new Event(t, { bubbles: true })); };
  // Aceptar T&C: clic "Acepto" (NO "No Acepto"); si no, abrir por el link "ingresar".
  const aceptarTC = async (): Promise<void> => {
    const btn = sg.locator('button').filter({ hasText: /acepto/i }).filter({ hasNotText: /no\s*acepto/i }).first();
    if (await btn.isVisible().catch(() => false)) { await btn.click().catch(() => {}); await wait(700); return; }
    const link = sg.locator('a:has-text("ingresar"), a:has-text("términos"), a:has-text("terminos")').first();
    if (await link.isVisible().catch(() => false)) {
      await link.click().catch(() => {}); await wait(1200);
      await sg.locator('button').filter({ hasText: /acepto/i }).filter({ hasNotText: /no\s*acepto/i }).first().click().catch(() => {});
      await wait(700);
    }
  };
  // Busca UN título en Síguelo y devuelve el texto del PDF del asiento (o null).
  async function searchSiguelo(anioT: string, numeroT: string): Promise<string | null> {
    await sg.goto(SIGUELO, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await wait(1800);
    await aceptarTC();
    await sg.locator('input[name="optradio"]').first().check().catch(() => {});
    await sg.selectOption('#cboOficina', { label: oficina }).catch(() => {});
    await sg.locator('#cboOficina').evaluate(fire).catch(() => {});
    await sg.selectOption('#cboAnio', { label: anioT }).catch(() => {});
    await sg.locator('#cboAnio').evaluate(fire).catch(() => {});
    await sg.locator('input[name="numeroTitulo"]').fill(numeroT).catch(() => {});
    await sg.locator('input[name="numeroTitulo"]').evaluate(fire).catch(() => {});
    for (let i = 0; i < 45; i++) { if (await sg.locator('input[name="cf-turnstile-response"]').first().inputValue({ timeout: 1000 }).catch(() => '')) break; await wait(1000); }
    const buscar = sg.locator('button:has-text("BUSCAR")').first();
    if (!(await buscar.isEnabled().catch(() => false))) { await aceptarTC(); await wait(500); }
    if (!(await buscar.isEnabled().catch(() => false))) { console.log(`   ✗ BUSCAR disabled`); return null; }
    const respP = sg.waitForResponse((r) => /listarAsientos/i.test(r.url()), { timeout: 70000 }).catch(() => null);
    await buscar.click().catch(() => {});
    await wait(4000);
    for (const txt of ['Asiento de inscripción', 'Asiento de inscripcion', 'Asiento']) {
      const el = sg.locator(`button:has-text("${txt}"), a:has-text("${txt}"), [role="tab"]:has-text("${txt}")`).first();
      if (await el.isVisible().catch(() => false)) { await el.click().catch(() => {}); await wait(3000); break; }
    }
    const ojo = sg.locator('button:has(i.fa-eye), a:has(i.fa-eye), .fa-eye, button.btn-success, [title*="ver" i], [title*="asiento" i]').first();
    if (await ojo.isVisible().catch(() => false)) { await ojo.click().catch(() => {}); }
    const resp = await respP;
    if (!resp) return null;
    const body = (await resp.json().catch(() => null)) as { cmVzcG9uc2U?: string } | null;
    const dec = body?.cmVzcG9uc2U ? sgDecrypt(body.cmVzcG9uc2U) : null;
    const obj = dec ? (JSON.parse(dec) as { list?: Array<{ paginaAsiento?: number[] }> }) : null;
    const bytes = obj?.list?.[0]?.paginaAsiento;
    return Array.isArray(bytes) ? pdfBytesToText(bytes) : null;
  }

  const records: AsientoRecord[] = [];
  for (const tit of titulos) {
    const [aT, nT] = tit.split('-');
    if (!aT || !nT) continue;
    console.log(`\n→ Síguelo título ${tit} (oficina ${oficina})…`);
    const text = await searchSiguelo(aT, nT).catch((e) => { console.warn('   err:', (e as Error).message); return null; });
    if (text) {
      const rec = parseAsiento(text);
      records.push(rec);
      const fl = [rec.flags.aseguradora && '⚠ASEGURADORA', rec.flags.remate && '⚠REMATE', rec.flags.financiera && '⚠FINANCIERA'].filter(Boolean).join(' ');
      console.log(`   ✓ ${rec.acto || rec.tipo} · ${rec.precio || 's/precio'} · ${rec.fechaPresentacion} ${fl}`);
    } else {
      console.log('   ✗ no capturé el asiento');
    }
  }
  await sg.screenshot({ path: `${OUT}/flujo-2-siguelo.png`, fullPage: true }).catch(() => {});

  // ── Timeline cronológico + señales de due-diligence ──
  const timeline = construirTimeline(records);
  const flags = {
    aseguradora: records.some((r) => r.flags.aseguradora),
    remate: records.some((r) => r.flags.remate),
    financiera: records.some((r) => r.flags.financiera),
    gravamen: records.some((r) => r.flags.gravamen),
    embargo: records.some((r) => r.flags.embargo),
  };
  console.log('\n════════ LÍNEA DE TIEMPO ════════');
  for (const r of timeline) {
    console.log(`• ${(r.fechaPresentacion || '').slice(0, 10) || '????'} · ${r.acto || r.tipo} · ${r.precio || '—'} · ${r.participantes.slice(0, 70)}`);
  }
  const hayBandera = flags.aseguradora || flags.remate || flags.gravamen || flags.embargo;
  console.log('\n🚩 Señales:', JSON.stringify(flags), hayBandera ? '← REVISAR' : '(sin banderas)');

  writeFileSync(`${OUT}/flujo.json`, JSON.stringify({ plate, oficina, titulos, flags, timeline }, null, 2), 'utf8');
  console.log(`\n✓ Guardado en ${OUT}/flujo.json (${records.length}/${titulos.length} asientos)`);
  await browser.close().catch(() => {});
} catch (e) {
  console.error('ERROR:', (e as Error).message);
} finally {
  console.log('\n(Chrome queda abierto; ciérralo cuando quieras.)');
  process.exit(0);
}
