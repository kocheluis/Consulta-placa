import { parse } from 'node-html-parser';
import {
  SectionKind,
  SectionStatus,
  SourceId,
  type SourceResult,
  type PapeletasPayload,
  type PapeletaItem,
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
 * Parser puro de SUTRAN (cinemómetro) → sección PAPELETAS con las infracciones
 * por exceso de velocidad en carreteras nacionales. Misma sección que SAT,
 * fuente distinta; el ensamblado las fusiona.
 */
export function parseSutran(html: string): SourceResult[] {
  const root = parse(html);
  const fetchedAt = new Date().toISOString();
  const container = root.querySelector('.sutran-cinemometro');
  if (!container) {
    return [{ kind: SectionKind.PAPELETAS, source: SourceId.SUTRAN, status: SectionStatus.NOT_FOUND, fetchedAt }];
  }

  const items: PapeletaItem[] = [];
  for (const row of root.querySelectorAll('table.papeletas tbody tr')) {
    items.push({
      type: txt(row.querySelector('.tipo')?.text) ?? 'Exceso de velocidad (cinemómetro)',
      entity: 'SUTRAN',
      date: txt(row.querySelector('.fecha')?.text),
      amount: money(row.querySelector('.monto')?.text),
      status: (txt(row.querySelector('.estado')?.text) ?? 'PENDIENTE').toUpperCase(),
    });
  }
  const pendingAmount =
    Math.round(items.filter((i) => i.status.startsWith('PEND')).reduce((a, i) => a + i.amount, 0) * 100) / 100;
  const papeletas: PapeletasPayload = { total: items.length, pendingAmount, items };

  return [
    {
      kind: SectionKind.PAPELETAS,
      source: SourceId.SUTRAN,
      status: SectionStatus.AVAILABLE,
      fetchedAt,
      payload: papeletas,
    },
  ];
}
