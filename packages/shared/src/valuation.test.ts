import { describe, it, expect } from 'vitest';
import { buildValuation, type ValuationInput } from './valuation.js';

const base = (over: Partial<ValuationInput> = {}): ValuationInput => ({
  baseMin: 50_000, baseMax: 58_000, year: 2020, currentYear: 2026,
  confidence: 'alta', basis: 'Kia Rio 2020, versión EX',
  siniestro: false, usoTaxi: false, gnv: false, gravamenVigente: false, gravamenMonto: null,
  papeletasPendientes: 0, transfers: 1, roboVigente: false, revisionVencida: false, ...over,
});

describe('buildValuation', () => {
  it('sin daños: 4 bandas de km, la "promedio" es la referencia (isExpected)', () => {
    const v = buildValuation(base());
    expect(v.available).toBe(true);
    expect(v.bands).toHaveLength(4);
    const exp = v.bands.find((b) => b.isExpected);
    expect(exp?.label).toBe('Uso promedio');
    // banda "bajo uso" > "promedio" > "alto" > "muy alto"
    const p = v.bands.map((b) => b.priceMax);
    expect(p[0]).toBeGreaterThan(p[1]!);
    expect(p[1]).toBeGreaterThan(p[2]!);
    expect(p[2]).toBeGreaterThan(p[3]!);
    // km esperado ≈ 6 años × 15 000
    expect(v.expectedKm).toBe(90_000);
    expect(v.netMax).toBe(exp?.priceMax);
  });

  it('siniestro + uso taxi castigan el precio (multiplicativo) y bajan la confianza', () => {
    const limpio = buildValuation(base());
    const danado = buildValuation(base({ siniestro: true, usoTaxi: true }));
    expect(danado.netMax).toBeLessThan(limpio.netMax);
    // ~0.78 × 0.82 ≈ 0.64 del precio limpio
    expect(danado.netMax).toBeLessThan(limpio.netMax * 0.7);
    expect(danado.adjustments.map((a) => a.factor)).toEqual(
      expect.arrayContaining(['Siniestro / pérdida total', 'Uso como taxi/servicio']),
    );
    expect(danado.confidence).not.toBe('alta');
  });

  it('papeletas se descuentan como monto fijo (no %)', () => {
    const v = buildValuation(base({ papeletasPendientes: 990 }));
    const sin = buildValuation(base());
    expect(sin.netMax - v.netMax).toBe(1000); // 990 redondeado a 500 → banda cae ~1000 (min+max)… al menos el ajuste existe
    expect(v.adjustments.find((a) => a.factor === 'Papeletas pendientes')?.impact).toContain('990');
  });

  it('gravamen vigente es informativo (descontar deuda), no un % ciego', () => {
    const v = buildValuation(base({ gravamenVigente: true, gravamenMonto: 20_000 }));
    const adj = v.adjustments.find((a) => a.factor === 'Gravamen vigente');
    expect(adj?.impact).toBe('Descontar deuda');
    expect(adj?.detail).toContain('20');
  });

  it('robo vigente → blocked y "No comprar" al inicio de los ajustes', () => {
    const v = buildValuation(base({ roboVigente: true }));
    expect(v.blocked).toBe(true);
    expect(v.confidence).toBe('baja');
    expect(v.adjustments[0]?.factor).toContain('robo');
  });

  it('sin precio base (IA no pudo estimar) → available=false, sin bandas', () => {
    const v = buildValuation(base({ baseMin: 0, baseMax: 0 }));
    expect(v.available).toBe(false);
    expect(v.bands).toHaveLength(0);
  });

  it('sin año → bandas absolutas de km', () => {
    const v = buildValuation(base({ year: null }));
    expect(v.expectedKm).toBeNull();
    expect(v.bands[0]?.kmRange).toMatch(/40 000/);
  });
});
