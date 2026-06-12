import { parse } from 'node-html-parser';
import {
  SectionKind,
  SectionStatus,
  SourceId,
  type SourceResult,
  type InsurancePolicy,
  type SiniestroIndicator,
} from '@app/shared';

const SINIESTRALIDAD_PERIOD_YEARS = 5;

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
 * Parser puro del reporte SBS → dos secciones: SEGUROS (póliza SOAT de los
 * últimos 5 años) y SINIESTRALIDAD (indicador de accidentes). Testeable contra
 * fixtures.
 */
export function parseSbs(html: string): SourceResult[] {
  const root = parse(html);
  const fetchedAt = new Date().toISOString();

  const container = root.querySelector('.reporte-soat');
  if (!container) {
    return [
      seccion(SectionKind.SEGUROS, SectionStatus.NOT_FOUND, fetchedAt),
      seccion(SectionKind.SINIESTRALIDAD, SectionStatus.NOT_FOUND, fetchedAt),
    ];
  }

  // Datos de póliza.
  const data = new Map<string, string>();
  for (const row of root.querySelectorAll('table.poliza tr')) {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 2) data.set(normLabel(cells[0]!.text), cells[1]!.text.trim());
  }
  const soatRaw = (data.get('soat') ?? '').toUpperCase();
  const hasActiveSoat = soatRaw.includes('VIGENTE') && !soatRaw.includes('NO VIGENTE');

  const policy: InsurancePolicy = {
    hasActiveSoat,
    insurer: cleanValue(data.get('compania') ?? data.get('compañia')),
    policyNumber: cleanValue(data.get('poliza') ?? data.get('póliza')),
    validFrom: cleanValue(data.get('vigencia desde')),
    validTo: cleanValue(data.get('vigencia hasta')),
  };

  // Siniestralidad.
  const sinNode = root.querySelector('.siniestralidad');
  const registra = (sinNode?.getAttribute('data-registra') ?? '').toUpperCase();
  const hasSiniestro = registra === 'SI' || registra === 'SÍ';
  const siniestro: SiniestroIndicator = {
    hasSiniestro,
    periodYears: SINIESTRALIDAD_PERIOD_YEARS,
  };

  return [
    {
      kind: SectionKind.SEGUROS,
      source: SourceId.SBS,
      status: SectionStatus.AVAILABLE,
      fetchedAt,
      payload: policy,
    },
    {
      kind: SectionKind.SINIESTRALIDAD,
      source: SourceId.SBS,
      status: sinNode ? SectionStatus.AVAILABLE : SectionStatus.UNAVAILABLE,
      fetchedAt: sinNode ? fetchedAt : null,
      payload: sinNode ? siniestro : undefined,
    },
  ];
}

function seccion(kind: SectionKind, status: SectionStatus, fetchedAt: string): SourceResult {
  return { kind, source: SourceId.SBS, status, fetchedAt: status === SectionStatus.NOT_FOUND ? fetchedAt : null };
}
