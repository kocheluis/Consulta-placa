/* eslint-disable no-console */
// Corre runSatImpuesto DIRECTO (browser + solver) desde esta PC — para iterar Capa B sin round-trips.
// Uso: npx tsx packages/scrapers/src/probe-run-impuesto.ts CHU444   (lee CAPTCHA_API_KEY de .env)
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createCaptchaSolver } from './captcha/index.js';
import { runSatImpuesto } from './operator/sources.js';

for (const line of readFileSync(process.env.ENV_FILE ?? '.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && m[1] && !process.env[m[1]]) process.env[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '');
}
const plate = (process.argv[2] ?? 'CHU444').toUpperCase().replace(/[^A-Z0-9]/g, '');
const key = process.env.CAPTCHA_API_KEY ?? '';
if (!key) { console.error('sin CAPTCHA_API_KEY en .env'); process.exit(1); }
const headed = process.argv.includes('--headed');
const solver = createCaptchaSolver({ provider: process.env.CAPTCHA_PROVIDER ?? 'capsolver', apiKey: key });

const b = await chromium.launch({ headless: !headed });
try {
  const ctx = await b.newContext({ locale: 'es-PE' });
  const page = await ctx.newPage();
  const t0 = Date.now();
  console.log('runSatImpuesto · placa', plate, '· headless', !headed);
  const r = await runSatImpuesto(page, plate, solver, 'sat-impuesto-local.png');
  console.log(`\n=== RESULTADO (${Date.now() - t0}ms) ===`);
  console.log('status :', r.status);
  console.log('summary:', r.summary);
  console.log('data   :', JSON.stringify(r.data, null, 2));
} finally { await b.close(); process.exit(0); }
