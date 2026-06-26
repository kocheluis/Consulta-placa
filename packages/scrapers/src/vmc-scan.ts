/* eslint-disable no-console */
import { writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { subastaUpsert, superbidCount, metaGet, metaSet } from './db/repo.js';

/**
 * Scanner del ÍNDICE de VMC Subastas (PURO HTTP — sin navegador). VMC es el canal oficial
 * de **Pacífico** (siniestrados / recuperados / seminuevos). La IP del VPS (Perú) pasa el
 * Cloudflare de VMC, así que basta `fetch`:
 *   1. Las páginas de listado embeben `<a href="/oferta/{id}">` por cada lote.
 *   2. El detalle `/oferta/{id}` trae la PLACA (`"attribute":"Placa","value":"…"`), el PDF
 *      con la boleta informativa SUNARP (`cdn.vmcsubastas.com/details/{id}_…​.pdf`) y la
 *      condición ("Siniestrado", daños, aseguradora) para clasificar.
 *
 * Guarda en el mismo índice multi-fuente que Superbid con `fuente='vmc'` (clave placa+fuente,
 * no se pisan). Descarga la boleta PDF como evidencia (perecible).
 *
 * Uso:  PLACAPE_DB=/root/data/placape.db BOLETAS_DIR=/root/data/boletas \
 *         npx tsx packages/scrapers/src/vmc-scan.ts            (scan de lotes activos — diario)
 *         npx tsx packages/scrapers/src/vmc-scan.ts --backfill-ids 50000 62700   (histórico por id)
 *   flags: --no-boletas (no descargar PDFs)
 */
const BASE = 'https://www.vmcsubastas.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const BOLETAS_DIR = process.env.BOLETAS_DIR ?? join(process.cwd(), 'data', 'boletas');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Páginas de listado a barrer en modo activo (categorías vehiculares + canal Pacífico). */
const LISTINGS = [
  'subastas/vehicular/liviano_.html',
  'subastas/vehicular/pesado_.html',
  'subastas/vehicular/menor_.html',
  'pacifico.html',
  'hoy.html',
];

const PLATE = /^[A-Z0-9]{5,7}$/;
const RX_ASEG = /\b(RIMAC|R[IÍ]MAC|PAC[IÍ]FICO|LA POSITIVA|MAPFRE|INTERSEGURO|QU[AÁ]LITAS|SEGUROS|ASEGURADORA|AVLA|COFACE)\b/i;
const RX_REMATE = /\b(REMATE|SUBASTA|FINANCIERA|MARTILLER|ADJUDICACI|BANCO|LEASING|SANTANDER|ACCESO CREDITICIO|CAJA|EDPYME|CR[EÉ]DITO|VMC)\b/i;
const RX_SINIESTRO = /\b(SINIESTR|P[EÉ]RDIDA TOTAL|CHOCAD|DA[ÑN]AD|DA[ÑN]OS)/i;
const RX_RECUPERADO = /\b(RECUPERAD)/i;

async function http(path: string): Promise<string> {
  const url = path.startsWith('http') ? path : `${BASE}/${path}`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': UA, 'Accept-Language': 'es-PE,es;q=0.9', Referer: `${BASE}/`, Accept: 'text/html,*/*' },
      });
      if (r.ok) {
        const t = await r.text();
        if (t.length > 2000) return t; // descarta retos/redirecciones vacías
      }
    } catch { /* reintenta */ }
    await wait(1500);
  }
  return '';
}

/** Extrae los ids de lote (`/oferta/{id}`) presentes en una página de listado. */
function offerIdsFrom(html: string): number[] {
  const ids = new Set<number>();
  for (const m of html.matchAll(/href="\/oferta\/(\d+)"/g)) ids.add(Number(m[1]));
  return [...ids];
}

