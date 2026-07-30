/* eslint-disable no-console */
// PROBE: ATU con su CADENA de egresos (directo → túnel ENGINE_PROXY → proxy explícito) — correr EN EL VPS.
//  1. Muestra la cadena de egresos que resolvió del env.
//  2. Corre la consulta ATU real por CDP en un Chrome de PRUEBA (:9229, perfil aparte → no toca el
//     Chrome de producción de :9226 ni su reputación). El fallback entre egresos es AUTOMÁTICO.
//  3. Lee la IP DE SALIDA del mismo Chrome (ipify) → muestra por dónde salió el egreso ganador.
//
// Uso:  DISPLAY=:99 npx tsx packages/scrapers/src/probe-atu-proxy.ts [PLACA]
// Limpieza al final:  pkill -f "remote-debugging-port=9229"
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
// (atuEgressChain / scrapeAtuViaCdp leen process.env AL USARSE — después de cargar placape.env.)
import { scrapeAtuViaCdp, atuEgressChain } from './operator/atu-cdp.js';

// Carga secretos del VPS desde /root/placape.env (igual que operator-server) ANTES de importar nada
// que lea el entorno: pm2/tsx no traen ENGINE_PROXY. El archivo GANA sobre el entorno.
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

const PORT = 9229; // puerto de PRUEBA: fuera de la lista de killEngineChrome y del :9226 de producción
const PROFILE = `${process.cwd()}/.cdp-atu-probe`;

(async () => {
  const plate = (process.argv[2] ?? 'CHK256').toUpperCase().replace(/[^A-Z0-9]/g, '');
  console.log(`— PROBE ATU · cadena de egresos · placa ${plate} —`);
  const chain = atuEgressChain();
  console.log(`cadena: ${chain.map((e, i) => `${i + 1}) ${e.label}`).join('  →  ')}`);
  if (chain.length === 1) console.log('⚠ sin fallback de proxy: no hay ENGINE_PROXY ni ATU_PROXY en el env (solo directo)');

  const r = await scrapeAtuViaCdp(plate, {
    port: PORT, profileDir: PROFILE, shotPath: 'atu-probe.png',
    log: (m) => console.log(`  atu: ${m}`),
  });

  // IP de salida REAL del Chrome de la prueba (mismo proceso Chrome → mismo proxy del lanzamiento).
  try {
    const b = await chromium.connectOverCDP(`http://localhost:${PORT}`);
    const ctx = b.contexts()[0] ?? (await b.newContext());
    const pg = await ctx.newPage();
    await pg.goto('https://api.ipify.org?format=text', { timeout: 30000 });
    console.log(`IP de salida del Chrome ATU: ${(await pg.locator('body').innerText()).trim()} (IP del VPS = egreso directo; IP residencial = salió por el proxy)`);
    await pg.close();
    await b.close();
  } catch (e) { console.log(`(no pude leer la IP de salida: ${(e as Error).message})`); }

  console.log(`\nRESULTADO: ${r.status}${r.error ? ` · ${r.error}` : ''}`);
  if (r.data) console.log(JSON.stringify(r.data, null, 2));
  console.log(`captura: atu-probe.png · perfil de prueba: ${PROFILE}`);
  console.log(`limpieza: pkill -f "remote-debugging-port=${PORT}"`);
  process.exit(r.ok ? 0 : 1);
})();
