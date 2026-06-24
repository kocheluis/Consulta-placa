/* eslint-disable no-console */
import { runOperatorReport, DEFAULT_SOURCES } from './operator/index.js';

/**
 * CLI del operador PlacaPe: corre todas las fuentes automatizables para una placa
 * y deja un reporte.json + screenshots por fuente.
 *
 * Uso:  npx tsx packages/scrapers/src/operator-cli.ts <PLACA> [--sunarp] [--out <dir>]
 * Requiere CAPTCHA_API_KEY (CapSolver) en el entorno.
 */
const argv = process.argv.slice(2);
const plate = (argv.find((a) => !a.startsWith('--')) ?? 'BTF268').toUpperCase();
const sunarp = argv.includes('--sunarp');
const manual = argv.includes('--manual'); // SUNARP híbrido: pasas el Turnstile a mano
const srcIdx = argv.indexOf('--sources');
const sourcesArg = srcIdx >= 0 ? (argv[srcIdx + 1] ?? '').split(',').filter(Boolean) : undefined;
const outIdx = argv.indexOf('--out');
const outDir = (outIdx >= 0 ? argv[outIdx + 1] : undefined) ?? `d:/Jose/Proyecto_Consulta_placa/validacion-fuentes/operador/${plate}`;
const key = process.env.CAPTCHA_API_KEY ?? '';
if (!key) { console.error('Falta CAPTCHA_API_KEY (CapSolver) en el entorno.'); process.exit(1); }

const ICON: Record<string, string> = { ENCONTRADO: '✓', SIN_REGISTRO: '·', ERROR: '✗', REQUIERE_DNI: '?' };
console.log(`\nGenerando reporte del operador para ${plate}${sunarp ? ' (+SUNARP CDP)' : ''}…\n`);

// Fuentes con captcha corren headless; SUNARP abre Chrome real (CDP) para el
// Turnstile pasivo. --manual da más margen si hay que resolverlo a mano.
const report = await runOperatorReport(plate, {
  outDir,
  captchaProvider: process.env.CAPTCHA_PROVIDER ?? 'capsolver',
  captchaApiKey: key,
  sources: sourcesArg ?? (sunarp ? [...DEFAULT_SOURCES, 'sunarp'] : DEFAULT_SOURCES),
  manualSunarp: manual,
});

console.log('Fuente                                   Estado        Tiempo   Resumen');
console.log('─'.repeat(100));
for (const r of report.results) {
  const lbl = r.label.padEnd(40).slice(0, 40);
  const st = `${ICON[r.status] ?? ' '} ${r.status}`.padEnd(13);
  const ms = `${(r.ms / 1000).toFixed(1)}s`.padStart(6);
  console.log(`${lbl} ${st} ${ms}   ${r.summary.slice(0, 80)}`);
}
const ok = report.results.filter((r) => r.status === 'ENCONTRADO' || r.status === 'SIN_REGISTRO').length;
console.log('─'.repeat(100));
console.log(`\n${ok}/${report.results.length} fuentes respondieron. Reporte: ${outDir}/reporte.json\n`);
process.exit(0);
