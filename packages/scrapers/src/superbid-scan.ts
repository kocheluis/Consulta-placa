/* eslint-disable no-console */
import { writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { superbidUpsert, superbidCount, metaGet, metaSet } from './db/repo.js';

/**
 * Scanner del ÍNDICE de Superbid (PURO API — sin navegador). Enumera las ofertas de
 * vehículos del portal Perú, extrae la PLACA del anexo "boleta SUNARP" (su nombre =
 * la placa, que en la descripción va enmascarada), clasifica la subasta
 * (aseguradora/remate) y lo guarda en la DB. Descarga la boleta PDF (evidencia
 * perecible) para subastas abiertas/recientes.
 *
 * API: offer-query.superbid.net/offers/?portalId=21&filter=product.productType.id:10
 *      &orderBy=createAt:desc&pageNumber=N&pageSize=100
 *
 * Uso:  PLACAPE_DB=/root/data/placape.db BOLETAS_DIR=/root/data/boletas \
 *         npx tsx packages/scrapers/src/superbid-scan.ts --full        (backfill)
 *         npx tsx packages/scrapers/src/superbid-scan.ts --delta       (diario)
 *   flags: --no-boletas (no descargar PDFs) · --boletas-all (descargar también las viejas)
 */
const API = 'https://offer-query.superbid.net/offers/';
const PORTAL = '21';
const FILTER = 'product.productType.id:10'; // Autos y Motos
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const BOLETAS_DIR = process.env.BOLETAS_DIR ?? join(process.cwd(), 'data', 'boletas');
const PAGE = 100;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PLATE = /^[A-Z0-9]{6}$/;
const RX_ASEG = /\b(RIMAC|R[IÍ]MAC|PAC[IÍ]FICO|LA POSITIVA|MAPFRE|INTERSEGURO|QU[AÁ]LITAS|SEGUROS|ASEGURADORA|AVLA|COFACE)\b/i;
const RX_REMATE = /\b(REMATE|SUBASTA|FINANCIERA|MARTILLER|ADJUDICACI|BANCO|LEASING|SANTANDER|ACCESO CREDITICIO|CAJA|EDPYME|CR[EÉ]DITO|VMC)\b/i;
const RX_SINIESTRO = /\b(SINIESTR|P[EÉ]RDIDA TOTAL|RECUPERAD)/i;

interface Att { originalFileName?: string; link?: string; createdAt?: string }
interface Offer { id: number; createAt?: string; endDate?: string; statusId?: number; offerStatus?: { closed?: boolean }; auction?: { desc?: string }; offerDescription?: { offerDescription?: string }; product?: { shortDesc?: string; attachments?: Att[] } }

/** Busca el anexo cuyo nombre = placa peruana (6 alfanum. con letras y dígitos). */
function plateFromAtts(atts?: Att[]): { placa: string; link?: string; createdAt?: string } | null {
  for (const a of atts ?? []) {
    const fn = (a.originalFileName ?? '').replace(/\.pdf$/i, '').toUpperCase().replace(/-/g, '');
    if (PLATE.test(fn) && /[A-Z]/.test(fn) && /[0-9]/.test(fn)) return { placa: fn, link: a.link, createdAt: a.createdAt };
  }
  return null;
}
function classify(text: string): Record<string, boolean> {
  return { aseguradora: RX_ASEG.test(text), remate: RX_REMATE.test(text), siniestro: RX_SINIESTRO.test(text) };
}
function parseDesc(s: string): Record<string, string | undefined> {
  const up = (s ?? '').toUpperCase();
  const grab = (re: RegExp) => (up.match(re)?.[1] ?? '').trim() || undefined;
  return {
    marca: grab(/MARCA:\s*([A-Z0-9 .\-]+?)(?:\s{2,}|MODELO|AÑO|PLACA|$)/),
    modelo: grab(/MODELO:\s*([A-Z0-9 .\-]+?)(?:\s{2,}|AÑO|PLACA|UBICA|$)/),
    anio: grab(/A[ÑN]O:\s*(\d{4})/),
    placaMask: grab(/PLACA:\s*([A-Z0-9*\-]+)/),
  };
}

async function fetchPage(pageNumber: number): Promise<{ total: number; offers: Offer[] }> {
  const u = new URL(API);
  u.searchParams.set('portalId', PORTAL);
  u.searchParams.set('filter', FILTER);
  u.searchParams.set('orderBy', 'createAt:desc');
  u.searchParams.set('pageNumber', String(pageNumber));
  u.searchParams.set('pageSize', String(PAGE));
  const r = await fetch(u, { headers: { 'User-Agent': UA, Origin: 'https://www.superbid.com.pe', Referer: 'https://www.superbid.com.pe/' } });
  if (!r.ok) throw new Error(`API HTTP ${r.status}`);
  return r.json() as Promise<{ total: number; offers: Offer[] }>;
}

async function downloadBoleta(placa: string, link?: string): Promise<boolean> {
  if (!link) return false;
  const path = join(BOLETAS_DIR, `${placa}.pdf`);
  try { await access(path); return false; } catch { /* no existe → bajar */ }
  try {
    const r = await fetch(link, { headers: { 'User-Agent': UA } });
    if (!r.ok) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 800 || buf.subarray(0, 4).toString('latin1') !== '%PDF') return false;
    await writeFile(path, buf);
    return true;
  } catch { return false; }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--delta') ? 'delta' : 'full';
  const noBoletas = argv.includes('--no-boletas');
  const boletasAll = argv.includes('--boletas-all');
  await mkdir(BOLETAS_DIR, { recursive: true });

  const startIso = new Date().toISOString();
  const sinceRaw = mode === 'delta' ? (metaGet<string>('ultimo_scan_at') ?? '') : '';
  // margen de 3 días para no perder ofertas modificadas tarde
  const sinceCut = sinceRaw ? new Date(new Date(sinceRaw).getTime() - 3 * 864e5).toISOString().slice(0, 10) : '';
  const recientes = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10); // boletas: solo ≤60 días salvo --boletas-all

  console.log(`Superbid scan modo=${mode}${sinceCut ? ` desde ${sinceCut}` : ''} · boletas=${noBoletas ? 'no' : boletasAll ? 'todas' : 'recientes/abiertas'}`);

  let page = 0, scanned = 0, indexed = 0, boletas = 0, total = 0, stop = false;
  while (!stop) {
    let d: { total: number; offers: Offer[] };
    try { d = await fetchPage(page); }
    catch (e) { console.warn(`  pagina ${page}: ${(e as Error).message} — reintento`); await wait(2000); try { d = await fetchPage(page); } catch { break; } }
    total = d.total;
    if (!d.offers?.length) break;
    for (const o of d.offers) {
      scanned++;
      const created = (o.createAt ?? '').slice(0, 10);
      if (mode === 'delta' && sinceCut && created && created < sinceCut) { stop = true; break; }
      const pf = plateFromAtts(o.product?.attachments);
      if (!pf) continue;
      const desc = o.product?.shortDesc ?? o.offerDescription?.offerDescription ?? '';
      const subasta = o.auction?.desc ?? '';
      const flags = classify(`${subasta} ${desc}`);
      const closed = o.offerStatus?.closed ?? o.statusId === 7;
      superbidUpsert({
        placa: pf.placa,
        subasta,
        loteUrl: `https://www.superbid.com.pe/oferta/${o.id}`,
        boletaUrl: pf.link,
        flags,
        datos: { offerId: o.id, ...parseDesc(desc), endDate: o.endDate, createAt: o.createAt, boletaFile: pf.createdAt },
        estado: closed ? 'cerrada' : 'abierta',
      });
      indexed++;
      if (!noBoletas && (boletasAll || !closed || created >= recientes)) {
        if (await downloadBoleta(pf.placa, pf.link)) boletas++;
      }
    }
    if (page % 10 === 0) console.log(`  pag ${page} · escaneadas ${scanned}/${total} · indexadas ${indexed} · boletas ${boletas}`);
    page++;
    if (page * PAGE >= total) break;
    await wait(120);
  }

  metaSet('ultimo_scan_at', startIso);
  metaSet('superbid_total', total);
  console.log(`\n✓ scan ${mode}: escaneadas ${scanned}, indexadas ${indexed} (placas con boleta), boletas nuevas ${boletas}. Índice total en DB: ${superbidCount()}`);
  process.exit(0);
}
main().catch((e) => { console.error('scan error:', (e as Error).message); process.exit(1); });
