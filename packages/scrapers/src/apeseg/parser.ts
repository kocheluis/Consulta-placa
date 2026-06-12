import { parse } from 'node-html-parser';
import {
  SectionKind,
  SectionStatus,
  SourceId,
  type SourceResult,
  type InsurancePolicy,
} from '@app/shared';

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
  return t && t !== '-' ? t : null;
}

/**
 * Parser puro de la consulta SOAT de APESEG → sección SEGUROS. Actúa como fuente
 * complementaria/fallback de SBS para el estado del SOAT.
 */
export function parseApeseg(html: string): SourceResult[] {
  const root = parse(html);
  const fetchedAt = new Date().toISOString();

  const container = root.querySelector('.apeseg-soat');
  if (!container) {
    return [
      { kind: SectionKind.SEGUROS, source: SourceId.APESEG, status: SectionStatus.NOT_FOUND, fetchedAt },
    ];
  }

  const data = new Map<string, string>();
  for (const row of root.querySelectorAll('table tr')) {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 2) data.set(normLabel(cells[0]!.text), cells[1]!.text.trim());
  }

  const estado = (data.get('estado') ?? '').toUpperCase();
  const policy: InsurancePolicy = {
    hasActiveSoat: estado.includes('VIGENTE') && !estado.includes('NO VIGENTE'),
    insurer: cleanValue(data.get('aseguradora')),
    policyNumber: cleanValue(data.get('certificado') ?? data.get('poliza')),
    validFrom: cleanValue(data.get('vigencia desde')),
    validTo: cleanValue(data.get('vigencia hasta')),
  };

  return [
    {
      kind: SectionKind.SEGUROS,
      source: SourceId.APESEG,
      status: SectionStatus.AVAILABLE,
      fetchedAt,
      payload: policy,
    },
  ];
}
