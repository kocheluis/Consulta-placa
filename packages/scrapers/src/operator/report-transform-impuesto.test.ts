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

  it('CHU444: compra-venta NOTARIAL 30/12/2023 (inscrita 2024) → los 3 años afectos son del titular actual', () => {
    const s = impuestoOf([
      res('SUNARP', 'ENCONTRADO', { sede: 'LIMA' }),
      res('HISTORIAL', 'ENCONTRADO', {
        timeline: [
          asiento('2023-00099999', 'Primera Inscripción de Dominio', 'US$ 20,000.00'),
          // La fecha NOTARIAL (documentos[].fecha=30/12/2023) manda sobre la de inscripción (2024).
          { titulo: '2024-00205606', acto: 'Compra-Venta', precio: 'US$ 5,550.00', montoPagado: '', participantes: '', fechaPresentacion: '22/01/2024', fechaAsiento: '28/01/2024', flags: {}, documentos: [{ documento: 'Acta Notarial', funcionario: 'X', fecha: '30/12/2023' }] },
        ],
      }),
    ]);
    const p = s?.payload as ImpuestoVehicularPayload;
    expect(p.registrationYear).toBe(2023);
    expect(p.currentOwnerSince).toBe('30/12/2023');
    expect(p.affectedYears).toEqual([2024, 2025, 2026]);
    // Adquirió 30/12/2023 → dueño al 1-ene de 2024/25/26 → los 3 años son suyos.
    expect(p.breakdown.map((b) => b.obligado)).toEqual(['titular', 'titular', 'titular']);
  });

  it('transferencia posterior (jun-2025) → 2024/2025 son de dueño ANTERIOR; 2026 del titular', () => {
    const s = impuestoOf([
      res('HISTORIAL', 'ENCONTRADO', {
        timeline: [
          asiento('2023-00099999', 'Primera Inscripción de Dominio', 'US$ 20,000.00'),
          { titulo: '2025-00300000', acto: 'Compra-Venta', precio: 'US$ 8,000.00', montoPagado: '', participantes: '', fechaPresentacion: '10/06/2025', fechaAsiento: '15/06/2025', flags: {}, documentos: [{ documento: 'Escritura', funcionario: 'X', fecha: '05/06/2025' }] },
        ],
      }),
    ]);
    const p = s?.payload as ImpuestoVehicularPayload;
    expect(p.currentOwnerSince).toBe('05/06/2025');
    expect(p.breakdown.map((b) => `${b.year}:${b.obligado}`)).toEqual(['2024:anterior', '2025:anterior', '2026:titular']);
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

  it('mapea la validación SAT (Capa B) a payload.sat', () => {
    const s = impuestoOf([
      res('HISTORIAL', 'ENCONTRADO', { timeline: [asiento('2023-00099999', 'Primera Inscripción de Dominio', 'US$ 20,000.00')] }),
      res('SAT_IMPUESTO', 'ENCONTRADO', {
        found: true, pendingTotal: 193.96, pendingCount: 2, paidYears: [2024, 2025], pendingYears: [2026],
        cuotas: [
          { year: 2026, cuota: '3', total: 96.98, pagado: 0, deuda: 96.98, vencimiento: '31/08/2026', estado: 'pendiente' },
          { year: 2024, cuota: '1', total: 0, pagado: 119.44, deuda: 0, vencimiento: '29/02/2024', estado: 'pagado' },
        ],
      }),
    ]);
    const p = s?.payload as ImpuestoVehicularPayload;
    expect(p.sat?.found).toBe(true);
    expect(p.sat?.pendingTotal).toBe(193.96);
    expect(p.sat?.pendingYears).toEqual([2026]);
    expect(p.sat?.cuotas.find((c) => c.estado === 'pendiente')?.amount).toBe(96.98); // deuda
    expect(p.sat?.cuotas.find((c) => c.estado === 'pagado')?.amount).toBe(119.44); // pagado
  });

  it('sin fuente SAT → payload.sat = null (solo estimado Capa A)', () => {
    const s = impuestoOf([res('HISTORIAL', 'ENCONTRADO', { timeline: [asiento('2023-00099999', 'Primera Inscripción de Dominio', 'US$ 20,000.00')] })]);
    expect((s?.payload as ImpuestoVehicularPayload).sat).toBeNull();
  });

  it('historial FALLÓ (ERROR) → sección UNAVAILABLE (depende del historial para el año)', () => {
    const s = impuestoOf([res('SUNARP', 'ENCONTRADO', { sede: 'LIMA' }), res('HISTORIAL', 'ERROR')]);
    expect(s?.status).toBe(SectionStatus.UNAVAILABLE);
  });
});
