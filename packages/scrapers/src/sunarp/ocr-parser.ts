import {
  SectionKind,
  SectionStatus,
  SourceId,
  type SourceResult,
  type VehicleData,
} from '@app/shared';

/**
 * Parser del TEXTO OCR del certificado de SUNARP.
 *
 * SUNARP devuelve los datos del vehículo como una IMAGEN (PNG en `model.imagen`
 * del endpoint getDatosVehiculo), no como HTML — es anti-scraping. El scraper
 * pasa esa imagen por OCR (tesseract) y este parser convierte el texto en datos.
 *
 * Tolera el ruido típico del OCR en el prefijo "Nº" (que se lee como N9/No/NC)
 * mapeando cada fila por la palabra clave de su etiqueta, no por coincidencia exacta.
 */

const deaccent = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

function cleanValue(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t && t !== '-' ? t : null;
}

/** Trata valores "vacíos" de SUNARP (NINGUNA, etc.) como sin dato. */
function cleanStrict(v: string | undefined): string | null {
  const t = cleanValue(v);
  if (!t) return null;
  const n = deaccent(t).toLowerCase();
  return ['ninguna', 'ninguno', 'no registra', 's/n'].includes(n) ? null : t;
}

// Confusiones de glifo del OCR en identificadores (serie/VIN/motor). En la tipografía de la
// tarjeta de SUNARP la LETRA "J" se lee a veces como paréntesis — validado a mano: "…4575)4002451"
// era "…4575J4002451". Ambos paréntesis mapean a J (misma letra, curvatura opuesta).
const OCR_IDENT_FIX: Record<string, string> = { ')': 'J', '(': 'J' };

/**
 * Normaliza un identificador alfanumérico (serie/VIN/motor): SIEMPRE es letras y números,
 * nunca símbolos. Corrige las confusiones conocidas del OCR (paréntesis→J) y elimina cualquier
 * otro símbolo restante, para que estos campos nunca muestren signos raros al usuario.
 */
function cleanIdent(v: string | undefined): string | null {
  const t = cleanValue(v);
  if (!t) return null;
  const fixed = t
    .toUpperCase()
    .replace(/[()]/g, (c) => OCR_IDENT_FIX[c] ?? '')
    .replace(/[^A-Z0-9]/g, ''); // fuera guiones/espacios/otros símbolos que el OCR pudo inventar
  return fixed || null;
}

/** Una línea que empieza con fecha dd/mm/aaaa = pie del certificado, no un dato. */
const TIMESTAMP_RE = /^\d{1,2}\/\d{1,2}\/\d{4}/;

export function parseSunarpOcr(ocrText: string, plateDisplay: string): SourceResult[] {
  const fetchedAt = new Date().toISOString();
  const lines = ocrText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const data: Record<string, string> = {};
  let owner: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const label = deaccent(line.slice(0, colon)).toLowerCase();
    const value = line.slice(colon + 1).trim();

    // El/los propietario(s) van en la(s) línea(s) siguientes (hasta el pie).
    if (label.includes('propietario')) {
      const rawLines: string[] = [];
      if (value) rawLines.push(value);
      for (let j = i + 1; j < lines.length; j++) {
        if (TIMESTAMP_RE.test(lines[j]!) || lines[j]!.includes(':')) break;
        rawLines.push(lines[j]!);
      }
      // Cada propietario va en su PROPIA línea ("APELLIDOS, NOMBRES" → una coma). Se conservan como
      // dueños SEPARADOS (una línea sin coma es continuación del anterior por wrap del OCR → se une) y
      // se juntan con " / " para que el reporte muestre cada propietario aparte (antes: todo en 1 línea).
      const owners: string[] = [];
      for (const n of rawLines.map((s) => cleanValue(s)).filter((x): x is string => !!x)) {
        const prev = owners[owners.length - 1];
        if (prev && !prev.includes(',')) owners[owners.length - 1] = `${prev} ${n}`;
        else owners.push(n);
      }
      owner = owners.length ? owners.join(' / ') : null;
      continue;
    }

    // Mapear etiqueta -> clave por palabra clave (el orden desambigua placa/año).
    let key: string | null = null;
    if (label.includes('placa anterior')) key = 'placaAnterior';
    else if (label.includes('placa vigente')) key = 'placaVigente';
    else if (label.includes('placa')) key = 'placa';
    else if (label.includes('serie')) key = 'serie';
    else if (label.includes('vin')) key = 'vin';
    else if (label.includes('motor')) key = 'motor';
    else if (label.includes('color')) key = 'color';
    else if (label.includes('marca')) key = 'marca';
    // "anotacion" antes que "ano": la palabra ANOTACIONES contiene "ano".
    else if (label.includes('anotacion')) key = 'anotaciones';
    else if (label.includes('ano')) key = 'ano'; // "año de modelo" antes que "modelo"
    else if (label.includes('modelo')) key = 'modelo';
    else if (label.includes('estado')) key = 'estado';
    else if (label.includes('sede')) key = 'sede';
    if (key && value) data[key] = value;
  }

  if (Object.keys(data).length === 0 && !owner) {
    return [{ kind: SectionKind.REGISTRAL, source: SourceId.SUNARP, status: SectionStatus.NOT_FOUND, fetchedAt }];
  }

  const yearDigits = (cleanValue(data.ano) ?? '').replace(/[^0-9]/g, '');
  const year = yearDigits ? Number.parseInt(yearDigits, 10) : NaN;
  const annotations = cleanStrict(data.anotaciones);
  const registralStatus = cleanValue(data.estado);
  const stolenAlert = /robo|captura|requisitor/i.test(`${annotations ?? ''} ${registralStatus ?? ''}`);

  const vehicle: Partial<VehicleData> = {
    plateDisplay,
    platePrevious: cleanStrict(data.placaAnterior),
    brand: cleanValue(data.marca),
    model: cleanValue(data.modelo),
    year: Number.isFinite(year) ? year : null,
    color: cleanValue(data.color),
    serie: cleanIdent(data.serie),
    vin: cleanIdent(data.vin),
    engineNumber: cleanIdent(data.motor),
    registralStatus,
    annotations,
    sede: cleanValue(data.sede),
    stolenAlert,
  };

  return [
    {
      kind: SectionKind.REGISTRAL,
      source: SourceId.SUNARP,
      status: SectionStatus.AVAILABLE,
      fetchedAt,
      vehicle,
      ownerName: owner,
      payload: { stolenAlert },
    },
  ];
}
