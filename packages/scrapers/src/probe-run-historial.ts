/* eslint-disable no-console */
// Corre runHistorialRegistral DIRECTO (mismo path que el motor: spawn SPRL :9224 + connect + login +
// Síguelo) desde esta PC — para diagnosticar el "no conecté al Chrome SPRL" sin round-trips al VPS.
// Uso: npx tsx packages/scrapers/src/probe-run-historial.ts CKJ663   (lee creds de .env)
import { readFileSync } from 'node:fs';
import { runHistorialRegistral } from './operator/historial.js';

for (const line of readFileSync(process.env.ENV_FILE ?? '.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && m[1] && !process.env[m[1]]) process.env[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '');
}
const plate = (process.argv[2] ?? 'CKJ663').toUpperCase().replace(/[^A-Z0-9]/g, '');
console.log(`runHistorialRegistral · placa ${plate} · SPRL_USER=${process.env.SPRL_USER ? 'set' : 'MISSING'} · CDP_SPRL_PORT=${process.env.CDP_SPRL_PORT ?? 9224}`);

const t0 = Date.now();
const stamp = () => `+${Math.round((Date.now() - t0) / 1000)}s`;
const r = await runHistorialRegistral(plate, { log: (m) => console.log(`  [${stamp()}] ${m}`) });
console.log(`\n=== RESULTADO (${Date.now() - t0}ms) ===`);
console.log('ok      :', r.ok);
console.log('error   :', r.error ?? '(ninguno)');
console.log('sede    :', r.sede);
console.log('titulos :', r.titulos.length, r.titulos.slice(0, 8).join(', '));
console.log('timeline:', r.timeline.length, 'asientos');
console.log('flags   :', JSON.stringify(r.flags));
process.exit(0);
