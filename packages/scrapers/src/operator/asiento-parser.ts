/* eslint-disable no-console */
import zlib from 'node:zlib';
import type { VehicleSpecs } from '@app/shared';

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
  /** Ficha técnica del vehículo si el asiento la trae (Primera Inscripción / Cambio de Características); null si no. */
  caracteristicas: VehicleSpecs | null;
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

/**
 * Extrae la FICHA TÉCNICA del texto de un asiento, si la contiene. Los asientos de "Primera
 * Inscripción de Dominio" y "Cambio de Características/Color" traen esta tabla (label→valor, fila
 * por fila, mismo layout que el resto del asiento); los de gravamen/cancelación/constitutivo no.
 *
 * El orden de la ficha es FIJO (formulario SUNARP), así que cada valor se acota anclando con la
 * etiqueta del campo SIGUIENTE — robusto ante valores con espacios ("GL-I GNV", "4.533 mt"). El
 * par Tipo de Uso/Categoría se trata aparte porque el uso puede contener "(Categoría M1)".
 *
 * Devuelve `null` si el asiento no tiene ficha (no hay "Nro. VIN" ni "Nro. Versión").
 */
export function parseCaracteristicas(textRaw: string): VehicleSpecs | null {
  const text = textRaw
    .replace(/Este documento solo tiene fines informativos[^_]*?registral\.?/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/Nro\.?\s*VIN/i.test(text) || !/Nro\.?\s*Versi[oó]n/i.test(text)) return null;

  // Valor entre `label` y la etiqueta del campo siguiente (`next`). `.match` toma la 1ª aparición;
  // cada etiqueta de la ficha aparece una sola vez, así que es determinista.
  const between = (label: string, next: string): string | null => {
    const m = text.match(new RegExp(`${label}\\s+(.+?)\\s+${next}`, 'i'));
    const v = m?.[1]?.trim();
    return v && v !== '-' ? v : null;
  };

  // Tipo de Uso + Categoría: se captura todo hasta "Nro. VIN" y se separa la Categoría (el
  // último "Categoría X" del blob, porque el uso puede incluir "(Categoría M1)" entre paréntesis).
  let usage: string | null = null;
  let category: string | null = null;
  const usoBlob = between('Tipo de Uso', 'Nro\\.?\\s*VIN');
  if (usoBlob) {
    const cm = usoBlob.match(/^(.*?)\s+Categor[ií]a\s+([A-Za-z0-9-]+)\s*$/i);
    if (cm) { usage = cm[1]!.trim(); category = cm[2]!.trim(); }
    else usage = usoBlob;
  }

  return {
    version: between('Nro\\.?\\s*Versi[oó]n', 'Color'),
    category,
    usage,
    bodywork: between('Tipo\\s+Carrocer[ií]a', 'Nro\\.?\\s*Ruedas'),
    fuel: between('Tipo\\s+Combustible', 'Nro\\.?\\s*Cilindros'),
    displacement: between('Cilindrada', 'Longitud'),
    cylinders: between('Nro\\.?\\s*Cilindros', 'Cilindrada'),
    power: between('Potencia\\s+Motor', 'Tipo\\s+Combustible'),
    axles: between('Nro\\.?\\s*Ejes', 'F[oó]rmula\\s+Rodante'),
    wheels: between('Nro\\.?\\s*Ruedas', 'Nro\\.?\\s*Ejes'),
    driveFormula: between('F[oó]rmula\\s+Rodante', 'Potencia\\s+Motor'),
    seats: between('Nro\\.?\\s*Asientos', 'Nro\\.?\\s*Pasajeros'),
    passengers: between('Nro\\.?\\s*Pasajeros', 'Peso\\s+Bruto'),
    length: between('Longitud', 'Ancho'),
    width: between('Ancho', 'Altura'),
    height: between('Altura', 'Nro\\.?\\s*Asientos'),
    grossWeight: between('Peso\\s+Bruto', 'Peso\\s+Neto'),
    netWeight: between('Peso\\s+Neto', 'Carga\\s+[UÚ]til'),
    payload: between('Carga\\s+[UÚ]til', '(?:Documento|Funcionario|T[ií]tulo)'),
  };
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

  return { tipo, anio, numero, titulo: anio && numero ? `${anio}-${numero}` : null, partida, placa, acto, precio, montoPagado, formaPago, fechaPresentacion, fechaAsiento, participantes, documentos, flags, caracteristicas: parseCaracteristicas(textRaw) };
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
