import { describe, it, expect } from 'vitest';
import { normPhone, normPlaca, reportSummary } from './bot-format';
import {
  ReportStatus, SectionKind, SectionStatus, ScoreLevel, DISCLAIMER_TEXT, type Report,
} from '@app/shared';

describe('normPhone', () => {
  it('celular peruano suelto (9 díg, empieza en 9) → prefija 51', () => {
    expect(normPhone('987654321')).toBe('51987654321');
  });
  it('ya con código país / wa_id → lo deja igual', () => {
    expect(normPhone('51987654321')).toBe('51987654321');
  });
  it('limpia separadores y +', () => {
    expect(normPhone('+51 987-654-321')).toBe('51987654321');
  });
  it('vacío/no dígitos → ""', () => {
    expect(normPhone('')).toBe('');
    expect(normPhone('abc')).toBe('');
  });
});

describe('normPlaca', () => {
  it('mayúsculas + solo alfanumérico', () => expect(normPlaca(' abc-123 ')).toBe('ABC123'));
  it('rechaza <6 o >7', () => {
    expect(normPlaca('AB12')).toBe('');
    expect(normPlaca('ABCD1234')).toBe('');
  });
  it('acepta 6 y 7', () => {
    expect(normPlaca('D0K057')).toBe('D0K057');
    expect(normPlaca('AC23990')).toBe('AC23990');
  });
});

const baseReport = (over: Partial<Report>): Report => ({
  id: 'r1', placa: 'ABC123', status: ReportStatus.COMPLETE, generatedAt: '2026-08-17T00:00:00.000Z',
  disclaimer: DISCLAIMER_TEXT, vehicle: null, sections: [], ...over,
});

describe('reportSummary', () => {
  it('placa inexistente → mensaje claro, sin score/vehículo', () => {
    const r = reportSummary(baseReport({ plateNotFound: true }));
    expect(r.plateNotFound).toBe(true);
    expect(r.score).toBeNull();
    expect(r.vehicle).toBeNull();
    expect(r.text).toContain('no figura registrada');
    expect(r.text).toContain('*ABC123*');
  });

  it('reporte con vehículo + score → header, score con emoji y link', () => {
    const r = reportSummary(baseReport({
      vehicle: {
        brand: 'KIA', model: 'CERATO', year: 2013, color: 'GRIS CARBON',
        serie: null, vin: null, engineNumber: null, plateDisplay: 'ABC-123', platePrevious: null,
        stolenAlert: false, owner: null,
      },
      sections: [
        // LEGAL con datos → concepto puntuable (sin robo, sin gravámenes = 100)
        { kind: SectionKind.GRAVAMENES, status: SectionStatus.AVAILABLE, payload: { hasLiens: false, items: [] } } as never,
      ],
    }));
    expect(r.plateNotFound).toBe(false);
    expect(r.vehicle).toMatchObject({ brand: 'KIA', model: 'CERATO', year: 2013 });
    expect(r.text).toContain('🚗 *ABC123* — KIA CERATO 2013 · GRIS CARBON');
    expect(r.text).toMatch(/Score: \d+\/100/);
    expect(r.score?.level).toBe(ScoreLevel.GOOD); // sin robo ni gravámenes
    expect(r.text).toContain('/reporte/ABC123');
  });

  it('robo vigente → nivel BAD y aparece en el resumen', () => {
    const r = reportSummary(baseReport({
      vehicle: {
        brand: 'TOYOTA', model: 'YARIS', year: 2015, color: 'ROJO',
        serie: null, vin: null, engineNumber: null, plateDisplay: 'ABC-123', platePrevious: null,
        stolenAlert: true, owner: null,
      },
    }));
    expect(r.score?.level).toBe(ScoreLevel.BAD);
    expect(r.text).toMatch(/ROBO/i);
  });
});
