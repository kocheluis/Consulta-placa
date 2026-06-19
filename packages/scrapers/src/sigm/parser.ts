import { parse } from 'node-html-parser';
import {
  SectionKind,
  SectionStatus,
  SourceId,
  type SourceResult,
  type GravamenItem,
  type GravamenesPayload,
} from '@app/shared';

function money(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number.parseFloat(v.replace(/[^\d.,]/g, '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function txt(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t && t !== '-' ? t : null;
}

/**
 * Parser puro de SIGM (Sistema Informativo de Garantías Mobiliarias, SUNARP) →
 * sección GRAVAMENES: prendas, garantías mobiliarias y embargos inscritos sobre
 * el vehículo. Crítico para el comprador: revela si el auto está en garantía de
 * un crédito (no se puede vender libre hasta levantar la carga).
 */
export function parseSigm(html: string): SourceResult[] {
  const root = parse(html);
  const fetchedAt = new Date().toISOString();
  const container = root.querySelector('.sigm-garantias');
  if (!container) {
    return [{ kind: SectionKind.GRAVAMENES, source: SourceId.SIGM, status: SectionStatus.NOT_FOUND, fetchedAt }];
  }

  const items: GravamenItem[] = [];
  for (const row of root.querySelectorAll('table.garantias tbody tr')) {
    items.push({
      type: txt(row.querySelector('.tipo')?.text) ?? 'Garantía mobiliaria',
      creditor: txt(row.querySelector('.acreedor')?.text),
      amount: money(row.querySelector('.monto')?.text),
      date: txt(row.querySelector('.fecha')?.text),
      status: (txt(row.querySelector('.estado')?.text) ?? 'VIGENTE').toUpperCase(),
    });
  }
  const declared = (container.getAttribute('data-tiene') ?? '').toUpperCase().startsWith('SI');
  const payload: GravamenesPayload = { hasLiens: declared || items.length > 0, total: items.length, items };

  return [
    {
      kind: SectionKind.GRAVAMENES,
      source: SourceId.SIGM,
      status: SectionStatus.AVAILABLE,
      fetchedAt,
      payload,
    },
  ];
}