/** Parsea el detalle de un lote: placa, boleta PDF, condición y atributos. */
function parseDetail(id: number, raw: string): {
  placa: string; boletaUrl?: string; subasta: string;
  flags: Record<string, boolean>; datos: Record<string, unknown>; estado: 'abierta' | 'cerrada';
} | null {
  const html = raw.replace(/\\\//g, '/'); // des-escapa \/ → / (links dentro de JSON)
  // Atributos: {"attribute":"Placa","value":"CWO271"}
  const attrs: Record<string, string> = {};
  for (const m of html.matchAll(/"attribute":"([^"]+)","value":"([^"]*)"/g)) {
    const k = m[1]; if (k) attrs[k.normalize('NFC')] = (m[2] ?? '').trim();
  }
  const placa = (attrs['Placa'] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!placa || !PLATE.test(placa)) return null; // sin placa válida no sirve al índice por placa

  const grab = (re: RegExp) => html.match(re)?.[1];
  const rawName = grab(/"name":"([^"]+)"/) ?? [attrs['Marca'], attrs['Modelo']].filter(Boolean).join(' ');
  const name = rawName ? rawName.split(/\s*[—|]\s*/)[0]?.trim() : undefined; // corta " — Oferta… | VMC Subastas"
  const anio = grab(/"model_year":"?(\d{4})"?/) ?? attrs['Año'] ?? attrs['Anio'];
  const basePrice = grab(/"base_price":(\d+)/);
  const closeDate = grab(/"close_date":"([^"]+)"/);

  // PDF de detalle (incluye la boleta informativa SUNARP)
  const boletaUrl = html.match(/https:\/\/cdn\.vmcsubastas\.com\/details\/[^\s"'<>\\]+\.pdf/)?.[0];

  const text = `${name ?? ''} ${html.slice(0, 20000)}`; // condición/aseguradora suelen ir arriba
  const aseg = text.match(RX_ASEG)?.[0];
  const flags = {
    aseguradora: !!aseg,
    remate: RX_REMATE.test(text),
    siniestro: RX_SINIESTRO.test(text),
    recuperado: RX_RECUPERADO.test(text),
  };
  const estado: 'abierta' | 'cerrada' = closeDate && closeDate.slice(0, 10) < new Date().toISOString().slice(0, 10) ? 'cerrada' : 'abierta';
  const cond = flags.siniestro ? 'Siniestrado' : flags.recuperado ? 'Recuperado' : 'Subasta';
  const hasYear = !!name && /\b(19|20)\d{2}\b/.test(name);
  const label = [name, hasYear ? undefined : anio].filter(Boolean).join(' ');
  const subasta = `VMC${aseg ? ` (${aseg.toUpperCase()})` : ''}: ${label} — ${cond}`.trim();

  return {
    placa, boletaUrl, subasta, flags, estado,
    datos: { offerId: id, marca: attrs['Marca'], modelo: attrs['Modelo'], name, anio, color: attrs['Color'], basePrice: basePrice ? Number(basePrice) : undefined, closeDate, aseguradora: aseg },
  };
}

async function downloadBoleta(placa: string, link?: string): Promise<boolean> {
  if (!link) return false;
  const path = join(BOLETAS_DIR, `${placa}.pdf`);
  try { await access(path); return false; } catch { /* no existe → bajar */ }
  try {
    const r = await fetch(link, { headers: { 'User-Agent': UA, Referer: `${BASE}/` } });
    if (!r.ok) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 800 || buf.subarray(0, 4).toString('latin1') !== '%PDF') return false;
    await writeFile(path, buf);
    return true;
  } catch { return false; }
}

/** Reúne los ids a procesar según el modo. */
async function collectIds(argv: string[]): Promise<number[]> {
  const bi = argv.indexOf('--backfill-ids');
  if (bi >= 0) {
    const from = Number(argv[bi + 1]); const to = Number(argv[bi + 2]);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) throw new Error('uso: --backfill-ids <desde> <hasta>');
    console.log(`Backfill por id: ${from}..${to} (${to - from + 1} lotes)`);
    const ids: number[] = []; for (let i = from; i <= to; i++) ids.push(i); return ids;
  }
  const ids = new Set<number>();
  for (const page of LISTINGS) {
    const html = await http(page);
    const got = offerIdsFrom(html);
    console.log(`  listado ${page}: ${got.length} lotes`);
    got.forEach((x) => ids.add(x));
    await wait(200);
  }
  return [...ids];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const noBoletas = argv.includes('--no-boletas');
  await mkdir(BOLETAS_DIR, { recursive: true });
  const startIso = new Date().toISOString();
  console.log(`VMC scan${argv.includes('--backfill-ids') ? ' (backfill)' : ' (activos)'} · boletas=${noBoletas ? 'no' : 'sí'}`);

  const ids = await collectIds(argv);
  let scanned = 0, indexed = 0, boletas = 0, sinPlaca = 0;
  for (const id of ids) {
    scanned++;
    const raw = await http(`oferta/${id}`);
    if (!raw) { await wait(150); continue; }
    const d = parseDetail(id, raw);
    if (!d) { sinPlaca++; await wait(120); continue; }
    subastaUpsert({
      placa: d.placa, fuente: 'vmc', subasta: d.subasta,
      loteUrl: `${BASE}/oferta/${id}`, boletaUrl: d.boletaUrl,
      flags: d.flags, datos: d.datos, estado: d.estado,
    });
    indexed++;
    if (!noBoletas && await downloadBoleta(d.placa, d.boletaUrl)) boletas++;
    if (indexed % 25 === 0) console.log(`  procesados ${scanned}/${ids.length} · indexados ${indexed} · boletas ${boletas}`);
    await wait(150);
  }

  metaSet('vmc_ultimo_scan_at', startIso);
  metaSet('vmc_total', indexed);
  console.log(`\n✓ VMC scan: revisados ${scanned}, indexados ${indexed} (con placa), boletas nuevas ${boletas}, sin placa ${sinPlaca}.`);
  console.log(`  Índice VMC en DB: ${superbidCount('vmc')} · índice total: ${superbidCount()}`);
  process.exit(0);
}
main().catch((e) => { console.error('vmc scan error:', (e as Error).message); process.exit(1); });
