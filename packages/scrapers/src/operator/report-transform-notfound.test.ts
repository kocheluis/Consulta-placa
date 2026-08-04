import { describe, it, expect } from 'vitest';
import { toWebReport } from './report-transform.js';
import type { OperatorSourceResult } from './index.js';

const AT = '2026-08-04T12:00:00.000Z';
const res = (source: string, status: OperatorSourceResult['status'], data?: Record<string, unknown>): OperatorSourceResult =>
  ({ source, label: source, category: 'OTRO', status, summary: '', ms: 1, ...(data ? { data } : {}) }) as OperatorSourceResult;

describe('toWebReport · placa inexistente (plateNotFound)', () => {
  it('SUNARP con data.plateNotFound → reporte mínimo con flag, sin vehículo', () => {
    const r = toWebReport('CRB759', [
      res('SUNARP', 'SIN_REGISTRO', { plateNotFound: true }),
      // aunque llegaran otras fuentes saltadas, se ignoran: el reporte se corta.
      res('SAT_PAPELETAS', 'SIN_REGISTRO', { plateNotFound: true }),
    ], AT, 'test');
    expect(r.plateNotFound).toBe(true);
    expect(r.vehicle).toBeNull();
    // No se arman secciones con datos reales (solo las COMING_SOON de fábrica); ninguna AVAILABLE.
    expect(r.sections.every((s) => s.status !== 'AVAILABLE')).toBe(true);
  });

  it('placa normal (SUNARP ENCONTRADO) → NO marca plateNotFound', () => {
    const r = toWebReport('ABC123', [res('SUNARP', 'ENCONTRADO', { brand: 'TOYOTA', ownerName: 'X' })], AT, 'test');
    expect(r.plateNotFound).toBeUndefined();
  });
});
