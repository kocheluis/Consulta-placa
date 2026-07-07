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
const RX_FINAN = /\b(LEASING|ARRENDAMIENTO FINANCIERO|FINANCIER[OA]|BANCO\b|CAJA (MUNICIPAL|RURAL)|CR[EÉ]DITOS?|FACTORING|EDPYME|COOPAC)\b/i;
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

// Unión de TODAS las etiquetas de la ficha. El valor de un campo termina donde EMPIEZA la etiqueta
// siguiente (la que sea) → la extracción es INDEPENDIENTE DEL ORDEN. Distintos asientos ordenan los
// campos distinto (p. ej. ADY067 pone la versión antes que la carrocería; B9K236 al revés). Si
// apareciera una etiqueta no listada, solo el campo justo anterior se sobre-captura; el resto queda bien.
const SPEC_LABELS =
  'DUA|Tipo de Uso|Categor[ií]a|Nro\\.?\\s*VIN|Nro\\.?\\s*Serie|Nro\\.?\\s*Motor|Marca|Modelo|' +
  'A[ñn]o\\s+Fabricaci[oó]n|A[ñn]o\\s+Modelo|Nro\\.?\\s*Versi[oó]n|Color|Tipo\\s+Carrocer[ií]a|' +
  'Nro\\.?\\s*Ruedas|Nro\\.?\\s*Ejes|F[oó]rmula\\s+Rodante|Potencia\\s+Motor|Tipo\\s+Combustible|' +
  'Nro\\.?\\s*Cilindros|Cilindrada|Longitud|Ancho|Altura|Nro\\.?\\s*Asientos|Nro\\.?\\s*Pasajeros|' +
  'Nro\\.?\\s*Puertas|Peso\\s+Bruto|Peso\\s+Neto|Peso\\s+Seco|Carga\\s+[UÚ]til|' +
  'Documento|Funcionario|T[ií]tulo|Fecha';

/**
 * Extrae la FICHA TÉCNICA del texto de un asiento, si la contiene. Los asientos de "Primera
 * Inscripción de Dominio" y "Cambio de Características/Color" traen esta tabla (label→valor); los de
 * gravamen/cancelación/constitutivo no. El ORDEN de los campos VARÍA entre asientos, así que cada
 * valor se captura hasta la siguiente etiqueta conocida (unión `SPEC_LABELS`), no hasta un vecino fijo.
 *
 * Devuelve `null` si el asiento no tiene ficha (no hay "Nro. VIN" ni "Nro. Versión").
 */
export function parseCaracteristicas(textRaw: string): VehicleSpecs | null {
  const text = textRaw
    .replace(/Este documento solo tiene fines informativos[^_]*?registral\.?/i, '')
    // Las filas de guiones bajos separan bloques en el PDF; colapsarlas evita que se cuelen en un campo.
    .replace(/_{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/Nro\.?\s*VIN/i.test(text) || !/Nro\.?\s*Versi[oó]n/i.test(text)) return null;

  // Valor de `label` = lo que sigue hasta la PRÓXIMA etiqueta conocida (lookahead) o el fin.
  const field = (label: string): string | null => {
    const m = text.match(new RegExp(`${label}\\s+(.+?)\\s+(?=${SPEC_LABELS}|$)`, 'i'));
    const v = m?.[1]?.trim();
    return v && v !== '-' ? v : null;
  };

  // Tipo de Uso + Categoría: el uso suele incluir "(Categoria X)", luego viene la Categoría (valor
  // corto). Se captura el uso hasta el ")" y la Categoría aparte; fallback sin paréntesis.
  let usage: string | null = null;
  let category: string | null = null;
  const um = text.match(/Tipo de Uso\s+(.+?\))\s+Categor[ií]a\s+([A-Za-z0-9-]+)/i)
    ?? text.match(/Tipo de Uso\s+(.+?)\s+Categor[ií]a\s+([A-Za-z0-9-]+)(?:\s|$)/i);
  if (um) { usage = um[1]!.trim(); category = um[2]!.trim(); }
  else usage = field('Tipo de Uso');

  return {
    version: field('Nro\\.?\\s*Versi[oó]n'),
    category,
    usage,
    bodywork: field('Tipo\\s+Carrocer[ií]a'),
    fuel: field('Tipo\\s+Combustible'),
    displacement: field('Cilindrada'),
    cylinders: field('Nro\\.?\\s*Cilindros'),
    power: field('Potencia\\s+Motor'),
    axles: field('Nro\\.?\\s*Ejes'),
    wheels: field('Nro\\.?\\s*Ruedas'),
    driveFormula: field('F[oó]rmula\\s+Rodante'),
    seats: field('Nro\\.?\\s*Asientos'),
    passengers: field('Nro\\.?\\s*Pasajeros'),
    length: field('Longitud'),
    width: field('Ancho'),
    height: field('Altura'),
    grossWeight: field('Peso\\s+Bruto'),
    netWeight: field('Peso\\s+Neto'),
    payload: field('Carga\\s+[UÚ]til'),
  };
}

