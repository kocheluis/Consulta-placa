import { describe, it, expect } from 'vitest';
import { toWebReport } from './report-transform.js';
import { SectionKind, SectionStatus, SourceId, type GnvPayload } from '@app/shared';
import type { OperatorSourceResult } from './index.js';

const AT = '2026-07-30T12:00:00.000Z';
const res = (source: string, status: OperatorSourceResult['status'], data?: Record<string, unknown>): OperatorSourceResult =>
  ({ source, label: source, category: 'GNV', status, summary: '', ms: 1, ...(data ? { data } : {}) }) as OperatorSourceResult;
const gnvOf = (results: OperatorSourceResult[]) => {
  const r = toWebReport('ABC123', results, AT, 'test');
  return r.sections.find((s) => s.kind === SectionKind.GNV);
};

describe('toWebReport · sección GNV (FISE + Infogas, gated por combustible)', () => {
  it('gate-skip (vehículo NO a gas, data.aplicable=false) → AVAILABLE con applies:false', () => {
    const s = gnvOf([
      res('FISE_GNV', 'SIN_REGISTRO', { aplicable: false, fuel: 'GASOLINA' }),
      res('INFOGAS_GNV', 'SIN_REGISTRO', { aplicable: false, fuel: 'GASOLINA' }),
    ]);
    expect(s?.status).toBe(SectionStatus.AVAILABLE);
    expect((s?.payload as GnvPayload).applies).toBe(false);
  });

  it('vehículo gas CON deuda FISE + estado Infogas → combina ambos en un payload', () => {
    const s = gnvOf([
      res('FISE_GNV', 'ENCONTRADO', { tieneDeuda: true, pendiente: 850.5, vencido: 120, financiamiento: 2500, pagado: 1649.5 }),
      res('INFOGAS_GNV', 'ENCONTRADO', { combustible: 'GNV', tieneCredito: true, vencimientoCilindro: '12/2027', vencimientoRevision: '03/2027', habilitado: 'SÍ' }),
    ]);
    expect(s?.status).toBe(SectionStatus.AVAILABLE);
    const p = s?.payload as GnvPayload;
    expect(p.applies).toBe(true);
    expect(p.hasDebt).toBe(true);
    expect(p.debtPending).toBe(850.5);
    expect(p.debtOverdue).toBe(120);
    expect(p.hasCredit).toBe(true);
    expect(p.fuel).toBe('GNV');
    expect(p.cylinderExpiry).toBe('12/2027');
    expect(s?.source).toBe(SourceId.FISE);
  });

  it('vehículo gas SIN crédito (FISE SIN_REGISTRO real, sin flag aplicable) → hasDebt:false', () => {
    const s = gnvOf([
      res('FISE_GNV', 'SIN_REGISTRO', {}),
      res('INFOGAS_GNV', 'ENCONTRADO', { combustible: 'GNV', tieneCredito: false }),
    ]);
    const p = s?.payload as GnvPayload;
    expect(p.applies).toBe(true);
    expect(p.hasDebt).toBe(false);
    expect(p.hasCredit).toBe(false);
  });

  it('ambas fuentes ERROR → UNAVAILABLE (la web ofrece reintentar)', () => {
    const s = gnvOf([res('FISE_GNV', 'ERROR'), res('INFOGAS_GNV', 'ERROR')]);
    expect(s?.status).toBe(SectionStatus.UNAVAILABLE);
  });

  it('sin resultados GNV → la sección queda COMING_SOON (reportes viejos / BASIC)', () => {
    const s = gnvOf([]);
    expect(s?.status).toBe(SectionStatus.COMING_SOON);
  });
});
