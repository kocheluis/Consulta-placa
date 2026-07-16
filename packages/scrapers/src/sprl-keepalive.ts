/* eslint-disable no-console */
// Keep-alive de la sesión SPRL: mantiene "viva" la sesión del perfil persistente para que
// el motor NO tenga que re-loguear en cada reporte (el re-login en bucle disparaba el
// bloqueo de SUNARP por exceso de intentos). NO hace login — solo refresca si YA hay sesión;
// así no hay riesgo de bloqueo. Registra el estado con timestamp en un log → mide el TTL real.
//
// Uso (cron pm2 cada ~8 min):  DISPLAY=:99 npx tsx packages/scrapers/src/sprl-keepalive.ts
import { spawn, execSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { findChrome, chromeFlags } from './operator/chrome-path.js';
import { sprlSlots } from './operator/sprl-slots.js';
import { peruStamp } from './operator/time.js';

// Carga secretos del VPS desde /root/placape.env (igual que operator-server) ANTES de leer los slots
// SPRL: pm2 lanza este proceso sin esas variables, así que sin esto sprlSlots() no vería SPRL_USER_2/3
// → el keep-alive solo refrescaría la cuenta 1. El archivo GANA sobre el entorno de pm2.
(function loadEnvFile() {
  const f = process.env.OPERATOR_ENV_FILE ?? '/root/placape.env';
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m || !m[1]) continue;
      let v = m[2] ?? '';
      if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, ''); // comentario inline solo si no está entrecomillado
      process.env[m[1]] = v.trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* sin archivo (dev/Windows) → no-op */ }
})();

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
      // El re-auth OAuth (SSO vivo pero token SPRL expirado) puede tardar >20s en renderizar la
      // página logueada. Un único read a los 3.5s daba FALSO CAIDA y —peor— mataba el browser
      // ANTES de que el re-auth que dispara este mismo goto terminara → la sesión nunca se
      // restauraba (2h de CAIDA en el log). Poll hasta ~30s: paramos apenas veamos VIVA, y el
      // dwell deja que el re-auth complete y mantenga la sesión de verdad.
      const RX_VIVA = /SALDO|BUSCAR SERVICIOS|CERRAR SESI|HOLA/;
      let body = '';
      for (let i = 0; i < 30; i++) {
        await wait(1000);
        body = (await page.locator('body').innerText().catch(() => '')).toUpperCase();
        if (RX_VIVA.test(body)) break;
      }
      state = RX_VIVA.test(body) ? 'VIVA'
        : (/PASSWORD|USERNAME|INGRESAR/.test(body) ? 'CAIDA' : 'DESCONOCIDO');
    } else state = 'NO-CDP';
  } catch { state = 'ERR'; }
  finally { if (browser) await browser.close().catch(() => {}); try { proc.kill(); } catch { /* */ } }

  appendFileSync(LOG, `${ts} ${label} sesion=${state}\n`);
  console.log(`${ts} ${label} sesion=${state}`);
  return state;
}

(async () => {
  // Refresca CADA slot configurado (cuentas 1, 2 y 3 si existen) EN SECUENCIA: cada uno tiene su
  // perfil/puerto propio, así TODAS las sesiones se mantienen vivas → habilitar una cuenta nueva es
  // solo poner sus env (SPRL_USER_N/SPRL_PASS_N); este keep-alive la cubre automáticamente. Sin
  // sesiones calientes en paralelo NO se debe subir HISTORIAL_CONCURRENCY (cold-login → lockout).
  const slots = sprlSlots();
  for (const s of slots) {
    await refreshSlot(s.port, s.profile, `slot${s.index}`);
  }
  process.exit(0);
})();
