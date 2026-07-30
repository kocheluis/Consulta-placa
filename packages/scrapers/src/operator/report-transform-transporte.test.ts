import { describe, it, expect } from 'vitest';
import { toWebReport } from './report-transform.js';
import { SectionKind, SectionStatus, SourceId, type TransporteInfo } from '@app/shared';
import type { OperatorSourceResult } from './index.js';

const AT = '2026-07-30T12:00:00.000Z';
const res = (source: string, status: OperatorSourceResult['status'], data?: Record<string, unknown>): OperatorSourceResult =>
  ({ source, label: source, category: 'X', status, summary: '', ms: 1, ...(data ? { data } : {}) }) as OperatorSourceResult;
const transpOf = (results: OperatorSourceResult[]) =>
  toWebReport('ABC123', results, AT, 't').sections.find((s) => s.kind === SectionKind.TRANSPORTE);

const histCon = (usage: string, category: string): OperatorSourceResult =>
  res('HISTORIAL', 'ENCONTRADO', { timeline: [], titulos: [], flags: {}, caracteristicas: { usage, category, fuel: 'GASOLINA' } });

describe('toWebReport · TRANSPORTE / uso público (señal registral + ATU)', () => {
  it('tipo de uso PÚBLICO en el asiento → marca servicio público aunque ATU no corra', () => {
    const s = transpOf([histCon('Taxis y Colectivos (Categoría M1)', 'M1')]);
    expect(s?.status).toBe(SectionStatus.AVAILABLE);
    expect(s?.source).toBe(SourceId.SUNARP); // sin ATU, la señal registral basta
    const t = s?.payload as TransporteInfo;
    expect(t.isPublicTransport).toBe(true);
    expect(t.registralPublicUse).toBe(true);
    expect(t.serviceKind).toContain('taxi / colectivo');
  });

  it('ATU falló pero el asiento trae uso PARTICULAR → sección disponible, no público (antes: "no disponible")', () => {
    const s = transpOf([res('ATU', 'ERROR'), histCon('Vehiculos Particulares (Categoria M)', 'M1')]);
    expect(s?.status).toBe(SectionStatus.AVAILABLE);
    const t = s?.payload as TransporteInfo;
    expect(t.isPublicTransport).toBe(false);
    expect(t.registralPublicUse).toBe(false);
    expect(t.registralUsage).toContain('Particulares');
  });

  it('ATU habilitado manda aunque el asiento diga particular (habilitación vigente en Lima)', () => {
    const s = transpOf([
      res('ATU', 'ENCONTRADO', { isPublicTransport: true, modalidad: 'TAXI INDEPENDIENTE' }),
      histCon('Vehiculos Particulares (Categoria M)', 'M1'),
    ]);
    const t = s?.payload as TransporteInfo;
    expect(t.isPublicTransport).toBe(true);
    expect(t.modality).toBe('TAXI INDEPENDIENTE');
  });

  it('ATU falló y NO hay señal registral → UNAVAILABLE (reintentar)', () => {
    expect(transpOf([res('ATU', 'ERROR')])?.status).toBe(SectionStatus.UNAVAILABLE);
  });
});
