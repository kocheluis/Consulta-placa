/* eslint-disable no-console */
// Probe: ¿ATU funciona en el Chrome REAL por CDP (reCAPTCHA v3 nativo, sin CapSolver)?
// Hipótesis: el v3 puntúa el navegador; headless = score bajo (rechazado); Chrome limpio
// (el que pasa el Turnstile de SUNARP) = score alto → ATU devuelve datos sin solver.
//   DISPLAY=:99 npx tsx packages/scrapers/src/probe-atu-cdp.ts BMZ084
import { spawn } from 'node:child_process';
import { chromium, type Browser } from 'playwright';
import { findChrome, chromeFlags } from './operator/chrome-path.js';

const CHROME = findChrome();
const PORT = Number(process.env.CDP_ATU_PORT ?? 9226);
const PROFILE = process.env.CDP_ATU_PROFILE ?? '/root/.cdp-atu-profile';
const URL = 'https://soluciones.atu.gob.pe/ConsultaVehiculo';
const plate = (process.argv[2] ?? 'BMZ084').toUpperCase();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!CHROME) { console.log('no chrome'); process.exit(1); }
  console.log(`Chrome real (CDP :${PORT}) → ATU ${plate}…`);
  const proc = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...chromeFlags(), URL], { detached: false, stdio: 'ignore' });
  proc.on('error', (e) => console.log('spawn err', e.message));
  let browser: Browser | null = null;
  for (let i = 0; i < 25 && !browser; i++) { await wait(700); try { browser = await chromium.connectOverCDP(`http://localhost:${PORT}`); } catch { /* retry */ } }
  if (!browser) { console.log('no conecté CDP'); proc.kill(); process.exit(1); }
  try {
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await wait(1800);
    for (const t of ['Acepto', 'Aceptar', 'ACEPTO', 'De acuerdo']) {
      const b = page.locator(`button:has-text("${t}"), a:has-text("${t}")`).first();
      if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await wait(600); break; }
    }
    const inp = page.locator('input#placa, input[name*="laca" i], input[placeholder*="laca" i], input[formcontrolname*="laca" i]').first();
    await inp.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await inp.fill(plate);
    await wait(900);
    // Clic en Buscar — dejamos que el reCAPTCHA v3 NATIVO se ejecute (sin inyectar token).
    await page.locator('button:has-text("Buscar"), button[type="submit"]').first().click().catch(() => {});
    await wait(8000);
    await page.waitForLoadState('networkidle').catch(() => {});
    const body = (await page.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
    const vals = String(await page.evaluate(`Array.from(document.querySelectorAll('input')).map(function(i){return i.value}).filter(function(v){return v&&v.trim()}).join(' | ')`).catch(() => ''));
    const done = /consultar otra placa|fecha y hora de consulta/i.test(body);
    const recap = /verificar\s*re-?captcha/i.test(body);
    console.log('---- RESULTADO ----');
    console.log('done(búsqueda completa)=', done, '| pide-verificar-recaptcha=', recap);
    console.log('VALORES:', vals.slice(0, 400));
    await page.screenshot({ path: `/root/out/atu-cdp-${plate}.png`, fullPage: true }).catch(() => {});
    console.log('screenshot: /root/out/atu-cdp-' + plate + '.png');
  } catch (e) { console.log('ERR', (e as Error).message); }
  finally { if (browser) await browser.close().catch(() => {}); proc.kill(); }
  process.exit(0);
})();
