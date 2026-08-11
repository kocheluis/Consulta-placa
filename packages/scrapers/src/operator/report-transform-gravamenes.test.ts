import { describe, it, expect } from 'vitest';
import { toWebReport } from './report-transform.js';
import { SectionKind, SectionStatus, type GravamenesPayload } from '@app/shared';
import type { OperatorSourceResult } from './index.js';

const AT = '2026-08-11T12:00:00.000Z';
const res = (source: string, status: OperatorSourceResult['status'], data?: Record<string, unknown>): OperatorSourceResult =>
  ({ source, label: source, category: 'OTRO', status, summary: '', ms: 1, ...(data ? { data } : {}) }) as OperatorSourceResult;

const primera = (titulo: string): Record<string, unknown> =>
  ({ titulo, acto: 'Primera Inscripción de Dominio', precio: 'US$ 100,000.00', montoPagado: '', montoGravamen: '', participantes: '', observacion: '', fechaPresentacion: '22/11/2022', fechaAsiento: '', flags: {} });

// Garantía Mobiliaria inscrita en la PARTIDA VEHICULAR (Registro de Propiedad Vehicular). Caso BSY873:
// SCANIA SERVICES sobre la flota de OBRASCON. El monto de gravamen es en dólares.
const garantia = (titulo: string, montoGravamen = 'US$ 184,080.00'): Record<string, unknown> =>
  ({ titulo, acto: 'Constitución Garantía Mobiliaria y Otros Actos', precio: '', montoPagado: '', montoGravamen,
     participantes: 'Acreedor: SCANIA SERVICES DEL PERÚ S.A.', observacion: '', fechaPresentacion: '12/12/2022', fechaAsiento: '', flags: { gravamen: true } });

const cancelacion = (titulo: string): Record<string, unknown> =>
  ({ titulo, acto: 'Cancelación de Garantía Mobiliaria', precio: '', montoPagado: '', montoGravamen: '',
     participantes: 'Cancelación a solicitud del Acreedor', observacion: '', fechaPresentacion: '01/06/2024', fechaAsiento: '', flags: { gravamen: true } });

const gravOf = (results: OperatorSourceResult[]) =>
  toWebReport('BSY873', results, AT, 'test').sections.find((s) => s.kind === SectionKind.GRAVAMENES);

describe('toWebReport · sección GRAVÁMENES (SIGM/RMC ⊕ partida vehicular)', () => {
  it('SIGM SIN_REGISTRO NO tapa la garantía inscrita en la partida vehicular (BSY873)', () => {
    // El bug: un SIGM vacío suprimía el heurístico del historial → "Sin gravámenes" pese a la carga real.
    const s = gravOf([
      res('SUNARP', 'ENCONTRADO', { sede: 'LIMA' }),
      res('SIGM', 'SIN_REGISTRO'), // el RMC no lista la garantía sobre el vehículo (va en la partida)
      res('HISTORIAL', 'ENCONTRADO', { timeline: [primera('2022-03507846'), garantia('2022-03701158')] }),
    ]);
    expect(s?.status).toBe(SectionStatus.AVAILABLE);
    const p = s?.payload as GravamenesPayload;
    expect(p.hasLiens).toBe(true);
    expect(p.items).toHaveLength(1);
    expect(p.items[0]?.status).toBe('VIGENTE');
    expect(p.items[0]?.creditor).toContain('SCANIA SERVICES');
    // El monto conserva su MONEDA (dólares), no se pinta como S/.
    expect(p.items[0]?.amountLabel).toBe('US$ 184,080.00');
    expect(p.items[0]?.amount).toBeNull();
  });

  it('SIGM ENCONTRADO con cargas MANDA (trae el detalle del RMC)', () => {
    const s = gravOf([
      res('SIGM', 'ENCONTRADO', { hasLiens: true, items: [{ acreedor: 'BANCO X', amount: 50000, fechaInscripcion: '10/01/2023', ultimaOperacion: 'VIGENTE' }] }),
      res('HISTORIAL', 'ENCONTRADO', { timeline: [primera('2022-03507846'), garantia('2022-03701158')] }),
    ]);
    const p = s?.payload as GravamenesPayload;
    expect(s?.source).toBe('SIGM');
    expect(p.hasLiens).toBe(true);
    expect(p.items[0]?.amount).toBe(50000); // numérico del RMC (S/)
  });

  it('SIGM SIN_REGISTRO + garantía CANCELADA en la partida → sin carga vigente (LEVANTADO)', () => {
    const s = gravOf([
      res('SIGM', 'SIN_REGISTRO'),
      res('HISTORIAL', 'ENCONTRADO', { timeline: [primera('2022-03507846'), garantia('2022-03701158'), cancelacion('2024-01111111')] }),
    ]);
    const p = s?.payload as GravamenesPayload;
    expect(p.hasLiens).toBe(false);
    expect(p.items.every((it) => it.status === 'LEVANTADO')).toBe(true);
  });

  it('SIGM SIN_REGISTRO + historial sin cargas → sin gravámenes', () => {
    const s = gravOf([
      res('SIGM', 'SIN_REGISTRO'),
      res('HISTORIAL', 'ENCONTRADO', { timeline: [primera('2022-03507846')] }),
    ]);
    const p = s?.payload as GravamenesPayload;
    expect(s?.status).toBe(SectionStatus.AVAILABLE);
    expect(p.hasLiens).toBe(false);
    expect(p.items).toHaveLength(0);
  });
});
