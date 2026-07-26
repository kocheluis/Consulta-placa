/* eslint-disable no-console */
// SEMILLA de sesión SPRL: abre el Chrome de UN slot (perfil/puerto propios) y hace UN login para
// dejar la sesión ESTABLECIDA en el perfil persistente. Después el keep-alive la mantiene viva
// (refresca cada ~8 min por re-auth OAuth). Úsalo una vez por cuenta nueva (p. ej. `laurabravo`) o
// para re-sembrar tras un lockout que YA se enfrió.
//
// Uso:  DISPLAY=:99 npx tsx packages/scrapers/src/seed-sprl-slot.ts [índice]
//   índice: 1 (default) | 2 | 3 → usa SPRL_USER[_N]/SPRL_PASS[_N] de /root/placape.env.
//   ⚠ No siembres un slot cuyo puerto esté EN USO por el motor (p. ej. slot1/:9224 con historial
//     corriendo): correría dos Chrome sobre el mismo perfil. El slot de reserva (slot2) suele estar libre.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { findChrome, chromeFlags } from './operator/chrome-path.js';
import { sprlSlots } from './operator/sprl-slots.js';
import { sprlLogin, sprlIsLogged } from './operator/sprl-login.js';
import { peruStamp } from './operator/time.js';

// Carga secretos del VPS desde /root/placape.env (igual que operator-server / keep-alive) ANTES de
// leer los slots: pm2/tsx no traen esas variables. El archivo GANA sobre el entorno.
(function loadEnvFile() {
  const f = process.env.OPERATOR_ENV_FILE ?? '/root/placape.env';
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m || !m[1]) continue;
      let v = m[2] ?? '';
      if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '');
      process.env[m[1]] = v.trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* sin archivo (dev/Windows) → no-op */ }
})();

const INGRESO = 'https://sprl.sunarp.gob.pe/sprl/ingreso';
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

(async () => {
  const idx = Math.max(1, Number(process.argv[2] ?? 1));
  const slot = sprlSlots().find((s) => s.index === idx);
  if (!slot) { console.error(`No hay slot ${idx} configurado (¿faltan SPRL_USER_${idx}/SPRL_PASS_${idx}?).`); process.exit(1); }
  if (!slot.user || !slot.pass) { console.error(`Slot ${idx} sin credenciales en el entorno.`); process.exit(1); }
  const chrome = findChrome();
  if (!chrome) { console.error('No encontré chrome.exe.'); process.exit(1); }
  const log = (m: string): void => console.log(`${peruStamp()} seed slot${idx}: ${m}`);

  log(`abriendo Chrome :${slot.port} (perfil ${slot.profile})…`);
  const proc = spawn(chrome, [`--remote-debugging-port=${slot.port}`, `--user-data-dir=${slot.profile}`, ...chromeFlags(), INGRESO], { detached: false, stdio: 'ignore' });
  let browser: Browser | null = null;
  let code = 3;
  try {
    for (let i = 0; i < 25 && !browser; i++) { await wait(700); try { browser = await chromium.connectOverCDP(`http://localhost:${slot.port}`); } catch { /* retry */ } }
    if (!browser) { console.error('no conecté al Chrome (CDP).'); process.exit(1); }
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    if (await sprlIsLogged(page)) { log('ya estaba logueado → sesión OK (nada que sembrar).'); code = 0; }
    else {
      const r = await sprlLogin(page, ctx, { user: slot.user, pass: slot.pass, log });
      if (r.ok) { log('✅ login OK → sesión sembrada. El keep-alive la mantendrá viva.'); code = 0; }
      else if (r.locked) { console.error('⚠ SUNARP bloqueó la IP (exceso de intentos). Esperá ~1-2 h con la IP fría y reintentá.'); code = 2; }
      else { console.error('login falló (revisá credenciales, o el Turnstile pidió resolución manual).'); code = 3; }
    }
  } finally {
    // Cierra el Chrome: la sesión queda PERSISTIDA en el perfil (localStorage+cookies en disco) →
    // el keep-alive la retoma en su próximo ciclo.
    if (browser) await browser.close().catch(() => {});
    try { proc.kill(); } catch { /* */ }
  }
  process.exit(code);
})();
