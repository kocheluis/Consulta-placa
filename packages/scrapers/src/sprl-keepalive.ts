/* eslint-disable no-console */
// Keep-alive de la sesión SPRL: mantiene "viva" la sesión del perfil persistente para que
// el motor NO tenga que re-loguear en cada reporte (el re-login en bucle disparaba el
// bloqueo de SUNARP por exceso de intentos). NO hace login — solo refresca si YA hay sesión;
// así no hay riesgo de bloqueo. Registra el estado con timestamp en un log → mide el TTL real.
//
// Uso (cron pm2 cada ~8 min):  DISPLAY=:99 npx tsx packages/scrapers/src/sprl-keepalive.ts
import { spawn, execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { findChrome, chromeFlags } from './operator/chrome-path.js';
import { sprlSlots } from './operator/sprl-slots.js';
import { peruStamp } from './operator/time.js';

const CHROME = findChrome();
const PARTIDA = 'https://sprl.sunarp.gob.pe/sprl/main/partidas-base-grafica-registral';
const LOG = process.env.SPRL_KEEPALIVE_LOG ?? '/root/out/sprl-keepalive.log';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function portBusy(p: number): boolean {
  try { return execSync(`ss -ltn 2>/dev/null | grep -c ':${p} '`).toString().trim() !== '0'; }
  catch { return false; }
}

/** Refresca la sesión de UN slot SPRL (perfil/puerto propios). NO hace login. */
async function refreshSlot(port: number, profile: string, label: string): Promise<string> {
  const ts = peruStamp();
  // Si el perfil ya está en uso (un reporte con historial corriendo), la sesión está caliente
  // por definición → saltamos este ciclo para no chocar con el Chrome del motor.
  if (portBusy(port)) { appendFileSync(LOG, `${ts} ${label} skip=perfil-en-uso\n`); return 'EN-USO'; }
  if (!CHROME) { appendFileSync(LOG, `${ts} ${label} ERROR=sin-chrome\n`); return 'ERROR'; }

  let state = 'ERROR';
  const proc = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...chromeFlags(), PARTIDA], { detached: false, stdio: 'ignore' });
  let browser: Browser | null = null;
  try {
    for (let i = 0; i < 20 && !browser; i++) { await wait(700); try { browser = await chromium.connectOverCDP(`http://localhost:${port}`); } catch { /* retry */ } }
    if (browser) {
      const ctx = browser.contexts()[0] ?? (await browser.newContext());
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto(PARTIDA, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await wait(3500);
      const body = (await page.locator('body').innerText().catch(() => '')).toUpperCase();
      state = /SALDO|BUSCAR SERVICIOS|CERRAR SESI|HOLA/.test(body) ? 'VIVA'
        : (/PASSWORD|USERNAME|INGRESAR/.test(body) ? 'CAIDA' : 'DESCONOCIDO');
    } else state = 'NO-CDP';
  } catch { state = 'ERR'; }
  finally { if (browser) await browser.close().catch(() => {}); try { proc.kill(); } catch { /* */ } }

  appendFileSync(LOG, `${ts} ${label} sesion=${state}\n`);
  console.log(`${ts} ${label} sesion=${state}`);
  return state;
}

(async () => {
  // Refresca CADA slot configurado (cuenta 1 y, si existe, cuenta 2) en secuencia:
  // cada uno tiene su perfil/puerto propio, así ambas sesiones se mantienen vivas.
  const slots = sprlSlots();
  for (const s of slots) {
    await refreshSlot(s.port, s.profile, `slot${s.index}`);
  }
  process.exit(0);
})();
