import { parse } from 'node-html-parser';
import {
  SectionKind,
  SectionStatus,
  SourceId,
  type SourceResult,
  type VehicleData,
} from '@app/shared';

/** Normaliza una etiqueta a una clave estable (sin tildes, minúsculas). */
function normLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

function cleanValue(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t || t === '-') return null;
  return t;
}

/**
 * Parser puro del HTML de la consulta vehicular SUNARP → SourceResult REGISTRAL.
 * No usa red ni navegador: testeable contra fixtures.
 */
export function parseSunarp(html: string, plateDisplay: string): SourceResult[] {
  const root = parse(html);
  const fetchedAt = new Date().toISOString();

  const sinResultados = root.querySelector('.sin-resultados');
  if (sinResultados) {
    return [
      {
        kind: SectionKind.REGISTRAL,
        source: SourceId.SUNARP,
        status: SectionStatus.NOT_FOUND,
        fetchedAt,
      },
    ];
  }

  const rows = root.querySelectorAll('table.datos-vehiculo tr');
  const data = new Map<string, string>();
  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 2) {
      const label = normLabel(cells[0]!.text);
      const value = cells[1]!.text.trim();
      data.set(label, value);
    }
  }

  if (data.size === 0) {
    return [
      {
        kind: SectionKind.REGISTRAL,
        source: SourceId.SUNARP,
        status: SectionStatus.NOT_FOUND,
        fetchedAt,
      },
    ];
  }

  const yearRaw = cleanValue(data.get('ano fabricacion') ?? data.get('ano'));
  const stolenAlert = root.querySelector('.alerta-robo') !== null;

  const vehicle: Partial<VehicleData> = {
    plateDisplay,
    platePrevious: cleanValue(data.get('placa anterior')),
    brand: cleanValue(data.get('marca')),
    model: cleanValue(data.get('modelo')),
    year: yearRaw ? Number.parseInt(yearRaw, 10) : null,
    color: cleanValue(data.get('color')),
    serie: cleanValue(data.get('serie')),
    vin: cleanValue(data.get('vin')),
    engineNumber: cleanValue(data.get('motor')),
    stolenAlert,
  };

  const ownerName = cleanValue(data.get('propietario'));

  return [
    {
      kind: SectionKind.REGISTRAL,
      source: SourceId.SUNARP,
      status: SectionStatus.AVAILABLE,
      fetchedAt,
      vehicle,
      ownerName,
      payload: { stolenAlert },
    },
  ];
}
