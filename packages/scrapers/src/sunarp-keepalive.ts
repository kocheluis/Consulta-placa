/* eslint-disable no-console */
// Keep-alive del clearance de SUNARP (Consulta Vehicular): mantiene "caliente" el perfil
// persistente `.cdp-chrome-profile` para que el Turnstile PASE PASIVO más seguido desde la
// IP del VPS (era intermitente → a veces el reporte salía sin identidad/REGISTRAL, riesgo S-01).
// NO resuelve captcha ni scrapea: solo navega a la página y comprueba si el token pasivo
// aparece (clearance vivo), refrescando la cookie de Cloudflare del perfil. Registra CLEARANCE
// vivo/caído con timestamp (hora Perú) → mide qué tan seguido pasa.
//
// Uso (cron pm2 cada ~8 min):  DISPLAY=:99 npx tsx packages/scrapers/src/sunarp-keepalive.ts
import { spawn, execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { findChrome, chromeFlags } from './operator/chrome-path.js';
import { peruStamp } from './operator/time.js';

const CHROME = findChrome();
const PORT = Number(process.env.CDP_SUNARP_PORT ?? 9222);
const PROFILE = process.env.CDP_CHROME_PROFILE ?? '/root/app/.cdp-chrome-profile';
const URL = 'https://consultavehicular.sunarp.gob.pe/';
const LOG = process.env.SUNARP_KEEPALIVE_LOG ?? '/root/out/sunarp-keepalive.log';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function portBusy(p: number): boolean {
  try { return execSync(`ss -ltn 2>/dev/null | grep -c ':${p} '`).toString().trim() !== '0'; }
  catch { return false; }
}

(async () => {
  const ts = peruStamp();
  // Si el perfil ya está en uso (un reporte con SUNARP corriendo), el clearance está caliente
  // por definición → saltamos este ciclo para no chocar con el Chrome del motor.
  if (portBusy(PORT)) { appendFileSync(LOG, `${ts} skip=perfil-en-uso\n`); process.exit(0); }
  if (!CHROME) { appendFileSync(LOG, `${ts} ERROR=sin-chrome\n`); process.exit(0); }

  let state = 'ERROR';
  const proc = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...chromeFlags(), URL], { detached: false, stdio: 'ignore' });
  let browser: Browser | null = null;
  try {
    for (let i = 0; i < 20 && !browser; i++) { await wait(700); try { browser = await chromium.connectOverCDP(`http://localhost:${PORT}`); } catch { /* retry */ } }
    if (browser) {
      const ctx = browser.contexts()[0] ?? (await browser.newContext());
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      // Espera hasta ~25s a que el Turnstile pasivo deje el token (= clearance vivo).
      let token = '';
      for (let i = 0; i < 25 && !token; i++) {
        await wait(1000);
        // inputValue con timeout: sin él, si el input no existe, cada llamada cuelga 30s.
        token = await page.locator('input[name="cf-turnstile-response"]').first().inputValue({ timeout: 1000 }).catch(() => '');
      }
      state = token ? 'VIVO' : 'CAIDO';
    } else state = 'NO-CDP';
  } catch { state = 'ERR'; }
  finally { if (browser) await browser.close().catch(() => {}); try { proc.kill(); } catch { /* */ } }

  appendFileSync(LOG, `${ts} clearance=${state}\n`);
  console.log(`${ts} clearance=${state}`);
  process.exit(0);
})();
