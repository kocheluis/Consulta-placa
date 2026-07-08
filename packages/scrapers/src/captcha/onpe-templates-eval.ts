/* eslint-disable no-console */
/**
 * Evalúa el reconocedor por plantillas (onpe-templates) sobre un directorio de
 * captchas etiquetados (nombre = código de 6 dígitos, 0–8). Usa validación
 * leave-one-out: para cada captcha, arma las plantillas con TODOS los demás y lo
 * reconoce; así mide precisión sin "hacer trampa". Vuelca las plantillas promedio
 * como PNG para inspección.
 *
 *   npx tsx packages/scrapers/src/captcha/onpe-templates-eval.ts [dir]
 *   (por defecto dir = validacion-fuentes/onpe-captchas)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { binToPng } from './onpe-preprocess.js';
import { loadLabeled, buildTemplatesFrom, recognize, DIGITS, NW, NH, type TemplateBank } from './onpe-templates.js';

const DIR = process.argv[2] ?? 'validacion-fuentes/onpe-captchas';

function dumpTemplates(bank: TemplateBank, dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const d of DIGITS) {
    const mean = bank.means[d];
    const bin = new Uint8Array(bank.nw * bank.nh);
    for (let i = 0; i < bin.length; i++) bin[i] = mean[i] >= 0.5 ? 1 : 0;
    writeFileSync(join(dir, `tpl-${d}.png`), binToPng(bin, bank.nw, bank.nh));
  }
}

(async () => {
  const samples = loadLabeled(DIR);
  if (samples.length === 0) {
    console.log(`No hay captchas etiquetados (nombre = código 0–8, p. ej. 045662.png) en ${DIR}.`);
    process.exit(0);
  }
  console.log(`Set: ${samples.length} captchas etiquetados en ${DIR}`);

  // Banco completo (para inspección de plantillas + cobertura por dígito).
  const full = buildTemplatesFrom(samples);
  console.log('Ejemplos por dígito:', DIGITS.map((d) => `${d}:${full.counts[d]}`).join('  '));
  const missing = DIGITS.filter((d) => (full.counts[d] || 0) === 0);
  if (missing.length) console.log(`⚠️ sin ejemplos para: ${missing.join(', ')} (esos dígitos no se podrán reconocer)`);
  dumpTemplates(full, join(DIR, '_templates'));

  // Leave-one-out.
  let exact = 0;
  let digOk = 0;
  let digTot = 0;
  const conf: Record<string, Record<string, number>> = {};
  const rows: string[] = [];
  for (let i = 0; i < samples.length; i++) {
    const held = samples[i];
    const bank = buildTemplatesFrom(samples.filter((_, j) => j !== i));
    const r = recognize(held.buf, bank);
    const ok = r.code === held.truth;
    if (ok) exact++;
    for (let k = 0; k < 6; k++) {
      digTot++;
      const t = held.truth[k];
      const p = r.code[k] ?? '?';
      if (t === p) digOk++;
      (conf[t] ??= {})[p] = ((conf[t] ??= {})[p] ?? 0) + 1;
    }
    rows.push(`  ${ok ? '✓' : '✗'} ${held.truth} → ${r.code}  (conf ${r.confidence.toFixed(2)})  ${held.file}`);
  }
  console.log('\n' + rows.join('\n'));
  console.log(
    `\n== LEAVE-ONE-OUT ==  captchas exactos: ${exact}/${samples.length} ` +
      `(${((exact / samples.length) * 100).toFixed(0)}%)  ·  dígitos: ${digOk}/${digTot} (${((digOk / digTot) * 100).toFixed(0)}%)`,
  );
  // Errores por dígito (solo filas con confusión).
  console.log('\nConfusiones (verdad → lecturas):');
  for (const t of DIGITS) {
    const row = conf[t];
    if (!row) continue;
    const parts = Object.entries(row).sort((a, b) => b[1] - a[1]);
    const wrong = parts.filter(([p]) => p !== t);
    if (wrong.length) console.log(`  ${t}: ${parts.map(([p, n]) => `${p}×${n}`).join(' ')}`);
  }
  console.log(`\nPlantillas promedio en ${join(DIR, '_templates')} (tpl-0.png … tpl-8.png)`);
})();
