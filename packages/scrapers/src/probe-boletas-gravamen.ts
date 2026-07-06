/* eslint-disable no-console */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { pdfBytesToText } from './operator/asiento-parser.js';

/**
 * Busca, entre las BOLETAS informativas de SUNARP descargadas de Superbid (PDFs en
 * BOLETAS_DIR, nombre de archivo = placa), cuáles mencionan GARANTÍA MOBILIARIA / gravamen,
 * y las ordena por FECHA DE DESCARGA (mtime del PDF) de más reciente a más antigua.
 *
 * Objetivo: conseguir una PLACA DE PRUEBA con carga registrada para construir/validar el
 * scraper del SIGM (`sigm.sunarp.gob.pe/garantias-mobiliarias`, consulta "Por Bien" → placa).
 * OJO: la fecha de la garantía en sí no importa — importa que la boleta sea de las más
 * recientes que descargamos (más probable que la subasta/carga siga viva hoy).
 *
 * Uso (VPS):  BOLETAS_DIR=/root/data/boletas npx tsx packages/scrapers/src/probe-boletas-gravamen.ts
 */
const DIR = process.env.BOLETAS_DIR ?? '/root/data/boletas';

/** Texto crudo de TODOS los streams inflados (capta la palabra aunque esté en arrays TJ). */
function rawText(buf: Buffer): string {
  const s = buf.toString('latin1');
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  let out = '';
  while ((m = re.exec(s))) { try { out += zlib.inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1') + ' '; } catch { /* sin inflate */ } }
  return out;
}

const RX_GARANTIA = /garant[ií]a\s+mobiliaria/i;
const RX_GRAV = /gravamen|prenda|hipoteca|medida cautelar|embargo/i;
// Negaciones típicas de la boleta ("NO REGISTRA CARGAS NI GRAVÁMENES", "LIBRE DE GRAVAMEN").
const RX_NEG = /no\s+(registra|presenta|tiene|existe)|sin\s+(cargas|grav|garant)|libre\s+de\s+grav/i;

interface Hit { placa: string; mtime: Date; garantia: boolean; neg: boolean; snip: string }

async function main(): Promise<void> {
  let files: string[];
  try { files = (await readdir(DIR)).filter((f) => /\.pdf$/i.test(f)); }
  catch { console.error(`No pude leer ${DIR} — revisa BOLETAS_DIR.`); process.exit(1); }

  let conTexto = 0, imagenSolo = 0;
  const hits: Hit[] = [];
  for (const f of files) {
    const path = join(DIR, f);
    let buf: Buffer; let mtime: Date;
    try { buf = await readFile(path); mtime = (await stat(path)).mtime; } catch { continue; }
    const clean = pdfBytesToText(buf);
    const hay = `${rawText(buf)} ${clean}`;
    if (hay.trim().length < 40) { imagenSolo++; continue; } // PDF escaneado (sin texto) → necesitaría OCR
    conTexto++;
    if (!RX_GARANTIA.test(hay) && !RX_GRAV.test(hay)) continue;
    const src = clean || hay;
    const mm = src.match(new RegExp(`.{0,55}(?:${RX_GARANTIA.source}|${RX_GRAV.source}).{0,65}`, 'i'));
    const snip = (mm?.[0] ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
    hits.push({ placa: f.replace(/\.pdf$/i, ''), mtime, garantia: RX_GARANTIA.test(hay), neg: RX_NEG.test(snip), snip });
  }

  hits.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  console.log(`Boletas: ${files.length} · con texto: ${conTexto} · solo-imagen (sin texto, se saltan): ${imagenSolo}`);
  console.log(`Con mención de garantía/gravamen: ${hits.length} — ordenadas por fecha de descarga (desc)\n`);
  console.log('DESCARGA          PLACA    GM  PROB  SNIPPET');
  console.log('─'.repeat(110));
  for (const h of hits) {
    const prob = h.garantia && !h.neg ? 'SÍ ' : h.neg ? 'no ' : '?? ';
    console.log(`${h.mtime.toISOString().slice(0, 16).replace('T', ' ')}  ${h.placa.padEnd(8)} ${h.garantia ? 'GM' : '  '}  ${prob}  ${h.snip}`);
  }
  console.log('\nGM = menciona "garantía mobiliaria" · PROB SÍ = sin negación cerca (candidata real) · ?? = revisar snippet.');
}
main().catch((e) => { console.error((e as Error).message); process.exit(1); });
