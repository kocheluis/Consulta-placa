/* eslint-disable no-console */
/**
 * Analiza los resultados de `batch-historial.ts` (validacion-fuentes/tipificacion/parsed/*.json)
 * y produce el PANORAMA de casuísticas del historial de asientos: actos distintos + frecuencia,
 * distribución de banderas, casos raros y estructuras notables (multi-compraventa, garantía
 * vigente/cancelada, embargo, remate). Base para tipificar escenarios.
 *
 *   npx tsx packages/scrapers/src/tipificar.ts
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'd:/Jose/Proyecto_Consulta_placa/validacion-fuentes/tipificacion';
const dir = join(OUT, 'parsed');
if (!existsSync(dir)) { console.error('No hay datos en', dir); process.exit(1); }

interface Accion { acto: string; precio?: string; participantes?: string }
interface Grupo { titulo: string | null; acciones: Accion[]; flags?: Record<string, boolean> }
interface Rec { plate: string; ok: boolean; error?: string | null; titulos?: string[]; flags?: Record<string, boolean>; vehiculo?: Record<string, unknown> | null; grupos?: Grupo[] }

const recs: Rec[] = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const ok = recs.filter((r) => r.ok);
const fail = recs.filter((r) => !r.ok);

const inc = (m: Map<string, number>, k: string, n = 1): void => { m.set(k, (m.get(k) ?? 0) + n); };
const sortDesc = (m: Map<string, number>): [string, number][] => [...m.entries()].sort((a, b) => b[1] - a[1]);
const RX_LEVANT = /cancela|levantamiento|caduc|extinci[oó]n|liberaci[oó]n/i;
const RX_GARANT = /garant[ií]a mobiliaria|prenda|hipoteca|gravamen/i;
const RX_REMATE = /remate|subasta|adjudicaci[oó]n|daci[oó]n en pago/i;
const RX_CV = /compra\s*-?\s*venta/i;

/** Acto BASE = el nombre del acto sin su "Observación/detalle" (para tipificar la casuística). */
function baseActo(a: string): string {
  let s = a.split(/\s+Observaci[oó]n\b/i)[0]!;                 // "... Observación ..." → detalle
  s = s.replace(/(?<!\bNo)(?<!\bNro)\.\s+.*$/i, '');           // ". Detalle" (protege No./Nro.)
  s = s.replace(/\s+[-–]?\s*[A-ZÑÁÉÍÓÚ0-9][A-ZÑÁÉÍÓÚ0-9 .,/()°#'"%$:–-]{16,}$/, ''); // detalle EN MAYÚSCULAS
  return s.replace(/[.\s–-]+$/, '').trim() || a.slice(0, 40);
}

const L: string[] = [];
const p = (s = ''): void => { L.push(s); };

p(`# Tipificación de historial — ${recs.length} placas (${ok.length} OK · ${fail.length} FAIL)`);
p();

// ── FAIL: motivos ──
if (fail.length) {
  const fm = new Map<string, number>();
  for (const r of fail) inc(fm, (r.error ?? 'sin error').replace(/\s+/g, ' ').slice(0, 70));
  p('## FAIL — motivos');
  for (const [k, n] of sortDesc(fm)) p(`- ${n}× ${k}`);
  p();
}

// ── Distribución estructural (solo OK) ──
const nAs = ok.map((r) => (r.grupos ?? []).length).sort((a, b) => a - b);
const nAcc = ok.map((r) => (r.grupos ?? []).reduce((s, g) => s + g.acciones.length, 0)).sort((a, b) => a - b);
const med = (a: number[]): number => (a.length ? a[Math.floor(a.length / 2)]! : 0);
p('## Estructura (OK)');
p(`- Asientos por placa: min ${nAs[0] ?? 0} · mediana ${med(nAs)} · max ${nAs[nAs.length - 1] ?? 0}`);
p(`- Acciones por placa: min ${nAcc[0] ?? 0} · mediana ${med(nAcc)} · max ${nAcc[nAcc.length - 1] ?? 0}`);
p();

// ── Banderas ──
const flagCount = new Map<string, number>();
for (const r of ok) for (const [k, v] of Object.entries(r.flags ?? {})) if (v) inc(flagCount, k);
p('## Banderas (nº de placas OK con la bandera)');
for (const [k, n] of sortDesc(flagCount)) p(`- ${k}: ${n}`);
p();

// ── Actos distintos + frecuencia ──
const actoFreq = new Map<string, number>();
const actoPlacas = new Map<string, string[]>();
for (const r of ok) {
  const vistos = new Set<string>();
  for (const g of r.grupos ?? []) for (const a of g.acciones) {
    inc(actoFreq, a.acto);
    if (!vistos.has(a.acto)) { vistos.add(a.acto); (actoPlacas.get(a.acto) ?? actoPlacas.set(a.acto, []).get(a.acto)!).push(r.plate); }
  }
}
// Actos BASE (sin observación) — la taxonomía real de casuísticas.
const baseFreq = new Map<string, number>();
for (const [k, n] of actoFreq) inc(baseFreq, baseActo(k), n);
p(`## Actos BASE (${baseFreq.size}) — casuísticas (nº de apariciones)`);
for (const [k, n] of sortDesc(baseFreq)) p(`- ${n}× ${k}`);
p();

p(`## Actos distintos con detalle (${actoFreq.size})`);
for (const [k, n] of sortDesc(actoFreq)) p(`- ${n}× ${k}`);
p();

// ── Actos RAROS (≤2 apariciones) = candidatos a casuística nueva ──
const raros = sortDesc(actoFreq).filter(([, n]) => n <= 2);
if (raros.length) {
  p('## Actos raros (≤2×) — revisar para tipificar');
  for (const [k, n] of raros) p(`- ${n}× ${k}  → ${(actoPlacas.get(k) ?? []).slice(0, 4).join(', ')}`);
  p();
}

// ── Escenarios estructurales notables ──
const multiCV = ok.filter((r) => (r.grupos ?? []).some((g) => g.acciones.filter((a) => RX_CV.test(a.acto)).length > 1));
const conGarantia = ok.filter((r) => (r.grupos ?? []).some((g) => g.acciones.some((a) => RX_GARANT.test(a.acto))));
const conCancel = conGarantia.filter((r) => (r.grupos ?? []).some((g) => g.acciones.some((a) => RX_LEVANT.test(a.acto))));
const garantiaVigente = conGarantia.filter((r) => !conCancel.includes(r));
const conRemate = ok.filter((r) => (r.grupos ?? []).some((g) => g.acciones.some((a) => RX_REMATE.test(a.acto))));
const soloPrimera = ok.filter((r) => { const acc = (r.grupos ?? []).flatMap((g) => g.acciones); return acc.length > 0 && acc.every((a) => /primera inscripci/i.test(a.acto)); });
const multiActoAsiento = ok.filter((r) => (r.grupos ?? []).some((g) => g.acciones.length > 1));

const lista = (rs: Rec[]): string => rs.map((r) => r.plate).slice(0, 25).join(', ') + (rs.length > 25 ? ` … (+${rs.length - 25})` : '');
p('## Escenarios estructurales');
p(`- Multi-compraventa en UN asiento (tracto sucesivo): ${multiCV.length} → ${lista(multiCV)}`);
p(`- Asiento con >1 acción (cualquier tipo): ${multiActoAsiento.length} → ${lista(multiActoAsiento)}`);
p(`- Con garantía/gravamen: ${conGarantia.length} (vigente: ${garantiaVigente.length}, con cancelación: ${conCancel.length})`);
p(`  - vigente → ${lista(garantiaVigente)}`);
p(`  - cancelada → ${lista(conCancel)}`);
p(`- Con remate/adjudicación/dación: ${conRemate.length} → ${lista(conRemate)}`);
p(`- Solo Primera Inscripción (0 transferencias): ${soloPrimera.length} → ${lista(soloPrimera)}`);
p();

// ── Top por nº de acciones (historiales más ricos) ──
const top = [...ok].sort((a, b) => (b.grupos ?? []).reduce((s, g) => s + g.acciones.length, 0) - (a.grupos ?? []).reduce((s, g) => s + g.acciones.length, 0)).slice(0, 12);
p('## Top historiales (más acciones)');
for (const r of top) {
  const acc = (r.grupos ?? []).reduce((s, g) => s + g.acciones.length, 0);
  p(`- ${r.plate} (${(r.grupos ?? []).length}as/${acc}acc): ${[...new Set((r.grupos ?? []).flatMap((g) => g.acciones.map((a) => a.acto)))].join(' | ')}`);
}
p();

const md = L.join('\n');
console.log(md);
writeFileSync(join(OUT, 'tipificacion-resumen.md'), md, 'utf8');
console.log(`\n→ guardado: ${join(OUT, 'tipificacion-resumen.md')}`);
process.exit(0);
