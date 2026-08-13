import { describe, it, expect } from 'vitest';
import { formatPlacaSatt, parseSattRecord, histDniSignal } from './sources.js';
import { toWebReport } from './report-transform.js';
import { SectionKind, type PapeletasPayload } from '@app/shared';
import type { OperatorSourceResult } from './index.js';

/** innerText REAL del resultado KM_WEB_Record.asp (EGU-257, 13-ago-2026, sin papeletas). */
const SIN_PAPELETAS = `Servicio de Administración Tributaria de Trujillo - SATT
RECORD DE PAPELETAS POR PLACA
Emitido el : 13/08/2026 a las  00:57:37
 Imprimir
 Retornar
PLACA DEL VEHICULO: EGU-257
Afecta Fecha Papeleta Inf. Estado Obligado Total
 El propietario de la placa en consulta no presenta papeletas
 Total de Papeletas 0
S/. 0.00
Esta verificación de deuda corresponde solo al vehículo de placa EGU-257, El presente documento es válido al día de su emisión`;

/** Con papeletas (sintético, mismo layout de columnas del grid real). */
const CON_PAPELETAS = `RECORD DE PAPELETAS POR PLACA
Emitido el : 13/08/2026 a las  10:00:00
PLACA DEL VEHICULO: ABC-123
Afecta Fecha Papeleta Inf. Estado Obligado Total
SI 15/03/2025 T-0123456 M08 PENDIENTE PEREZ GARCIA JUAN 316.00
NO 02/11/2024 T-0098765 G40 CANCELADO PEREZ GARCIA JUAN 0.00
 Total de Papeletas 2
S/. 316.00`;

describe('formatPlacaSatt (el portal exige el guion)', () => {
  it('auto 3+3: EGU257 → EGU-257', () => expect(formatPlacaSatt('EGU257')).toBe('EGU-257'));
  it('moto 2+4: AC2399 → AC-2399 (ejemplo del placeholder del portal)', () => expect(formatPlacaSatt('AC2399')).toBe('AC-2399'));
  it('ya con guion / minúsculas → normaliza', () => expect(formatPlacaSatt('egu-257')).toBe('EGU-257'));
});

describe('parseSattRecord', () => {
  it('sin papeletas: none=true, count=0, total=0 (y NO confunde "Emitido el" con una fila)', () => {
    const r = parseSattRecord(SIN_PAPELETAS);
    expect(r.none).toBe(true);
    expect(r.count).toBe(0);
    expect(r.total).toBe(0);
    expect(r.detalle).toHaveLength(0);
  });

  it('con papeletas: count/total del pie + filas ancladas por fecha+importe', () => {
    const r = parseSattRecord(CON_PAPELETAS);
    expect(r.none).toBe(false);
    expect(r.count).toBe(2);
    expect(r.total).toBe(316);
    expect(r.detalle).toHaveLength(2);
    expect(r.detalle[0]).toMatchObject({ fecha: '15/03/2025', numero: 'T-0123456', infraccion: 'M08', monto: 316, estado: 'PENDIENTE' });
    expect(r.detalle[1]?.estado).toBe('CANCELADO');
  });
});

describe('histDniSignal (DNI del historial para el registro del SATT)', () => {
  it('persona natural → primer DNI del timeline', () => {
    expect(histDniSignal({ timeline: [
      { participantes: 'Deudor: OBRASCON HUARTE RUC 20425123115' },
      { participantes: 'PERSONA NATURAL CHUQUIPIONDO RAYMUNDO JULIO ABEL DNI 08701061 Soltero' },
    ] })).toBe('08701061');
  });
  it('solo empresas (RUC) → null (usará la identidad del env)', () => {
    expect(histDniSignal({ timeline: [{ participantes: 'SCANIA SERVICES DEL PERÚ S.A. RUC 2039293277' }] })).toBeNull();
  });
  it('historial caído → null', () => expect(histDniSignal(null)).toBeNull());
});

describe('toWebReport · PAPELETAS con SATT Trujillo', () => {
  const AT = '2026-08-13T12:00:00.000Z';
  const res = (source: string, status: OperatorSourceResult['status'], data?: Record<string, unknown>): OperatorSourceResult =>
    ({ source, label: source, category: 'PAPELETAS', status, summary: '', ms: 1, ...(data ? { data } : {}) }) as OperatorSourceResult;
  const papeletasOf = (results: OperatorSourceResult[]): PapeletasPayload =>
    toWebReport('ABC123', results, AT, 'test').sections.find((s) => s.kind === SectionKind.PAPELETAS)?.payload as PapeletasPayload;

  it('SATT ENCONTRADO suma al total, al monto y a los ámbitos consultados', () => {
    const p = papeletasOf([
      res('SAT_PAPELETAS', 'SIN_REGISTRO'),
      res('CALLAO_PAPELETAS', 'SIN_REGISTRO'),
      res('SATT_PAPELETAS', 'ENCONTRADO', { total: 316, count: 2 }),
    ]);
    expect(p.total).toBe(1); // 1 jurisdicción con papeletas
    expect(p.count).toBe(2);
    expect(p.pendingAmount).toBe(316);
    expect(p.items[0]).toMatchObject({ entity: 'SATT Trujillo' });
    expect(p.checkedScopes).toEqual(['Lima (SAT)', 'Callao', 'Trujillo (SATT)']);
  });

  it('SATT SIN_REGISTRO: sin papeletas pero el ámbito Trujillo figura como consultado', () => {
    const p = papeletasOf([res('SATT_PAPELETAS', 'SIN_REGISTRO')]);
    expect(p.total).toBe(0);
    expect(p.checkedScopes).toEqual(['Trujillo (SATT)']);
  });
});
