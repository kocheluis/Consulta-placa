import { parse } from 'node-html-parser';
import {
  SectionKind,
  SectionStatus,
  SourceId,
  type SourceResult,
  type RevisionTecnica,
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
 * Parser puro de la revisión técnica vehicular (MTC / SINARETT) →
 * sección REVISION_TECNICA.
 */
export function parseMtc(html: string): SourceResult[] {
  const root = parse(html);
  const fetchedAt = new Date().toISOString();
  const container = root.querySelector('.mtc-rt');
  if (!container) {
    return [{ kind: SectionKind.REVISION_TECNICA, source: SourceId.MTC, status: SectionStatus.NOT_FOUND, fetchedAt }];
  }

  const data = new Map<string, string>();
  for (const row of root.querySelectorAll('table.datos tr')) {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 2) data.set(normLabel(cells[0]!.text), cells[1]!.text.trim());
  }
  const status = cleanValue(data.get('estado'));
  const up = (status ?? '').toUpperCase();
  const payload: RevisionTecnica = {
    hasValid: up.includes('VIGENTE') && !up.includes('VENCID'),
    status,
    lastInspection: cleanValue(data.get('ultima revision') ?? data.get('ultima')),
    validUntil: cleanValue(data.get('vigencia hasta') ?? data.get('vence')),
    result: cleanValue(data.get('resultado')),
  };

  return [
    {
      kind: SectionKind.REVISION_TECNICA,
      source: SourceId.MTC,
      status: SectionStatus.AVAILABLE,
      fetchedAt,
      payload,
    },
  ];
}
