/**
 * Preprocesamiento del CAPTCHA del JNE (multas.jne.gob.pe) para OCR local.
 *
 * El captcha son 6 dígitos azules sobre fondo claro, ahogados en ruido "sal y
 * pimienta" del MISMO azul (puntitos dispersos, densos en los bordes izq/der) y
 * cruzados por una línea fina ondulada. Como el ruido y los dígitos comparten
 * color, NO se pueden separar por color: el discriminante es el TAMAÑO de blob.
 *
 * Pipeline:
 *   1. Decodifica PNG → luminancia.
 *   2. Umbral (Otsu) → binario (1 = tinta).
 *   3. Filtro de mediana 3×3 → mata píxeles sueltos (la "pimienta").
 *   4. Componentes conexas (8-conex): descarta blobs por área/alto/relación de
 *      aspecto → mata los puntitos y la línea fina (ancha y baja).
 *   5. Recorta al contenido y escala ×N (Tesseract rinde mejor con imágenes grandes).
 *
 * Todos los umbrales son parametrizables para poder afinarlos contra el set
 * etiquetado (ver onpe-ocr-eval.ts).
 */
import { PNG } from 'pngjs';

export interface PreprocessOptions {
  /** Umbral fijo 0–255 sobre luminancia; si es null, usa Otsu. */
  threshold: number | null;
  /** Aplicar filtro de mediana 3×3 antes de componentes conexas. */
  median: boolean;
  /** Radio del CIERRE morfológico (dilatar→erosionar) previo a componentes. Une los
   *  puntitos de los dígitos "punteados" en trazos sólidos. 0 = desactivado. */
  close: number;
  /** Radio de la APERTURA morfológica (erosionar→dilatar) sobre la máscara final.
   *  Lima la pelusa adherida a los dígitos. 0 = desactivado. */
  open: number;
  /** Área mínima (px) para conservar un blob. Mata la sal fina. */
  minArea: number;
  /** Alto mínimo del blob como fracción del alto de la imagen. Mata la línea fina. */
  minHeightFrac: number;
  /** Relación ancho/alto máxima; por encima se considera línea horizontal y se descarta. */
  maxAspect: number;
  /** Densidad mínima área/(ancho·alto) del blob. Los cúmulos de ruido son ralos; los
   *  dígitos, densos. Descarta cúmulos de sal que sobreviven por tamaño. */
  minFill: number;
  /** Factor de escalado de la imagen limpia (nearest). */
  scale: number;
  /** Margen blanco (px, en escala final) alrededor del contenido. */
  pad: number;
}

export const DEFAULT_OPTS: PreprocessOptions = {
  threshold: null,
  median: false, // el filtro de componentes ya mata la sal; la mediana erosiona trazos finos
  close: 1, // dígitos punteados → sólidos
  open: 0,
  minArea: 30,
  minHeightFrac: 0.32,
  maxAspect: 8,
  minFill: 0.18,
  scale: 3,
  pad: 12,
};

export interface Gray {
  w: number;
  h: number;
  /** luminancia 0–255, longitud w*h */
  lum: Uint8Array;
}

export function decodeToGray(pngBuffer: Buffer): Gray {
  const png = PNG.sync.read(pngBuffer);
  const { width: w, height: h, data } = png;
  const lum = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    // Luminancia perceptual. Los dígitos/ruido azules quedan oscuros; el fondo, claro.
    lum[i] = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
  }
  return { w, h, lum };
}

/** Umbral de Otsu sobre un histograma de luminancia. */
export function otsu(lum: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (const v of lum) hist[v]++;
  const total = lum.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

/** Devuelve binario (1 = tinta/oscuro) aplicando umbral. */
function binarize(g: Gray, threshold: number): Uint8Array {
  const bin = new Uint8Array(g.w * g.h);
  for (let i = 0; i < g.lum.length; i++) bin[i] = g.lum[i] <= threshold ? 1 : 0;
  return bin;
}

/** Filtro de mediana 3×3 sobre binario → elimina píxeles aislados. */
function median3(bin: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          s += bin[ny * w + nx];
        }
      }
      out[y * w + x] = s >= 5 ? 1 : 0; // mayoría de 9 (bordes cuentan menos → tiende a limpiar)
    }
  }
  return out;
}

