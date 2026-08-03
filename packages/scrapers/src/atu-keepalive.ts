/* eslint-disable no-console */
// Keep-alive de ATU (reCAPTCHA v3): MADURA la reputación del perfil persistente `.cdp-atu-profile`
// para que el v3 puntúe alto desde la IP del VPS. El score del v3 sube con: cookies de Google (NID),
// perfil AÑEJO y comportamiento consistente. Este proceso (cron pm2 ~8 min) visita Google (siembra/
// renueva NID) y ATU (baja el script de grecaptcha, marca la sesión) con gestos humanos — NO resuelve
// captcha ni scrapea. Con el tiempo el perfil madura → el reporte reusa ESE perfil y pasa el v3.
// Complementa el escudo `KEEP_ATU_WARM` (killEngineChrome ya no mata el Chrome de ATU tibio).
// Skip si el puerto está en uso (un reporte o el Chrome tibio ya lo tienen) → no choca con el motor.
//
// Uso (cron pm2 cada ~8 min):  DISPLAY=:99 npx tsx packages/scrapers/src/atu-keepalive.ts
import { spawn, execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { findChrome, chromeFlags } from './operator/chrome-path.js';
import { peruStamp } from './operator/time.js';

const CHROME = findChrome();
const PORT = Number(process.env.CDP_ATU_PORT ?? 9226);
const PROFILE = process.env.CDP_ATU_PROFILE ?? '/root/app/.cdp-atu-profile';
const ATU_URL = 'https://soluciones.atu.gob.pe/ConsultaVehiculo';
const LOG = process.env.ATU_KEEPALIVE_LOG ?? '/root/out/atu-keepalive.log';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function portBusy(p: number): boolean {
  try { return execSync(`ss -ltn 2>/dev/null | grep -c ':${p} '`).toString().trim() !== '0'; }
  catch { return false; }
}

(async () => {
  const ts = peruStamp();
  // Puerto ocupado = un reporte corriendo o el Chrome de ATU parqueado tibio (escudo KEEP_ATU_WARM):
  // en ambos casos el perfil ya está "vivo" → saltamos para no chocar con el Chrome del motor.
  if (portBusy(PORT)) { appendFileSync(LOG, `${ts} skip=puerto-en-uso\n`); process.exit(0); }
  if (!CHROME) { appendFileSync(LOG, `${ts} ERROR=sin-chrome\n`); process.exit(0); }

  let state = 'ERROR';
  const proc = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...chromeFlags(), 'https://www.google.com/'], { detached: false, stdio: 'ignore' });
  let browser: Browser | null = null;
  try {
    for (let i = 0; i < 20 && !browser; i++) { await wait(700); try { browser = await chromium.connectOverCDP(`http://localhost:${PORT}`); } catch { /* retry */ } }
    if (browser) {
      const ctx = browser.contexts()[0] ?? (await browser.newContext());
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      // Google: acepta el consentimiento → siembra/renueva la cookie NID (sube el score base del v3).
      await page.goto('https://www.google.com/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await page.locator('button:has-text("Aceptar todo"), button:has-text("Acepto")').first().click({ timeout: 2500 }).catch(() => {});
      await wait(2000);
      // ATU: carga la página (baja el script de grecaptcha, marca la sesión del sitio) + gestos humanos.
      await page.goto(ATU_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await page.mouse.move(220, 240).catch(() => {}); await wait(320);
      await page.mouse.move(480, 380).catch(() => {}); await wait(320);
      await page.mouse.move(300, 500).catch(() => {}); await wait(320);
      // ¿cargó grecaptcha? (señal de que el perfil quedó "engaged" con el sitio). String-arg = inmune a __name.
      const hasRc = await page.evaluate("typeof grecaptcha !== 'undefined'").catch(() => false);
      await wait(3000);
      state = hasRc ? 'WARM' : 'NO-RC';
    } else state = 'NO-CDP';
  } catch { state = 'ERR'; }
  finally { if (browser) await browser.close().catch(() => {}); try { proc.kill(); } catch { /* */ } }

  appendFileSync(LOG, `${ts} atu=${state}\n`);
  console.log(`${ts} atu=${state}`);
  process.exit(0);
})();
