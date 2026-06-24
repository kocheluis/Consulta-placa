/* eslint-disable no-console */
import zlib from 'node:zlib';

/**
 * Parser del ASIENTO de Síguelo Plus (SUNARP).
 *
 * El endpoint `asientoinscripcion/listarAsientos` devuelve `list[].paginaAsiento`
 * = bytes de un PDF. Este módulo: (1) PDF→texto (inflar FlateDecode + literales Tj),
 * (2) texto→datos estructurados (acto, precio, dueños, fechas, documentos),
 * (3) detecta señales de due-diligence: ASEGURADORA / CASA DE REMATE / FINANCIERA.
 */

export interface AsientoDoc { documento: string; funcionario: string; fecha: string }
export interface AsientoFlags { aseguradora: boolean; remate: boolean; financiera: boolean; gravamen: boolean; embargo: boolean }
export interface AsientoRecord {
  tipo: string;
  anio: string | null;
  numero: string | null;
  titulo: string | null;
  partida: string;
  placa: string;
  acto: string;
  precio: string;
  montoPagado: string;
  formaPago: string;
  fechaPresentacion: string;
  fechaAsiento: string;
  participantes: string;
  documentos: AsientoDoc[];
  flags: AsientoFlags;
}

// Señales de due-diligence (regex sobre participantes + tipo + acto + funcionarios).
const RX_ASEG = /\b(SEGUROS|ASEGURADORA|RIMAC|R[IÍ]MAC|PAC[IÍ]FICO|LA POSITIVA|MAPFRE|INTERSEGURO|PROTECTA|CHUBB|SECREX|CRECER SEGUROS|VIDA C[AÁ]MARA|COMPA[ÑN][IÍ]A DE SEGUROS|QU[AÁ]LITAS|AVLA|COFACE|INSUR|SANITAS|RIGEL)\b/i;
const RX_REMATE = /\b(REMATE|SUBASTA|MARTILLER[OA]|ADJUDICACI[OÓ]N|DACI[OÓ]N EN PAGO|EJECUCI[OÓ]N (DE GARANT[IÍ]A|FORZADA)|SUPERBID|VMC SUBASTAS)\b/i;
const RX_FINAN = /\b(LEASING|ARRENDAMIENTO FINANCIERO|FINANCIER[OA]|BANCO\b|CAJA (MUNICIPAL|RURAL)|CR[EÉ]DITO|FACTORING|EDPYME|COOPAC)\b/i;
const RX_GRAVAMEN = /\b(GRAVAMEN|GARANT[IÍ]A MOBILIARIA|HIPOTECA|PRENDA|MEDIDA CAUTELAR)\b/i;
const RX_EMBARGO = /\b(EMBARGO|ANOTACI[OÓ]N DE DEMANDA|INMOVILIZACI[OÓ]N|ORDEN DE CAPTURA|INCAUTACI[OÓ]N|SECUESTRO CONSERVATIVO)\b/i;

/** Bytes de PDF (algunos firmados −128..127) → texto plano. */
export function pdfBytesToText(bytes: number[] | Buffer): string {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.map((n) => (n < 0 ? n + 256 : n)));
  const s = buf.toString('latin1');
  let text = '';
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) { try { text += zlib.inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1') + '\n'; } catch { /* sin inflate */ } }
  const out: string[] = [];
  const tj = /\((?:\\.|[^\\()])*\)/g;
  let t: RegExpExecArray | null;
  while ((t = tj.exec(text))) out.push(t[0].slice(1, -1).replace(/\\(.)/g, '$1'));
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

export function parseAsiento(textRaw: string): AsientoRecord {
  const text = textRaw.replace(/Este documento solo tiene fines informativos[^_]*?registral\.?/i, '').replace(/\s+/g, ' ').trim();
  const g = (re: RegExp): string => (text.match(re)?.[1] ?? '').trim();
  const tituloM = text.match(/\b(20\d{2})\s*-\s*0*(\d{4,8})\b/);
  const anio = tituloM?.[1] ?? null;
  const numero = tituloM?.[2] ?? null;
  const tipo = (text.split(/\s+20\d{2}\s*-\s*\d/)[0] ?? '').replace(/_{2,}/g, ' ').trim();
  const partida = g(/Nro Partida\s+(\d+)/i);
  const placa = g(/Placa\s*:?\s*([A-Z0-9]{5,8})/i);
  const acto = g(/\bActo\s+(.+?)\s+(?:Precio|Monto|Forma|_)/i);
  const precio = g(/\bPrecio\s+((?:US\$|U\$S|S\/\.?|\$)\s*[\d.,]+)/i);
  const montoPagado = g(/Monto Pagado\s+((?:US\$|U\$S|S\/\.?|\$)\s*[\d.,]+)/i);
  const formaPago = g(/Forma de Pago\s+(.+?)\s+(?:_|DUA|Documento|Tipo de Uso|T[IÍ]tulo)/i);
  const fechaPresentacion = g(/T[ií]tulo\s+20\d{2}-\d+\s+Fecha\s+(\d{2}\/\d{2}\/\d{4}(?:\s+[\d:]+)?)/i);
  const fechaAsiento = g(/Fecha (?:de )?Asiento\s+(\d{2}\/\d{2}\/\d{4})/i);
  const participantes = (text.match(/Placa\s*:?\s*[A-Z0-9]{5,8}\s+(.+?)\s+Acto\s+/i)?.[1] ?? '').replace(/_{2,}/g, ' ').replace(/\s+/g, ' ').trim();

  const documentos: AsientoDoc[] = [];
  const docRe = /Documento:\s*(.+?)\s+Funcionario:\s*(.+?)\s+Fecha:\s*(\d{2}\/\d{2}\/\d{4})/gi;
  let dm: RegExpExecArray | null;
  while ((dm = docRe.exec(text))) documentos.push({ documento: dm[1]!.trim(), funcionario: dm[2]!.trim(), fecha: dm[3]! });

  const blob = `${tipo} ${participantes} ${acto} ${documentos.map((d) => d.funcionario).join(' ')}`;
  const flags: AsientoFlags = {
    aseguradora: RX_ASEG.test(blob),
    remate: RX_REMATE.test(blob),
    financiera: RX_FINAN.test(blob),
    gravamen: RX_GRAVAMEN.test(blob),
    embargo: RX_EMBARGO.test(blob),
  };

  return { tipo, anio, numero, titulo: anio && numero ? `${anio}-${numero}` : null, partida, placa, acto, precio, montoPagado, formaPago, fechaPresentacion, fechaAsiento, participantes, documentos, flags };
}

/** dd/mm/aaaa[ hh:mm:ss] → epoch ms (para ordenar). */
function fechaMs(f: string): number {
  const m = f.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return 0;
  return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`).getTime();
}

/** Ordena los asientos cronológicamente (por fecha de presentación) → línea de tiempo. */
export function construirTimeline(asientos: AsientoRecord[]): AsientoRecord[] {
  return [...asientos].sort((a, b) => fechaMs(a.fechaPresentacion) - fechaMs(b.fechaPresentacion));
}