/** Dilatación binaria con elemento estructurante cuadrado de radio r. */
function dilate(bin: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dy = -r; dy <= r && !on; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (bin[ny * w + nx]) {
            on = 1;
            break;
          }
        }
      }
      out[y * w + x] = on;
    }
  }
  return out;
}

/** Erosión binaria con elemento estructurante cuadrado de radio r. */
function erode(bin: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let all = 1;
      for (let dy = -r; dy <= r && all; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !bin[ny * w + nx]) {
            all = 0;
            break;
          }
        }
      }
      out[y * w + x] = all;
    }
  }
  return out;
}

const close = (b: Uint8Array, w: number, h: number, r: number) => erode(dilate(b, w, h, r), w, h, r);
const open = (b: Uint8Array, w: number, h: number, r: number) => dilate(erode(b, w, h, r), w, h, r);

interface Comp {
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixels: number[];
}

/** Etiquetado de componentes conexas (8-conex) por BFS iterativo. */
function components(bin: Uint8Array, w: number, h: number): Comp[] {
  const seen = new Uint8Array(w * h);
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let start = 0; start < bin.length; start++) {
    if (bin[start] === 0 || seen[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    const c: Comp = { area: 0, minX: w, minY: h, maxX: 0, maxY: 0, pixels: [] };
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p / w) | 0;
      c.area++;
      c.pixels.push(p);
      if (x < c.minX) c.minX = x;
      if (y < c.minY) c.minY = y;
      if (x > c.maxX) c.maxX = x;
      if (y > c.maxY) c.maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const np = ny * w + nx;
          if (bin[np] && !seen[np]) {
            seen[np] = 1;
            stack.push(np);
          }
        }
      }
    }
    comps.push(c);
  }
  return comps;
}

export interface CleanResult {
  /** binario limpio (1 = tinta) ya recortado y escalado */
  bin: Uint8Array;
  w: number;
  h: number;
  /** cuántos blobs sobrevivieron al filtrado (idealmente ≈ 6) */
  kept: number;
}

/** Ejecuta el pipeline completo y devuelve el binario limpio, recortado y escalado. */
export function clean(pngBuffer: Buffer, opts: PreprocessOptions = DEFAULT_OPTS): CleanResult {
  const g = decodeToGray(pngBuffer);
  const thr = opts.threshold ?? otsu(g.lum);
  let bin = binarize(g, thr);
  if (opts.median) bin = median3(bin, g.w, g.h);

  // Componentes sobre el binario CRUDO: el ruido sigue siendo diminuto y se filtra
  // por tamaño. (El cierre se aplica DESPUÉS, solo a la máscara de dígitos, para no
  // reinflar la sal.)
  const comps = components(bin, g.w, g.h);
  const minH = Math.max(1, Math.round(opts.minHeightFrac * g.h));
  const keep = comps.filter((c) => {
    const cw = c.maxX - c.minX + 1;
    const ch = c.maxY - c.minY + 1;
    if (c.area < opts.minArea) return false; // sal fina
    if (ch < minH) return false; // línea fina / manchitas bajas
    if (c.area / (cw * ch) < opts.minFill) return false; // cúmulo de ruido ralo
    // Línea horizontal SOLO si además es baja: un blob ancho pero alto es dígitos
    // unidos por la línea (hay que conservarlo), no la línea suelta.
    if (cw / ch > opts.maxAspect && ch < 0.5 * g.h) return false;
    return true;
  });

  // Lienzo limpio con solo los blobs conservados.
  let mask = new Uint8Array(g.w * g.h);
  let minX = g.w;
  let minY = g.h;
  let maxX = 0;
  let maxY = 0;
  for (const c of keep) {
    for (const p of c.pixels) mask[p] = 1;
    if (c.minX < minX) minX = c.minX;
    if (c.minY < minY) minY = c.minY;
    if (c.maxX > maxX) maxX = c.maxX;
    if (c.maxY > maxY) maxY = c.maxY;
  }
  if (keep.length === 0) {
    minX = 0;
    minY = 0;
    maxX = g.w - 1;
    maxY = g.h - 1;
  }
  if (opts.close > 0) mask = close(mask, g.w, g.h, opts.close); // solidifica dígitos punteados
  if (opts.open > 0) mask = open(mask, g.w, g.h, opts.open); // lima la pelusa adherida

  // Recorte al contenido + escalado (nearest) + margen.
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const s = Math.max(1, Math.round(opts.scale));
  const pad = Math.max(0, opts.pad);
  const outW = cw * s + pad * 2;
  const outH = ch * s + pad * 2;
  const out = new Uint8Array(outW * outH);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (!mask[(minY + y) * g.w + (minX + x)]) continue;
      for (let sy = 0; sy < s; sy++) {
        for (let sx = 0; sx < s; sx++) {
          const oy = pad + y * s + sy;
          const ox = pad + x * s + sx;
          out[oy * outW + ox] = 1;
        }
      }
    }
  }
  return { bin: out, w: outW, h: outH, kept: keep.length };
}

