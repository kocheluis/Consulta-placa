/* eslint-disable no-console */
/**
 * Banco de pruebas del OCR del captcha del JNE. Lee un directorio de PNGs cuyo
 * nombre contiene el código real (p. ej. 123488.png, o cap03_123488.png) y mide
 * la precisión del pipeline (onpe-preprocess + Tesseract). Vuelca las imágenes
 * limpias en <dir>/_clean/ para inspección visual.
 *
 *   npx tsx packages/scrapers/src/captcha/onpe-ocr-eval.ts [dir] [sweep]
 *   (por defecto dir = validacion-fuentes/onpe-captchas)
 *
 * Con "sweep" barre una rejilla de parámetros y reporta el mejor combo.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { clean, binToPng, DEFAULT_OPTS, type PreprocessOptions } from './onpe-preprocess.js';

const DIR = process.argv[2] ?? 'validacion-fuentes/onpe-captchas';
const SWEEP = (process.argv[3] ?? '') === 'sweep';
const CLEAN_DIR = join(DIR, '_clean');

const PSM_MODES: Array<{ label: string; mode: PSM }> = [
  { label: 'WORD', mode: PSM.SINGLE_WORD },
  { label: 'LINE', mode: PSM.SINGLE_LINE },
  { label: 'RAW', mode: PSM.RAW_LINE },
];

interface Sample {
  file: string;
  truth: string;
  buf: Buffer;
}

function loadSamples(): Sample[] {
  const files = readdirSync(DIR).filter((f) => /\.png$/i.test(f));
  const out: Sample[] = [];
  for (const f of files) {
    const m = basename(f).match(/(\d{6})/); // primer bloque de 6 dígitos = verdad
    if (!m) continue;
    out.push({ file: f, truth: m[1], buf: readFileSync(join(DIR, f)) });
  }
  return out;
}

async function recognize(worker: Worker, buf: Buffer, opts: PreprocessOptions) {
  const cleaned = clean(buf, opts);
  const png = binToPng(cleaned.bin, cleaned.w, cleaned.h);
  const cands: Array<{ digits: string; conf: number }> = [];
  for (const { mode } of PSM_MODES) {
    await worker.setParameters({ tessedit_pageseg_mode: mode });
    const { data } = await worker.recognize(png);
    cands.push({ digits: (data.text ?? '').replace(/\D/g, ''), conf: data.confidence ?? 0 });
  }
  const six = cands.filter((c) => c.digits.length === 6).sort((a, b) => b.conf - a.conf);
  const best = six[0] ?? [...cands].sort((a, b) => b.digits.length - a.digits.length || b.conf - a.conf)[0];
  return { code: best?.digits ?? '', kept: cleaned.kept, cleanedPng: png };
}

function digitAcc(truth: string, pred: string): number {
  if (pred.length !== 6) return 0;
  let ok = 0;
  for (let i = 0; i < 6; i++) if (truth[i] === pred[i]) ok++;
  return ok;
}

async function evalOpts(worker: Worker, samples: Sample[], opts: PreprocessOptions, dump: boolean) {
  let exact = 0;
  let digits = 0;
  let sixCount = 0;
  const rows: string[] = [];
  for (const s of samples) {
    const r = await recognize(worker, s.buf, opts);
    const isExact = r.code === s.truth;
    if (isExact) exact++;
    if (r.code.length === 6) sixCount++;
    digits += digitAcc(s.truth, r.code);
    rows.push(
      `  ${isExact ? '✓' : '✗'} ${s.truth} → ${r.code.padEnd(6) || '(vacío)'}  [blobs:${r.kept}]  ${s.file}`,
    );
    if (dump) writeFileSync(join(CLEAN_DIR, `${s.truth}__pred-${r.code || 'x'}.png`), r.cleanedPng);
  }
  return {
    exact,
    total: samples.length,
    digitPct: (digits / (samples.length * 6)) * 100,
    sixCount,
    rows,
  };
}

(async () => {
  const samples = loadSamples();
  if (samples.length === 0) {
    console.log(`No hay PNGs etiquetados en ${DIR}.`);
    console.log('Guarda los captchas con su código como nombre (p. ej. 123488.png) y reintenta.');
    process.exit(0);
  }
  mkdirSync(CLEAN_DIR, { recursive: true });
  console.log(`Set: ${samples.length} captchas etiquetados en ${DIR}\n`);

  const worker = await createWorker('eng');
  await worker.setParameters({ tessedit_char_whitelist: '0123456789' });

  try {
    if (!SWEEP) {
      const r = await evalOpts(worker, samples, DEFAULT_OPTS, true);
      console.log(r.rows.join('\n'));
      console.log(
        `\n== DEFAULT ==  exactos: ${r.exact}/${r.total} (${((r.exact / r.total) * 100).toFixed(0)}%)  ` +
          `· dígitos: ${r.digitPct.toFixed(0)}%  · dieron 6 díg: ${r.sixCount}/${r.total}`,
      );
      console.log(`Imágenes limpias en ${CLEAN_DIR}`);
      return;
    }

    // Barrido de parámetros
    const grid: PreprocessOptions[] = [];
    for (const median of [true, false]) {
      for (const minArea of [8, 14, 22]) {
        for (const minHeightFrac of [0.26, 0.32, 0.4]) {
          grid.push({ ...DEFAULT_OPTS, median, minArea, minHeightFrac });
        }
      }
    }
    let best: { opts: PreprocessOptions; exact: number; digitPct: number } | null = null;
    for (const opts of grid) {
      const r = await evalOpts(worker, samples, opts, false);
      const tag = `median=${opts.median} minArea=${opts.minArea} minH=${opts.minHeightFrac}`;
      console.log(`  ${tag} → exactos ${r.exact}/${r.total}, dígitos ${r.digitPct.toFixed(0)}%`);
      if (!best || r.exact > best.exact || (r.exact === best.exact && r.digitPct > best.digitPct)) {
        best = { opts, exact: r.exact, digitPct: r.digitPct };
      }
    }
    console.log(`\n== MEJOR ==  exactos ${best!.exact}/${samples.length}, dígitos ${best!.digitPct.toFixed(0)}%`);
    console.log('  opts:', JSON.stringify(best!.opts));
    // Vuelca imágenes limpias del mejor combo.
    await evalOpts(worker, samples, best!.opts, true);
    console.log(`Imágenes limpias (mejor combo) en ${CLEAN_DIR}`);
  } finally {
    await worker.terminate().catch(() => {});
  }
})();
