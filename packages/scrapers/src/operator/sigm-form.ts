/**
 * FORMULARIOS DEL SIGM (Detalle de una garantía mobiliaria) — lógica PURA sobre el texto del PDF.
 *
 * El "Detalle" del folio devuelve el PDF del último formulario (Constitución / Modificación / Inicio de
 * ejecución…). pdfjs entrega los textos SIN orden de lectura (y la página suele venir ROTADA), así que
 * las etiquetas y sus valores no salen juntos. Se emparejan por GEOMETRÍA: el valor de una etiqueta es
 * el texto más cercano en SU dirección de lectura, sobre la misma línea. Funciona rotado o no.
 *
 * Ley 29733: NO se extrae nada de PARTICIPANTES-DEUDOR / CÓNYUGE ni de "quien generó el formulario"
 * (personas naturales). El ACREEDOR sí (es la entidad financiera; si fuera persona natural, el
 * transform del reporte lo enmascara).
 */

export interface PdfItem {
  page: number;
  str: string;
  /** Origen del texto (transform[4], transform[5]). */
  x: number;
  y: number;
  /** Dirección de lectura (transform[0], transform[1]); (1,0) = horizontal normal. */
  dx: number;
  dy: number;
}

export interface SigmBien {
  marca: string | null;
  modelo: string | null;
  motor: string | null;
  serie: string | null;
  vin: string | null;
  placa: string | null;
}