export interface Glyph {
  bin: Uint8Array;
  w: number;
  h: number;
  /** posición x del blob en la imagen original (para ordenar izq→der) */
  minX: number;
  area: number;
}

/**
 * Segmenta el captcha en glifos individuales (un blob = un dígito), ordenados de
 * izquierda a derecha. Reconocer cada dígito por separado (PSM SINGLE_CHAR o un
 * clasificador de plantillas) es mucho más fiable que leer la línea entera
 * "apelmazada". Cada glifo viene recortado a su caja y con el cierre aplicado.
 */
export function segment(pngBuffer: Buffer, opts: PreprocessOptions = DEFAULT_OPTS): Glyph[] {
  const g = decodeToGray(pngBuffer);
  const thr = opts.threshold ?? otsu(g.lum);
  let bin = binarize(g, thr);
  if (opts.median) bin = median3(bin, g.w, g.h);
  const comps = components(bin, g.w, g.h);
  const minH = Math.max(1, Math.round(opts.minHeightFrac * g.h));
  const keep = comps
    .filter((c) => {
      const cw = c.maxX - c.minX + 1;
      const ch = c.maxY - c.minY + 1;
      if (c.area < opts.minArea) return false;
      if (ch < minH) return false;
      if (c.area / (cw * ch) < opts.minFill) return false;
      if (cw / ch > opts.maxAspect && ch < 0.5 * g.h) return false;
      return true;
    })
    .sort((a, b) => a.minX - b.minX);
  return keep.map((c) => {
    const cw = c.maxX - c.minX + 1;
    const ch = c.maxY - c.minY + 1;
    let m = new Uint8Array(cw * ch);
    for (const p of c.pixels) {
      const x = (p % g.w) - c.minX;
      const y = ((p / g.w) | 0) - c.minY;
      m[y * cw + x] = 1;
    }
    if (opts.close > 0) m = close(m, cw, ch, opts.close);
    return { bin: m, w: cw, h: ch, minX: c.minX, area: c.area };
  });
}

/**
 * Corta el captcha en N franjas verticales iguales (por defecto 6 = dígitos del
 * JNE) sobre la banda de tinta detectada. A diferencia de segment(), SIEMPRE
 * devuelve N glifos: no depende de que cada dígito sea un blob separado (se tocan
 * y se parten). Cada franja se recorta a su tinta. Ideal para alimentar/entrenar
 * un clasificador de plantillas por posición.
 */
