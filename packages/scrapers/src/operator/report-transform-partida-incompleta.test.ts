import { describe, it, expect } from 'vitest';
import { toWebReport } from './report-transform.js';
import { SectionKind, SectionStatus, type HistorialPayload } from '@app/shared';
import type { OperatorSourceResult } from './index.js';

const AT = '2026-08-06T12:00:00.000Z';
const res = (source: string, status: OperatorSourceResult['status'], data?: Record<string, unknown>): OperatorSourceResult =>
  ({ source, label: source, category: 'OTRO', status, summary: '', ms: 1, ...(data ? { data } : {}) }) as OperatorSourceResult;

describe('toWebReport · partida incompleta en SUNARP (placa antigua, error de SUNARP)', () => {
  it('HISTORIAL con partidaIncompleta → sección HISTORIAL AVAILABLE con propietario actual, NO error', () => {
    const r = toWebReport('LI6361', [
      res('SUNARP', 'ENCONTRADO', { brand: 'VOLKSWAGEN', ownerName: 'JUAN PEREZ' }),
      res('HISTORIAL', 'SIN_REGISTRO', { partidaIncompleta: true, vehiculo: { ownerName: 'JUAN PEREZ' }, sede: 'LIMA', timeline: [], titulos: [], flags: {} }),
    ], AT, 'test');
    const hist = r.sections.find((s) => s.kind === SectionKind.HISTORIAL);
    expect(hist?.status).toBe(SectionStatus.AVAILABLE); // NO UNAVAILABLE ni error
    const p = hist?.payload as HistorialPayload;
    expect(p.partidaIncompleta).toBe(true);
    expect(p.currentOwner).toBe('JUAN PEREZ');
    expect(p.transfers).toBe(0);
    expect(p.totalAsientos).toBe(0);
  });

  it('cae al ownerName de SUNARP si el historial no lo trae', () => {
    const r = toWebReport('LI6361', [
      res('SUNARP', 'ENCONTRADO', { brand: 'VOLKSWAGEN', ownerName: 'MARIA GOMEZ' }),
      res('HISTORIAL', 'SIN_REGISTRO', { partidaIncompleta: true, vehiculo: null, sede: 'LIMA', timeline: [], titulos: [], flags: {} }),
    ], AT, 'test');
    const p = r.sections.find((s) => s.kind === SectionKind.HISTORIAL)?.payload as HistorialPayload;
    expect(p.currentOwner).toBe('MARIA GOMEZ');
  });

  it('historial que FALLÓ de verdad (sin partidaIncompleta) → HISTORIAL UNAVAILABLE', () => {
    const r = toWebReport('ABC123', [
      res('SUNARP', 'ENCONTRADO', { brand: 'TOYOTA', ownerName: 'X' }),
      res('HISTORIAL', 'ERROR'),
    ], AT, 'test');
    expect(r.sections.find((s) => s.kind === SectionKind.HISTORIAL)?.status).toBe(SectionStatus.UNAVAILABLE);
  });
});
