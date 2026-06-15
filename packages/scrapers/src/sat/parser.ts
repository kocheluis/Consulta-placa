import { parse } from 'node-html-parser';
import {
  SectionKind,
  SectionStatus,
  SourceId,
  type SourceResult,
  type PapeletasPayload,
  type PapeletaItem,
  type CapturaIndicator,
} from '@app/shared';

function money(v: string | undefined): number {
  if (!v) return 0;
  const n = Number.parseFloat(v.replace(/[^\d.,]/g, '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function txt(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t && t !== '-' ? t : null;
}

/**
 * Parser puro del SAT → dos secciones: PAPELETAS (récord de papeletas municipales)
 * y CAPTURA (orden de captura). Testeable contra fixtures.
 */
export function parseSat(html: string): SourceResult[] {
  const root = parse(html);
  const fetchedAt = new Date().toISOString();
  const container = root.querySelector('.sat-resultado');
  if (!container) {
    return [
      { kind: SectionKind.PAPELETAS, source: SourceId.SAT, status: SectionStatus.NOT_FOUND, fetchedAt },
      { kind: SectionKind.CAPTURA, source: SourceId.SAT, status: SectionStatus.NOT_FOUND, fetchedAt },
    ];
  }

  const items: PapeletaItem[] = [];
  for (const row of root.querySelectorAll('table.papeletas tbody tr')) {
    items.push({
      type: txt(row.querySelector('.tipo')?.text) ?? 'Papeleta',
      entity: 'SAT',
      date: txt(row.querySelector('.fecha')?.text),
      amount: money(row.querySelector('.monto')?.text),
      status: (txt(row.querySelector('.estado')?.text) ?? 'PENDIENTE').toUpperCase(),
    });
  }
  const pendingAmount =
    Math.round(items.filter((i) => i.status.startsWith('PEND')).reduce((a, i) => a + i.amount, 0) * 100) / 100;
  const papeletas: PapeletasPayload = { total: items.length, pendingAmount, items };

  const capturaNode = root.querySelector('.captura');
  const orden = (capturaNode?.getAttribute('data-orden') ?? 'NO').toUpperCase();
  const captura: CapturaIndicator = {
    hasCapture: orden === 'SI' || orden === 'SÍ',
    detail: txt(capturaNode?.text),
  };

  return [
    {
      kind: SectionKind.PAPELETAS,
      source: SourceId.SAT,
      status: SectionStatus.AVAILABLE,
      fetchedAt,
      payload: papeletas,
    },
    {
      kind: SectionKind.CAPTURA,
      source: SourceId.SAT,
      status: capturaNode ? SectionStatus.AVAILABLE : SectionStatus.UNAVAILABLE,
      fetchedAt: capturaNode ? fetchedAt : null,
      payload: capturaNode ? captura : undefined,
    },
  ];
}