export function sliceN(pngBuffer: Buffer, opts: PreprocessOptions = DEFAULT_OPTS, n = 6): Glyph[] {
  const g = decodeToGray(pngBuffer);
  const thr = opts.threshold ?? otsu(g.lum);
  let bin = binarize(g, thr);
  if (opts.median) bin = median3(bin, g.w, g.h);
  const comps = components(bin, g.w, g.h);
  const minH = Math.max(1, Math.round(opts.minHeightFrac * g.h));
  const keep = comps.filter((c) => {
    const cw = c.maxX - c.minX + 1;
    const ch = c.maxY - c.minY + 1;
    if (c.area < opts.minArea) return false;
    if (ch < minH) return false;
    if (c.area / (cw * ch) < opts.minFill) return false;
    if (cw / ch > opts.maxAspect && ch < 0.5 * g.h) return false;
    return true;
  });
  let mask = new Uint8Array(g.w * g.h);
  for (const c of keep) for (const p of c.pixels) mask[p] = 1;
  if (opts.close > 0) mask = close(mask, g.w, g.h, opts.close);

  // Perfil de densidad por columna → recorta bordes de baja densidad (ruido residual).
  const col = new Int32Array(g.w);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (mask[y * g.w + x]) col[x]++;
  const maxc = col.reduce((m, v) => (v > m ? v : m), 0);
  if (maxc === 0) return [];
  const t = Math.max(1, maxc * 0.08);
  let x0 = 0;
  while (x0 < g.w && col[x0] < t) x0++;
  let x1 = g.w - 1;
  while (x1 > x0 && col[x1] < t) x1--;
  const bandW = x1 - x0 + 1;
  if (bandW < n) return [];

  const glyphs: Glyph[] = [];
  for (let i = 0; i < n; i++) {
    const sx = x0 + Math.floor((i * bandW) / n);
    const ex = x0 + Math.floor(((i + 1) * bandW) / n) - 1;
    let mnx = ex;
    let mxx = sx;
    let mny = g.h;
    let mxy = 0;
    let area = 0;
    for (let y = 0; y < g.h; y++) {
      for (let x = sx; x <= ex; x++) {
        if (!mask[y * g.w + x]) continue;
        area++;
        if (x < mnx) mnx = x;
        if (x > mxx) mxx = x;
        if (y < mny) mny = y;
        if (y > mxy) mxy = y;
      }
    }
    if (area === 0) {
      glyphs.push({ bin: new Uint8Array(1), w: 1, h: 1, minX: sx, area: 0 });
      continue;
    }
    const cw = mxx - mnx + 1;
    const ch = mxy - mny + 1;
    const m = new Uint8Array(cw * ch);
    for (let y = mny; y <= mxy; y++)
      for (let x = mnx; x <= mxx; x++) if (mask[y * g.w + x]) m[(y - mny) * cw + (x - mnx)] = 1;
    glyphs.push({ bin: m, w: cw, h: ch, minX: mnx, area });
  }
  return glyphs;
}

/** Escala (nearest) un binario y le añade margen blanco. */
export function scalePad(bin: Uint8Array, w: number, h: number, scale: number, pad: number): CleanResult {
  const s = Math.max(1, Math.round(scale));
  const p = Math.max(0, pad);
  const outW = w * s + p * 2;
  const outH = h * s + p * 2;
  const out = new Uint8Array(outW * outH);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bin[y * w + x]) continue;
      for (let sy = 0; sy < s; sy++)
        for (let sx = 0; sx < s; sx++) out[(p + y * s + sy) * outW + (p + x * s + sx)] = 1;
    }
  }
  return { bin: out, w: outW, h: outH, kept: 1 };
}

/** Convierte un binario limpio a PNG (tinta negra sobre blanco) para Tesseract / inspección. */
export function binToPng(bin: Uint8Array, w: number, h: number): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    const v = bin[i] ? 0 : 255; // 1 → negro, 0 → blanco
    png.data[i * 4] = v;
    png.data[i * 4 + 1] = v;
    png.data[i * 4 + 2] = v;
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}
