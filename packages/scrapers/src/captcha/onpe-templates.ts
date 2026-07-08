/**
 * Reconocimiento del captcha del JNE por PLANTILLAS (template matching). Como la
 * fuente es FIJA y los dígitos son solo del 0 al 8 (9 formas, sin letras, sin 9),
 * no hace falta OCR general ni una CNN: basta una plantilla "promedio" por dígito
 * y elegir, para cada posición, la de mayor parecido (similitud coseno).
 *
 * - buildTemplates(dir): a partir de captchas etiquetados (nombre = código) arma
 *   el banco de 8 plantillas normalizadas.
 * - recognize(png, bank): segmenta en 6 franjas y clasifica cada una contra el banco.
 *
 * Es puro procesamiento de imágenes (local, gratis) y se apoya en dos restricciones
 * del captcha: SIEMPRE 6 dígitos y SIEMPRE del 1 al 8.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { sliceN, DEFAULT_OPTS, type PreprocessOptions, type Glyph } from './onpe-preprocess.js';

export const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8'] as const;
export const NW = 20;
export const NH = 30;

export interface TemplateBank {
  nw: number;
  nh: number;
  opts: PreprocessOptions;
  /** por dígito: vector nw*nh de tinta promedio (0..1) */
  means: Record<string, number[]>;
  /** cuántos ejemplos promediaron cada plantilla */
  counts: Record<string, number>;
}

/** Redimensiona (vecino más cercano) un glifo binario a NW×NH. */
export function normalizeGlyph(g: Glyph, nw = NW, nh = NH): Float32Array {
  const out = new Float32Array(nw * nh);
  if (g.w <= 0 || g.h <= 0) return out;
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(g.h - 1, Math.floor((y * g.h) / nh));
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(g.w - 1, Math.floor((x * g.w) / nw));
      out[y * nw + x] = g.bin[sy * g.w + sx] ? 1 : 0;
    }
  }
  return out;
}

/** Similitud coseno entre un glifo (0/1) y una plantilla promedio (0..1). */
export function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

interface Labeled {
  truth: string;
  buf: Buffer;
  file: string;
}

export function loadLabeled(dir: string): Labeled[] {
  const out: Labeled[] = [];
  for (const f of readdirSync(dir).filter((f) => /\.png$/i.test(f))) {
    const m = basename(f).match(/([0-8]{6})/); // 6 dígitos del 0 al 8
    if (!m) continue;
    out.push({ truth: m[1], buf: readFileSync(join(dir, f)), file: f });
  }
  return out;
}

/** Construye el banco de plantillas a partir de una lista de captchas etiquetados. */
export function buildTemplatesFrom(samples: Labeled[], opts: PreprocessOptions = DEFAULT_OPTS): TemplateBank {
  const sums: Record<string, Float32Array> = {};
  const counts: Record<string, number> = {};
  for (const d of DIGITS) {
    sums[d] = new Float32Array(NW * NH);
    counts[d] = 0;
  }
  for (const s of samples) {
    const glyphs = sliceN(s.buf, opts, 6);
    if (glyphs.length !== 6) continue;
    for (let i = 0; i < 6; i++) {
      const d = s.truth[i];
      if (!sums[d]) continue;
      const v = normalizeGlyph(glyphs[i]);
      for (let k = 0; k < v.length; k++) sums[d][k] += v[k];
      counts[d]++;
    }
  }
  const means: Record<string, number[]> = {};
  for (const d of DIGITS) {
    const c = counts[d] || 1;
    means[d] = Array.from(sums[d], (v) => v / c);
  }
  return { nw: NW, nh: NH, opts, means, counts };
}

export function buildTemplates(dir: string, opts: PreprocessOptions = DEFAULT_OPTS): TemplateBank {
  return buildTemplatesFrom(loadLabeled(dir), opts);
}

export interface RecognizeResult {
  code: string;
  /** por posición: dígito y su score de similitud */
  per: Array<{ digit: string; score: number }>;
  /** score promedio (confianza) */
  confidence: number;
}

/** Clasifica un captcha contra el banco de plantillas. */
export function recognize(pngBuffer: Buffer, bank: TemplateBank): RecognizeResult {
  const glyphs = sliceN(pngBuffer, bank.opts, 6);
  const per: RecognizeResult['per'] = [];
  for (let i = 0; i < 6; i++) {
    const g = glyphs[i];
    if (!g || g.area === 0) {
      per.push({ digit: '?', score: 0 });
      continue;
    }
    const v = normalizeGlyph(g, bank.nw, bank.nh);
    let best = { digit: '?', score: -1 };
    for (const d of DIGITS) {
      const s = cosine(v, bank.means[d]);
      if (s > best.score) best = { digit: d, score: s };
    }
    per.push(best);
  }
  const code = per.map((p) => p.digit).join('');
  const confidence = per.reduce((a, p) => a + p.score, 0) / (per.length || 1);
  return { code, per, confidence };
}

export function saveBank(bank: TemplateBank, path: string): void {
  writeFileSync(path, JSON.stringify(bank));
}

export function loadBank(path: string): TemplateBank {
  return JSON.parse(readFileSync(path, 'utf8')) as TemplateBank;
}