export interface SigmGarantiaForm {
  /** CONSTITUCIÓN / MODIFICACIÓN / INICIO DE EJECUCIÓN / … (del título del formulario). */
  formulario: string | null;
  numeroFormulario: string | null;
  acreedor: string | null;
  acreedorRuc: string | null;
  tipoGarantia: string | null;
  moneda: string | null;
  montoMaximo: number | null;
  finAviso: string | null;
  indicadorPosesion: string | null;
  acuerdoPartes: string | null;
  preinscripcion: string | null;
  gmpa: string | null;
  bienesParaUso: string | null;
  bienes: SigmBien[];
  /** Descripción del bien (2ª tabla, p. ej. "MUSTANG DARK HORSE"). */
  modeloDescripcion: string | null;
  clausula: string | null;
  modificaciones: string[];
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();
const isLabel = (s: string): boolean => /:\s*$/.test(s.trim());
const norm = (s: string): string => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Geometría relativa de `c` respecto de la etiqueta `l`: avance en su dirección de lectura y desvío. */
function rel(l: PdfItem, c: PdfItem): { along: number; perp: number } {
  const len = Math.hypot(l.dx, l.dy) || 1;
  const ux = l.dx / len, uy = l.dy / len;
  const vx = c.x - l.x, vy = c.y - l.y;
  return { along: vx * ux + vy * uy, perp: vx * -uy + vy * ux };
}

/** Valor de la etiqueta (por su texto normalizado): el 1er texto que no es etiqueta en su misma línea. */
function valueOf(items: PdfItem[], labelRx: RegExp): string | null {
  const l = items.find((i) => labelRx.test(norm(i.str)));
  if (!l) return null;
  let best: { it: PdfItem; along: number } | null = null;
  for (const c of items) {
    if (c === l || c.page !== l.page || !c.str.trim()) continue;
    const { along, perp } = rel(l, c);
    if (along <= 1 || Math.abs(perp) > 4) continue;
    if (isLabel(c.str)) continue;
    if (!best || along < best.along) best = { it: c, along };
  }
  // Si entre la etiqueta y el candidato hay OTRA etiqueta en la línea, el valor es de esa otra → vacío.
  if (best) {
    const blocker = items.some((c) => c !== l && c.page === l.page && isLabel(c.str) && (() => { const r = rel(l, c); return r.along > 1 && r.along < best!.along && Math.abs(r.perp) <= 4; })());
    if (blocker) return null;
  }
  return best ? clean(best.it.str) || null : null;
}

/** Fila de una tabla cuyo encabezado es `header`: celda de la fila `rowPerp` en la columna del encabezado. */
function cellOf(items: PdfItem[], header: PdfItem, rowItem: PdfItem): string | null {
  const rowPerp = rel(header, rowItem).perp;
  let best: { it: PdfItem; d: number } | null = null;
  for (const c of items) {
    if (c.page !== header.page || !c.str.trim() || isLabel(c.str)) continue;
    const r = rel(header, c);
    if (Math.abs(r.perp - rowPerp) > 4) continue;
    const d = Math.abs(r.along);
    if (d > 90) continue;
    if (!best || d < best.d) best = { it: c, d };
  }
  return best ? clean(best.it.str) || null : null;
}

const PLATE_RX = /^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{3}-?[A-Z0-9]{3,4}$/;

export function parseSigmForm(items: PdfItem[], plate?: string): SigmGarantiaForm {
  const all = items.filter((i) => i.str.trim());
  const flat = all.map((i) => i.str).join(' ');
  const formulario = /FORMULARIO DE ([A-ZÁÉÍÓÚÑ ]+?)(?:\s+DE GARANT[IÍ]A)?\s*(?:\||Folio|$)/i.exec(flat)?.[1]?.trim().toUpperCase() ?? null;
  const numeroFormulario = /\b(20\d{2}-\d{4,8})\b/.exec(flat)?.[1] ?? null;

  // ACREEDOR: RUC (20/10 + 9 dígitos) + razón social, buscados SOLO en el bloque del acreedor.
  const razon = valueOf(all, /^RAZON SOCIAL\s*:/);
  // RUC: el número de documento en la línea VECINA a "Razón Social" (no el de un deudor-empresa).
  const docAcreedor = (() => {
    const lab = all.find((i) => /^RAZON SOCIAL\s*:/.test(norm(i.str)));
    if (!lab) return null;
    const cands = all.filter((c) => c.page === lab.page && /^(10|20)\d{9}$/.test(c.str.trim()) && rel(lab, c).along > 0)
      .sort((a, b) => Math.abs(rel(lab, a).perp) - Math.abs(rel(lab, b).perp));
    return cands[0] && Math.abs(rel(lab, cands[0]).perp) < 40 ? cands[0].str.trim() : null;
  })();

  const montoRaw = valueOf(all, /^MONTO MAXIMO DE LA GARANTIA\s*:/);
  const monto = montoRaw ? Number(montoRaw.replace(/\s/g, '').replace(/,/g, '')) : NaN;

  // BIENES específicos registrados: una fila por vehículo. Se ubica por la columna "Placa".
  const bienes: SigmBien[] = [];
  const hPlaca = all.find((i) => norm(i.str) === 'PLACA');
  if (hPlaca) {
    const hdr = (rx: RegExp) => all.find((i) => i.page === hPlaca.page && rx.test(norm(i.str)));
    const H = { marca: hdr(/^MARCA$/), modelo: hdr(/^MODELO$/), motor: hdr(/^NUMERO DE MOTOR$/), serie: hdr(/^NUMERO DE SERIE$/), vin: hdr(/^NUMERO DE VIN$/) };
    const plateCells = all.filter((c) => c.page === hPlaca.page && PLATE_RX.test(c.str.trim().toUpperCase()) && Math.abs(rel(hPlaca, c).perp) > 4 && Math.abs(rel(hPlaca, c).perp) < 80 && Math.abs(rel(hPlaca, c).along) <= 90);
    for (const pc of plateCells) {
      bienes.push({
        placa: clean(pc.str).toUpperCase(),
        marca: H.marca ? cellOf(all, H.marca, pc) : null,
        modelo: H.modelo ? cellOf(all, H.modelo, pc) : null,
        motor: H.motor ? cellOf(all, H.motor, pc) : null,
        serie: H.serie ? cellOf(all, H.serie, pc) : null,
        vin: H.vin ? cellOf(all, H.vin, pc) : null,
      });
    }
  }
  // Descripción del modelo (2ª tabla "no registrados"/detalle): la versión comercial suele estar aquí.
  const modeloDescripcion = (() => {
    const base = bienes[0]?.modelo ? norm(bienes[0].modelo) : null;
    const hit = all.find((i) => base && norm(i.str).startsWith(base) && norm(i.str) !== base);
    return hit ? clean(hit.str) : null;
  })();

  // CLÁUSULA: las líneas largas de prosa (texto libre del contrato), en su orden.
  const prose = all.filter((i) => i.str.trim().split(/\s+/).length >= 10 && !isLabel(i.str) && !/FORMULARIO DE|Se agreg|Se elimin|Se modific/i.test(i.str));
  const clausula = prose.length ? clean(prose.map((i) => i.str).join(' ')).slice(0, 2000) : null;

  const modificaciones = all.filter((i) => /^(Se agreg|Se elimin|Se modific|Se actualiz|Se cambi)/i.test(i.str.trim())).map((i) => clean(i.str));

  const sel = plate ? plate.toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
  bienes.sort((a, b) => Number((b.placa ?? '').replace(/-/g, '') === sel) - Number((a.placa ?? '').replace(/-/g, '') === sel));

  return {
    formulario,
    numeroFormulario,
    acreedor: razon,
    acreedorRuc: docAcreedor,
    tipoGarantia: valueOf(all, /^TIPO DE GARANTIA\s*:/),
    moneda: valueOf(all, /^TIPO DE MONEDA\s*:/),
    montoMaximo: Number.isFinite(monto) && monto > 0 ? monto : null,
    finAviso: valueOf(all, /^FECHA DE FINALIZACION DEL AVISO\s*:/),
    indicadorPosesion: valueOf(all, /^INDICADOR DE POSESION\s*:/),
    acuerdoPartes: valueOf(all, /^ACUERDO ENTRE LAS PARTES\s*:/),
    preinscripcion: valueOf(all, /^INDICADORES? DE PREINSCRIPCION\s*:/),
    gmpa: valueOf(all, /^GARANTIA MOBILIARIA PRIORITARIA/),
    bienesParaUso: valueOf(all, /^BIENES PARA USO\s*:/),
    bienes,
    modeloDescripcion,
    clausula,
    modificaciones,
  };
}

/** "20260317000437760" → "17/03/2026": el folio causal arranca con la fecha de CONSTITUCIÓN. */
export function fechaDeFolio(folio: string | null | undefined): string | null {
  const m = /^(20\d{2})(\d{2})(\d{2})\d{6,}$/.exec(String(folio ?? ''));
  if (!m) return null;
  const [, y, mo, d] = m;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${d}/${mo}/${y}`;
}
