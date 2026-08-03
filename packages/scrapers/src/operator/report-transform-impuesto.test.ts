import { describe, it, expect } from 'vitest';
import { toWebReport } from './report-transform.js';
import { SectionKind, SectionStatus, type ImpuestoVehicularPayload } from '@app/shared';
import type { OperatorSourceResult } from './index.js';

// Consulta hecha en 2026 → los ejercicios afectos ya devengados se miden contra 2026.
const AT = '2026-07-30T12:00:00.000Z';
const res = (source: string, status: OperatorSourceResult['status'], data?: Record<string, unknown>): OperatorSourceResult =>
  ({ source, label: source, category: 'OTRO', status, summary: '', ms: 1, ...(data ? { data } : {}) }) as OperatorSourceResult;

/** Un ítem de timeline (AsientoRecord-like) con lo mínimo que consume el transform. */
const asiento = (titulo: string, acto: string, precio = ''): Record<string, unknown> =>
  ({ titulo, acto, precio, montoPagado: '', participantes: '', fechaPresentacion: '', fechaAsiento: '', flags: {} });

const impuestoOf = (results: OperatorSourceResult[]) =>
  toWebReport('ABC123', results, AT, 'test').sections.find((s) => s.kind === SectionKind.IMPUESTO_VEHICULAR);

describe('toWebReport · sección IMPUESTO_VEHICULAR (Capa A — derivada de la 1ª inscripción)', () => {
  it('1ª inscripción 2023 → AFECTO 2024-2026, cuota estimada 1% del valor declarado (USD)', () => {
    const s = impuestoOf([
      res('SUNARP', 'ENCONTRADO', { sede: 'LIMA' }),
      res('HISTORIAL', 'ENCONTRADO', {
        timeline: [asiento('2023-00170786', 'Primera Inscripción de Dominio', 'US$ 31,790.00')],
      }),
    ]);
    expect(s?.status).toBe(SectionStatus.AVAILABLE);
    const p = s?.payload as ImpuestoVehicularPayload;
    expect(p.afecto).toBe(true);
    expect(p.registrationYear).toBe(2023);
    expect(p.affectedYears).toEqual([2024, 2025, 2026]);
    expect(p.lastAffectedYear).toBe(2026);
    expect(p.dueYears).toEqual([2024, 2025, 2026]);
    expect(p.upcomingYears).toEqual([]);
    expect(p.estimatedAnnual).toBe(318); // 1% de 31 790, redondeado
    expect(p.estimatedCurrency).toBe('USD');
    expect(p.declaredValue).toBe('US$ 31,790.00');
    expect(p.registralOffice).toBe('LIMA');
  });

  it('1ª inscripción 2015 → INAFECTO (ya cumplió los 3 años)', () => {
    const s = impuestoOf([
      res('HISTORIAL', 'ENCONTRADO', { timeline: [asiento('2015-00098641', 'Primera Inscripción de Dominio', 'S/ 45,000.00')] }),
    ]);
    const p = s?.payload as ImpuestoVehicularPayload;
    expect(p.afecto).toBe(false);
    expect(p.registrationYear).toBe(2015);
    expect(p.affectedYears).toEqual([2016, 2017, 2018]);
    expect(p.estimatedCurrency).toBe('PEN');
  });

  it('sin "Primera Inscripción" explícita → usa el título MÁS ANTIGUO como aproximación', () => {
    const s = impuestoOf([
      res('HISTORIAL', 'ENCONTRADO', {
        timeline: [
          asiento('2024-00050000', 'Compra-Venta', 'US$ 20,000.00'),
          asiento('2022-00010000', 'Compra-Venta', 'US$ 25,000.00'),
        ],
      }),
    ]);
    const p = s?.payload as ImpuestoVehicularPayload;
    expect(p.registrationYear).toBe(2022); // el más antiguo
    expect(p.affectedYears).toEqual([2023, 2024, 2025]);
    expect(p.afecto).toBe(false); // 2026 > 2025
  });

  it('historial FALLÓ (ERROR) → sección UNAVAILABLE (depende del historial para el año)', () => {
    const s = impuestoOf([res('SUNARP', 'ENCONTRADO', { sede: 'LIMA' }), res('HISTORIAL', 'ERROR')]);
    expect(s?.status).toBe(SectionStatus.UNAVAILABLE);
  });
});
