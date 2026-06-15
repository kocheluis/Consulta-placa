import { parse } from 'node-html-parser';
import {
  SectionKind,
  SectionStatus,
  SourceId,
  type SourceResult,
  type TransporteInfo,
} from '@app/shared';

function normLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}
function cleanValue(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t && t !== '-' ? t : null;
}

/**
 * Parser puro de ATU → sección TRANSPORTE: indica si el vehículo está/estuvo
 * registrado para servicio de taxi/transporte (uso intensivo).
 */
export function parseAtu(html: string): SourceResult[] {
  const root = parse(html);
  const fetchedAt = new Date().toISOString();
  const container = root.querySelector('.atu-resultado');
  if (!container) {
    return [{ kind: SectionKind.TRANSPORTE, source: SourceId.ATU, status: SectionStatus.NOT_FOUND, fetchedAt }];
  }

  const reg = (container.getAttribute('data-registrado') ?? 'NO').toUpperCase();
  const data = new Map<string, string>();
  for (const row of root.querySelectorAll('table.datos tr')) {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 2) data.set(normLabel(cells[0]!.text), cells[1]!.text.trim());
  }
  const payload: TransporteInfo = {
    isPublicTransport: reg === 'SI' || reg === 'SÍ',
    modality: cleanValue(data.get('modalidad')),
    detail: cleanValue(data.get('detalle') ?? data.get('empresa')),
  };

  return [
    {
      kind: SectionKind.TRANSPORTE,
      source: SourceId.ATU,
      status: SectionStatus.AVAILABLE,
      fetchedAt,
      payload,
    },
  ];
}
