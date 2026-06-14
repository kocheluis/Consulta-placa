import { describe, it, expect } from 'vitest';
import { computeScore } from './score.js';
import { ScoreConcept, ScoreLevel, SectionKind, SectionStatus, SourceId, ReportStatus } from './enums.js';
import type { Report, SectionResult, InsurancePolicy, SiniestroIndicator } from './report.js';

const T = '2026-06-12T10:00:00Z';

const soatActive: InsurancePolicy = {
  hasActiveSoat: true,
  insurer: null,
  policyNumber: null,
  validFrom: null,
  validTo: null,
};
const soatInactive: InsurancePolicy = { ...soatActive, hasActiveSoat: false };
const noSini: SiniestroIndicator = { hasSiniestro: false, periodYears: 5 };
const withSini: SiniestroIndicator = { hasSiniestro: true, periodYears: 5 };

function makeReport(opts: {
  vehicle?: boolean;
  stolenAlert?: boolean;
  soat?: InsurancePolicy;
  sini?: SiniestroIndicator;
}): Report {
  const sections: SectionResult[] = [];
  if (opts.soat) {
    sections.push({
      kind: SectionKind.SEGUROS,
      source: SourceId.SBS,
      status: SectionStatus.AVAILABLE,
      fetchedAt: T,
      payload: opts.soat,
    });
  }
  if (opts.sini) {
    sections.push({
      kind: SectionKind.SINIESTRALIDAD,
      source: SourceId.SBS,
      status: SectionStatus.AVAILABLE,
      fetchedAt: T,
      payload: opts.sini,
    });
  }
  const hasVehicle = opts.vehicle ?? true;
  return {
    id: 'r1',
    placa: 'ABC-123',
    status: ReportStatus.COMPLETE,
    generatedAt: T,
    disclaimer: 'x',
    vehicle: hasVehicle
      ? {
          brand: 'Toyota',
          model: 'Yaris',
          year: 2019,
          color: 'Plomo',
          serie: null,
          vin: null,
          engineNumber: null,
          plateDisplay: 'ABC-123',
          platePrevious: null,
          stolenAlert: opts.stolenAlert ?? false,
          owner: null,
        }
      : null,
    sections,
  };
}

const concept = (s: ReturnType<typeof computeScore>, c: ScoreConcept) =>
  s.concepts.find((x) => x.concept === c)!;

describe('computeScore', () => {
  it('un vehículo robado es crítico: BAD, F y score muy bajo', () => {
    const s = computeScore(makeReport({ stolenAlert: true, soat: soatActive, sini: noSini }));
    expect(s.level).toBe(ScoreLevel.BAD);
    expect(s.letter).toBe('F');
    expect(s.overall).toBeLessThanOrEqual(15);
    expect(concept(s, ScoreConcept.LEGAL).level).toBe(ScoreLevel.BAD);
  });

  it('vehículo limpio con SOAT vigente y sin siniestros → 100, GOOD, A', () => {
    const s = computeScore(makeReport({ stolenAlert: false, soat: soatActive, sini: noSini }));
    expect(s.overall).toBe(100);
    expect(s.level).toBe(ScoreLevel.GOOD);
    expect(s.letter).toBe('A');
    expect(s.coverage).toBeCloseTo(0.7);
    expect(concept(s, ScoreConcept.DEBTS).level).toBe(ScoreLevel.UNKNOWN);
    expect(concept(s, ScoreConcept.USAGE).level).toBe(ScoreLevel.UNKNOWN);
  });

  it('sin SOAT vigente penaliza el concepto seguro (WARNING) pero no es crítico', () => {
    const s = computeScore(makeReport({ soat: soatInactive, sini: noSini }));
    expect(concept(s, ScoreConcept.INSURANCE).level).toBe(ScoreLevel.WARNING);
    expect(s.overall).toBe(85);
    expect(s.letter).toBe('B');
  });

  it('registra siniestralidad → baja el concepto seguro y lo explica', () => {
    const s = computeScore(makeReport({ soat: soatActive, sini: withSini }));
    const ins = concept(s, ScoreConcept.INSURANCE);
    expect(ins.level).toBe(ScoreLevel.WARNING);
    expect(ins.reasons.some((r) => r.toLowerCase().includes('siniestralidad'))).toBe(true);
    expect(s.overall).toBe(81);
  });

  it('sin ninguna señal puntuable → overall null, UNKNOWN, cobertura 0', () => {
    const s = computeScore(makeReport({ vehicle: false }));
    expect(s.overall).toBeNull();
    expect(s.level).toBe(ScoreLevel.UNKNOWN);
    expect(s.letter).toBeNull();
    expect(s.coverage).toBe(0);
  });

  it('solo con datos registrales (sin secciones) puntúa LEGAL y baja la cobertura', () => {
    const s = computeScore(makeReport({ stolenAlert: false }));
    expect(s.overall).toBe(100);
    expect(s.coverage).toBeCloseTo(0.4);
    expect(concept(s, ScoreConcept.INSURANCE).level).toBe(ScoreLevel.UNKNOWN);
  });
});