/** Tildes que SUNARP omite en los nombres de acto + el guion de compra-venta. */
const ACENTOS: Array<[RegExp, string]> = [
  [/\bCancelacion\b/g, 'Cancelación'], [/\bAfectacion\b/g, 'Afectación'], [/\bInscripcion\b/g, 'Inscripción'],
  [/\bConstitucion\b/g, 'Constitución'], [/\bGarantia\b/g, 'Garantía'], [/\bEjecucion\b/g, 'Ejecución'],
  [/\bAnotacion\b/g, 'Anotación'], [/\bAdjudicacion\b/g, 'Adjudicación'], [/\bHipoteca\b/g, 'Hipoteca'],
];
/** Normaliza el nombre de un acto/tipo: colapsa espacios y guiones bajos, corrige tildes y "Compra - Venta". */
export function normalizeActo(s: string): string {
  // Quita caracteres NO imprimibles (basura de streams del PDF que se cuela entre bloques):
  // deja ASCII imprimible + letras latinas con tilde ( -ɏ). Evita que un acto arrastre bytes binarios.
  let out = (s || '').replace(/[^\t\n\r\x20-\x7E -ɏ]/g, ' ').replace(/_{2,}/g, ' ').replace(/\s+/g, ' ').trim();
  out = out.replace(/\bCompra\s*-\s*Venta\b/gi, 'Compra-Venta');
  for (const [re, to] of ACENTOS) out = out.replace(re, to);
  return out.replace(/\s*\.\s*$/, '').trim();
}

/** Proporción de caracteres imprimibles ASCII — detecta el texto de un asiento que quedó BINARIO
 *  (el PDF trae streams que `pdfBytesToText` no supo inflar/extraer → sale ilegible). */
function printableRatio(s: string): number {
  if (!s) return 1;
  return (s.match(/[\t\n\r\x20-\x7E]/g)?.length ?? 0) / s.length;
}

/** Acto/tipo placeholder cuando el asiento no se pudo leer (PDF binario). */
const NO_LEGIBLE = 'Asiento no legible';

/**
 * Un título de Síguelo puede traer VARIOS asientos en el mismo PDF (p. ej. Compra-Venta +
 * Cancelación de Afectación). `pdfBytesToText` los concatena; esto los separa por su cabecera
 * "<TIPO> AAAA - NNNNN Título Nro Partida <P> Placa : <PL>" para poder parsear cada uno.
 */
export function splitAsientos(fullText: string): string[] {
  const re = /(?:^|[^A-Za-zÁÉÍÓÚÑáéíóúñ])([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ ]{2,70}?)\s+20\d{2}\s*-\s*0*\d{4,8}\s+T[íi]tulo\s+Nro\s+Partida/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(fullText))) starts.push(m.index + m[0].indexOf(m[1]!));
  if (starts.length <= 1) return [fullText];
  return starts.map((s, i) => fullText.slice(s, starts[i + 1] ?? fullText.length));
}

