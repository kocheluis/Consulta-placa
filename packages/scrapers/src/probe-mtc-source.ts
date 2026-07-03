/* eslint-disable no-console */
// Prueba la función de PRODUCCIÓN runMtcCitv (vía runSingleSource) contra el portal nuevo.
//   VPS: set -a; . /root/placape.env; set +a; DISPLAY=:99 npx tsx packages/scrapers/src/probe-mtc-source.ts ADY067
import { runSingleSource } from './operator/index.js';

const plate = (process.argv[2] ?? 'ADY067').toUpperCase();
(async () => {
  const r = await runSingleSource(plate, 'mtc-citv', {
    outDir: `/tmp/mtc-${plate}`,
    captchaApiKey: process.env.CAPTCHA_API_KEY ?? '',
    captchaProvider: process.env.CAPTCHA_PROVIDER ?? 'capsolver',
    headless: true,
  });
  console.log('STATUS:', r.status, '·', r.ms + 'ms');
  console.log('SUMMARY:', r.summary);
  console.log('DATA:', JSON.stringify(r.data, null, 2));
  process.exit(0);
})();
