import { describe, it, expect } from 'vitest';
import { toWebReport } from './report-transform.js';

const r = (source: string, status: string, data: Record<string, unknown> = {}) => ({ source, label: source, category: 'PAPELETAS', status, summary: '', ms: 1, data });

describe('papeletas: tabla de resultado por SAT', () => {
  it('una fila por SAT consultada (con, sin y con error), en orden fijo', () => {
    const rep = toWebReport('AAA111', [
      r('SAT_PAPELETAS', 'SIN_REGISTRO'),
      r('CALLAO_PAPELETAS', 'ENCONTRADO', { total: '120.00', count: 2, benefit: 12, benefitUntil: '23/11/2026' }),
      r('SATP_PAPELETAS', 'SIN_REGISTRO'),
      r('SATCAJ_PAPELETAS', 'ERROR'),
      r('SATCH_PAPELETAS', 'ENCONTRADO', { total: 400, count: 1, estimado: true }),
    ], '2026-11-07T00:00:00Z', 'x');
    const p = (rep.sections.find((s) => s.kind === 'PAPELETAS') as unknown as { payload: { porSat: Array<Record<string, unknown>> } }).payload;
    expect(p.porSat.map((f) => [f.entity, f.status, f.count, f.amount])).toEqual([
      ['SAT Lima', 'SIN_PAPELETAS', 0, 0],
      ['SAT Callao', 'CON_PAPELETAS', 2, 120],
      ['SAT Piura', 'SIN_PAPELETAS', 0, 0],
      ['SAT Chiclayo', 'CON_PAPELETAS', 1, 400],
      ['SAT Cajamarca', 'ERROR', null, null],
    ]);
    expect(p.porSat[1]!.note).toBe('Con beneficio de pronto pago: S/ 12.00 hasta 23/11/2026');
    expect(p.porSat[3]!.estimado).toBe(true);
  });
});