export function parseAsiento(textRaw: string): AsientoRecord {
  const text = textRaw
    .replace(/Este documento solo tiene fines informativos[^_]*?registral\.?/gi, ' ')
    // El clausulado "Forma y condiciones de ejecución del bien" (garantías) es texto legal
    // HIPOTÉTICO ("...la ADJUDICACIÓN al acreedor... o la EJECUCIÓN judicial"): NO es un remate
    // real. Se quita antes de detectar banderas para no marcar 'remate' falso (caso CHP605).
    .replace(/Forma y condiciones de ejecuci[oó]n del bien.*?(?:C[OÓ]DIGO PROCESAL CIVIL|\bCIVIL\b)\.?/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const g = (re: RegExp): string => (text.match(re)?.[1] ?? '').trim();
  const tituloM = text.match(/\b(20\d{2})\s*-\s*0*(\d{4,8})\b/);
  const anio = tituloM?.[1] ?? null;
  const numero = tituloM?.[2] ?? null;
  // Si el asiento degradó a BINARIO (PDF con streams que pdfBytesToText no supo extraer), NO se
  // vuelca la basura como acto: se emite un registro "no legible" conservando el título/número
  // (para no perder el conteo del asiento ni marcar banderas falsas sobre bytes al azar).
  if (printableRatio(text) < 0.6) {
    return {
      tipo: NO_LEGIBLE, anio, numero, titulo: anio && numero ? `${anio}-${numero}` : null,
      partida: '', placa: '', acto: NO_LEGIBLE, precio: '', montoPagado: '', formaPago: '',
      fechaPresentacion: '', fechaAsiento: '', participantes: '', documentos: [],
      flags: { aseguradora: false, remate: false, financiera: false, gravamen: false, embargo: false },
      caracteristicas: null,
    };
  }
  // tipo = cabecera del asiento (lo que va ANTES de "AAAA - NNNN Título Nro Partida").
  const tipoRaw = text.match(/^\s*(.*?)\s+20\d{2}\s*-\s*0*\d{4,8}\s+T[íi]tulo\s+Nro\s+Partida/)?.[1]
    ?? text.split(/\s+20\d{2}\s*-\s*\d/)[0] ?? '';
  const tipo = normalizeActo(tipoRaw);
  const partida = g(/Nro Partida\s+(\d+)/i);
  const placa = g(/Placa\s*:?\s*([A-Z0-9]{5,8})/i);
  // Acto EXPLÍCITO: etiqueta "Acto" con A MAYÚSCULA (evita "Fecha del acto constitutivo").
  // Si no hay acto explícito (garantías), el acto = el tipo de la cabecera.
  const actoExpl = normalizeActo(text.match(/(?:^|[_\s])Acto\s+(.+?)\s+(?:Precio|Monto|Forma|Documento|Participantes|DEUDOR|_)/)?.[1] ?? '');
  const acto = actoExpl || tipo;
  const precio = g(/\bPrecio\s+((?:US\$|U\$S|S\/\.?|\$)\s*[\d.,]+)/i);
  const montoPagado = g(/Monto Pagado\s+((?:US\$|U\$S|S\/\.?|\$)\s*[\d.,]+)/i);
  const formaPago = g(/Forma de Pago\s+(.+?)\s+(?:_|DUA|Documento|Tipo de Uso|T[IÍ]tulo)/i);
  // Fecha de presentación: dos formatos de pie ("Título 2025-740912 Fecha 10/03/2025" y
  // "Título Nro. : 2023 - 2736229 Orden Nro. : … Fecha : 19/09/2023").
  const fechaPresentacion = g(/T[íi]tulo\s*(?:Nro\.?\s*:?\s*)?20\d{2}\s*-\s*\d+(?:\s+Orden[^_]*?)?\s+Fecha\s*:?\s*(\d{2}\/\d{2}\/\d{4}(?:\s+[\d:]+(?:\s*[ap]m)?)?)/i);
  const fechaAsiento = g(/Fecha (?:de )?Asiento\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
  // Participantes: entre "Placa" y "Acto" (compraventa/inscripción); si viene vacío (garantía/
  // cancelación), se arma con DEUDOR/ACREEDOR (soporta ":" y "-" como separador).
  let participantes = normalizeActo(text.match(/Placa\s*:?\s*[A-Z0-9]{5,8}\s+(.+?)\s+Acto\s+/)?.[1] ?? '');
  if (!participantes || /^[.\s_]*$/.test(participantes)) {
    const deu = text.match(/DEUDOR[^:\-]*[:\-]\s*(?:PERSONA \w+\s+)?([A-ZÁÉÍÓÚÑ0-9][^_]+?)\s+(?:RUC|PARTIDA|ACREEDOR|_)/);
    const acr = text.match(/ACREEDOR[^:\-]*[:\-]\s*(?:PERSONA \w+\s+)?([A-ZÁÉÍÓÚÑ0-9][^_]+?)\s+(?:RUC|PARTIDA|REPRESENTANTE|_)/);
    participantes = [deu?.[1] && `Deudor: ${deu[1].trim()}`, acr?.[1] && `Acreedor: ${acr[1].trim()}`].filter(Boolean).join(' · ');
  }

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

/** Parsea TODOS los asientos que trae el PDF de un título (múltiples actos → múltiples registros). */
export function parseAsientos(fullText: string): AsientoRecord[] {
  return splitAsientos(fullText).map(parseAsiento).filter((r) => Boolean(r.titulo) || Boolean(r.acto));
}

/** Una acción/acto individual dentro de un asiento. */
export interface AsientoAccion { acto: string; precio: string; montoPagado: string; participantes: string }
/** Un asiento registral (agrupado por su número de título AAAA-NNNNNN) con TODAS sus acciones. */
export interface AsientoGrupo {
  titulo: string | null;
  fechaPresentacion: string;
  fechaAsiento: string;
  acciones: AsientoAccion[];
  flags: AsientoFlags;
}

/**
 * Agrupa los registros por NÚMERO DE ASIENTO (título). Un mismo asiento puede registrar VARIAS
 * acciones que `parseAsientos` devuelve sueltas: dos compra-ventas en tracto sucesivo (CDK293,
 * título 2024-02723258) o una cancelación + una compra-venta (CHP605, 2025-00280600). Aquí se
 * colapsan en UN grupo (= un asiento), conservando el orden de aparición y OR-eando las banderas.
 *
 * Regla del reporte: se cuentan ASIENTOS, no acciones; los montos de un mismo asiento se muestran
 * POR SEPARADO (nunca se suman — no se asume que dos compra-ventas sean una sola operación).
 */
export function agruparAsientos(records: AsientoRecord[]): AsientoGrupo[] {
  const grupos: AsientoGrupo[] = [];
  const porTitulo = new Map<string, AsientoGrupo>();
  records.forEach((r, i) => {
    const key = r.titulo ?? `__sin_titulo_${i}`; // sin título → cada uno su propio grupo
    let g = porTitulo.get(key);
    if (!g) {
      g = {
        titulo: r.titulo, fechaPresentacion: r.fechaPresentacion, fechaAsiento: r.fechaAsiento,
        acciones: [], flags: { aseguradora: false, remate: false, financiera: false, gravamen: false, embargo: false },
      };
      porTitulo.set(key, g);
      grupos.push(g);
    }
    g.acciones.push({ acto: r.acto, precio: r.precio, montoPagado: r.montoPagado, participantes: r.participantes });
    (Object.keys(g.flags) as Array<keyof AsientoFlags>).forEach((k) => { if (r.flags?.[k]) g!.flags[k] = true; });
    if (!g.fechaPresentacion && r.fechaPresentacion) g.fechaPresentacion = r.fechaPresentacion;
    if (!g.fechaAsiento && r.fechaAsiento) g.fechaAsiento = r.fechaAsiento;
  });
  return grupos;
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
