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
const withPerdidaTotal: SiniestroIndicator = { hasSiniestro: true, perdidaTotal: true, periodYears: 5 };

function section(kind: SectionKind, payload: unknown): SectionResult {
  return { kind, source: SourceId.SUNARP, status: SectionStatus.AVAILABLE, fetchedAt: T, payload };
}

function makeReport(opts: {
  vehicle?: boolean;
  stolenAlert?: boolean;
  soat?: InsurancePolicy;
  sini?: SiniestroIndicator;
  grav?: unknown;
  papeletas?: unknown;
  captura?: unknown;
  impuesto?: unknown;
}): Report {
  const sections: SectionResult[] = [];
  if (opts.soat) sections.push(section(SectionKind.SEGUROS, opts.soat));
  if (opts.sini) sections.push(section(SectionKind.SINIESTRALIDAD, opts.sini));
  if (opts.grav) sections.push(section(SectionKind.GRAVAMENES, opts.grav));
  if (opts.papeletas) sections.push(section(SectionKind.PAPELETAS, opts.papeletas));
  if (opts.captura) sections.push(section(SectionKind.CAPTURA, opts.captura));
  if (opts.impuesto) sections.push(section(SectionKind.IMPUESTO_VEHICULAR, opts.impuesto));
  const hasVehicle = opts.vehicle ?? true;
  return {
    id: 'r1',
    placa: 'ABC-123',
    status: ReportStatus.COMPLETE,
    generatedAt: T,
    disclaimer: 'x',
    vehicle: hasVehicle
      ? {
          brand: 'Toyota', model: 'Yaris', year: 2019, color: 'Plomo',
          serie: null, vin: null, engineNumber: null,
          plateDisplay: 'ABC-123', platePrevious: null,
          stolenAlert: opts.stolenAlert ?? false, owner: null,
        }
      : null,
    sections,
  };
}

const gravVigente = { hasLiens: true, total: 1, items: [{ type: 'Garantía mobiliaria', creditor: 'BANCO X', amount: null, date: null, status: 'VIGENTE' }] };
const gravEjecucion = { hasLiens: true, total: 1, items: [{ type: 'Garantía mobiliaria', creditor: 'BANCO X', amount: null, date: null, status: 'INICIO EJECUCIÓN' }] };
const gravLibre = { hasLiens: false, total: 0, items: [] };
const papeletasPend = { total: 1, count: 2, pendingAmount: 500, items: [], checkedScopes: ['Lima (SAT)'] };
const papeletasCero = { total: 0, pendingAmount: 0, items: [], checkedScopes: ['Lima (SAT)'] };
const capturaSi = { hasCapture: true, detail: null };
const impuestoPend = { sat: { found: true, pendingTotal: 300, pendingYears: [2025], paidYears: [], cuotas: [] } };

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
    expect(s.coverage).toBeCloseTo(0.8); // LEGAL(0.45)+INSURANCE(0.35) de 1.0
    // USAGE ya no es un concepto; DEBTS sin fuentes de deuda queda UNKNOWN.
    expect(concept(s, ScoreConcept.DEBTS).level).toBe(ScoreLevel.UNKNOWN);
    expect(s.concepts.some((c) => c.concept === ScoreConcept.USAGE)).toBe(false);
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
    expect(s.overall).toBe(80);
  });

  it('PÉRDIDA TOTAL topa el veredicto en Alerta (no "apto"), aun con lo demás limpio', () => {
    const s = computeScore(makeReport({ soat: soatActive, sini: withPerdidaTotal }));
    expect(s.level).toBe(ScoreLevel.BAD);
    expect(s.overall).toBeLessThanOrEqual(49);
    expect(concept(s, ScoreConcept.INSURANCE).reasons.some((r) => /p[eé]rdida total/i.test(r))).toBe(true);
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
    expect(s.coverage).toBeCloseTo(0.45); // solo LEGAL de 1.0
    expect(concept(s, ScoreConcept.INSURANCE).level).toBe(ScoreLevel.UNKNOWN);
  });

  // ── LEGAL: gravámenes ──
  it('garantía/prenda VIGENTE penaliza LEGAL (WARNING) pero no es dealbreaker', () => {
    const s = computeScore(makeReport({ soat: soatActive, sini: noSini, grav: gravVigente }));
    const legal = concept(s, ScoreConcept.LEGAL);
    expect(legal.score).toBe(70);
    expect(legal.level).toBe(ScoreLevel.WARNING);
    expect(legal.reasons.some((r) => /garant[ií]a|prenda/i.test(r))).toBe(true);
    expect(s.overall).toBeLessThan(100);
  });

  it('garantía EN EJECUCIÓN topa el veredicto en Alerta', () => {
    const s = computeScore(makeReport({ soat: soatActive, sini: noSini, grav: gravEjecucion }));
    expect(s.level).toBe(ScoreLevel.BAD);
    expect(s.overall).toBeLessThanOrEqual(49);
    expect(concept(s, ScoreConcept.LEGAL).reasons.some((r) => /ejecuci[oó]n/i.test(r))).toBe(true);
  });

  it('sin gravámenes vigentes → LEGAL 100', () => {
    const s = computeScore(makeReport({ soat: soatActive, sini: noSini, grav: gravLibre }));
    expect(concept(s, ScoreConcept.LEGAL).score).toBe(100);
  });

  // ── DEBTS: papeletas / impuesto / captura ──
  it('papeletas pendientes bajan DEBTS y lo explican', () => {
    const s = computeScore(makeReport({ soat: soatActive, sini: noSini, papeletas: papeletasPend }));
    const debts = concept(s, ScoreConcept.DEBTS);
    expect(debts.score).toBe(70); // 100 - 30 (con monto)
    expect(debts.reasons.some((r) => /papeleta/i.test(r))).toBe(true);
    expect(s.overall).toBeLessThan(100);
  });

  it('sin papeletas y con impuesto pendiente → DEBTS baja solo por el impuesto', () => {
    const s = computeScore(makeReport({ soat: soatActive, sini: noSini, papeletas: papeletasCero, impuesto: impuestoPend }));
    const debts = concept(s, ScoreConcept.DEBTS);
    expect(debts.score).toBe(75); // 100 - 25 (impuesto)
    expect(debts.reasons.some((r) => /impuesto/i.test(r))).toBe(true);
  });

  it('orden de captura vigente topa el veredicto en Alerta', () => {
    const s = computeScore(makeReport({ soat: soatActive, sini: noSini, captura: capturaSi }));
    expect(s.level).toBe(ScoreLevel.BAD);
    expect(s.overall).toBeLessThanOrEqual(49);
    expect(concept(s, ScoreConcept.DEBTS).reasons.some((r) => /captura/i.test(r))).toBe(true);
  });

  it('deudas consultadas y limpias → DEBTS 100', () => {
    const s = computeScore(makeReport({ soat: soatActive, sini: noSini, papeletas: papeletasCero, impuesto: { sat: { found: true, pendingTotal: 0, cuotas: [] } } }));
    expect(concept(s, ScoreConcept.DEBTS).score).toBe(100);
  });
});
