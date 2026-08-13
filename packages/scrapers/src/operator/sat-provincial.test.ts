import { describe, it, expect } from 'vitest';
import { parseSatpPapeletas, parseSatchRows, normalizeInfraccion, RNTV_MULTA } from './sources.js';
import { toWebReport } from './report-transform.js';
import { SectionKind, type PapeletasPayload } from '@app/shared';
import type { OperatorSourceResult } from './index.js';

describe('SAT Piura (SATP) · parseSatpPapeletas', () => {
  it('con multas: cantidad + monto total del pie (P2B937 real)', () => {
    const r = parseSatpPapeletas('… CANTIDAD DE PAPELETAS 6 MONTO TOTAL DE LA DEUDA S/ 9,152.40 Placa: P2B937');
    expect(r.none).toBe(false);
    expect(r.count).toBe(6);
    expect(r.total).toBe(9152.40);
  });
  it('sin multas: none=true', () => {
    expect(parseSatpPapeletas('El contribuyente con placa CHU444 no presenta papeletas registradas.').none).toBe(true);
  });
});

describe('normalizeInfraccion (RNTV)', () => {
  it('G-58 → G58, M.27 → M27, L 4 → L04', () => {
    expect(normalizeInfraccion('G-58')).toBe('G58');
    expect(normalizeInfraccion('M.27')).toBe('M27');
    expect(normalizeInfraccion('L 4')).toBe('L04');
  });
  it('código inválido → null', () => expect(normalizeInfraccion('XYZ')).toBeNull());
  it('el mapa tiene los códigos clave con montos coherentes', () => {
    expect(RNTV_MULTA.G58).toBe(440); // grave
    expect(RNTV_MULTA.L04).toBe(220); // leve
    expect(RNTV_MULTA.M27).toBe(2750); // muy grave
  });
});

describe('SAT Chiclayo (SATCH) · parseSatchRows', () => {
  // [placa, nro, fecha, infractor, propietario, infraccion, estado]
  const row = (nro: string, fecha: string, code: string, estado: string): string[] =>
    ['M2G119', nro, fecha, 'NOMBRE INFRACTOR', 'NOMBRE PROPIETARIO', code, estado];

  it('todas canceladas → pending 0 (M2G119 real)', () => {
    const r = parseSatchRows([
      row('10000550649', '02/02/2013', 'G-58', 'Canc.'),
      row('10000648166', '22/09/2014', 'G-20', 'Canc.'),
    ]);
    expect(r.total).toBe(2);
    expect(r.pending).toBe(0);
    expect(r.estimate).toBe(0);
    expect(r.detalle).toHaveLength(0); // no expone nada (todas pagadas + PII)
  });

  it('pendientes → estima el monto por RNTV y NO incluye nombres (PII)', () => {
    const r = parseSatchRows([
      row('1', '01/01/2025', 'G-58', 'Pendiente'), // 440
      row('2', '02/01/2025', 'M-27', 'Pendiente'), // 2750
      row('3', '03/01/2025', 'L-04', 'Canc.'),     // cancelada → no cuenta
    ]);
    expect(r.pending).toBe(2);
    expect(r.estimate).toBe(3190); // 440 + 2750
    expect(r.detalle).toHaveLength(2);
    expect(JSON.stringify(r.detalle)).not.toContain('NOMBRE'); // sin infractor/propietario
    expect(r.detalle[0]).toMatchObject({ numero: '1', infraccion: 'G-58', monto: 440 });
  });
});

describe('toWebReport · PAPELETAS con SATP y SATCH', () => {
  const AT = '2026-08-13T12:00:00.000Z';
  const res = (source: string, status: OperatorSourceResult['status'], data?: Record<string, unknown>): OperatorSourceResult =>
    ({ source, label: source, category: 'PAPELETAS', status, summary: '', ms: 1, ...(data ? { data } : {}) }) as OperatorSourceResult;
  const papeletasOf = (results: OperatorSourceResult[]): PapeletasPayload =>
    toWebReport('ABC123', results, AT, 'test').sections.find((s) => s.kind === SectionKind.PAPELETAS)?.payload as PapeletasPayload;

  it('las 5 jurisdicciones se agregan (Lima/Callao/Trujillo/Piura/Chiclayo)', () => {
    const p = papeletasOf([
      res('SAT_PAPELETAS', 'SIN_REGISTRO'),
      res('CALLAO_PAPELETAS', 'SIN_REGISTRO'),
      res('SATT_PAPELETAS', 'SIN_REGISTRO'),
      res('SATP_PAPELETAS', 'ENCONTRADO', { total: 9152.40, count: 6 }),
      res('SATCH_PAPELETAS', 'ENCONTRADO', { total: 3190, count: 2, estimado: true }),
    ]);
    expect(p.checkedScopes).toEqual(['Lima (SAT)', 'Callao', 'Trujillo (SATT)', 'Piura (SATP)', 'Chiclayo (SATCH)']);
    expect(p.count).toBe(8); // 6 + 2
    expect(p.pendingAmount).toBe(12342.40); // 9152.40 + 3190
    expect(p.items.map((i) => i.entity)).toEqual(['SAT Piura', 'SAT Chiclayo']);
    expect(p.items.find((i) => i.entity === 'SAT Chiclayo')?.type).toContain('estimado');
  });
});
