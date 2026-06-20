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
      const names: string[] = [];
      if (value) names.push(value);
      for (let j = i + 1; j < lines.length; j++) {
        if (TIMESTAMP_RE.test(lines[j]!) || lines[j]!.includes(':')) break;
        names.push(lines[j]!);
      }
      owner = cleanValue(names.join(' '));
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
    serie: cleanValue(data.serie),
    vin: cleanValue(data.vin),
    engineNumber: cleanValue(data.motor),
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
