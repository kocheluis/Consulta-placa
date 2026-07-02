/* eslint-disable no-console */
// Probe del módulo ATU-CDP real: valida que ATU pasa el reCAPTCHA v3 NATIVO desde ESTA IP
// (Chrome real por CDP, sin CapSolver). Corre esto en la PC del operador (IP residencial):
//   npx tsx packages/scrapers/src/probe-atu-cdp.ts BMZ084
// Interpreta el resultado:
//   ok=true  status=ENCONTRADO   → habilitado como taxi/transporte (v3 pasó) ✅
//   ok=true  status=SIN_REGISTRO → no figura como transporte (v3 pasó igual) ✅
//   ok=false status=ERROR "reCAPTCHA v3 rechazado" → score bajo (IP no residencial / proxy) ❌
import { scrapeAtuViaCdp } from './operator/atu-cdp.js';

const plate = (process.argv[2] ?? 'BMZ084').toUpperCase();

(async () => {
  console.log(`ATU-CDP (Chrome real, reCAPTCHA v3 nativo) → ${plate}…`);
  const r = await scrapeAtuViaCdp(plate, { shotPath: `atu-${plate}.png`, log: (m) => console.log('  ·', m) });
  console.log('---- RESULTADO ----');
  console.log('ok=', r.ok, '| status=', r.status, r.error ? `| error=${r.error}` : '');
  if (r.data) console.log('data:', JSON.stringify(r.data, null, 2));
  console.log(`screenshot: atu-${plate}.png`);
  process.exit(0);
})();
