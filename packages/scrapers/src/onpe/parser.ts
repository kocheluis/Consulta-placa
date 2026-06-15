import { parse } from 'node-html-parser';
import {
  SectionKind,
  SectionStatus,
  SourceId,
  type SourceResult,
  type MultasElectorales,
} from '@app/shared';

function normLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}
function money(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number.parseFloat(v.replace(/[^\d.,]/g, '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * Parser puro de ONPE → sección MULTAS_ELECTORALES (por DNI del titular).
 * Solo se consulta con consentimiento del propietario.
 */
export function parseOnpe(html: string): SourceResult[] {
  const root = parse(html);
  const fetchedAt = new Date().toISOString();
  const container = root.querySelector('.onpe-multas');
  if (!container) {
    return [
      { kind: SectionKind.MULTAS_ELECTORALES, source: SourceId.ONPE, status: SectionStatus.NOT_FOUND, fetchedAt },
    ];
  }

  const tiene = (container.getAttribute('data-tiene') ?? 'NO').toUpperCase();
  const hasFine = tiene === 'SI' || tiene === 'SÍ';
  const data = new Map<string, string>();
  for (const row of root.querySelectorAll('table.datos tr')) {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 2) data.set(normLabel(cells[0]!.text), cells[1]!.text.trim());
  }
  const payload: MultasElectorales = {
    hasFine,
    amount: hasFine ? money(data.get('monto')) : null,
    detail: (data.get('detalle') ?? '').trim() || null,
  };

  return [
    {
      kind: SectionKind.MULTAS_ELECTORALES,
      source: SourceId.ONPE,
      status: SectionStatus.AVAILABLE,
      fetchedAt,
      payload,
    },
  ];
}
