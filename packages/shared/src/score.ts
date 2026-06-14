import { ScoreConcept, ScoreLevel, SectionKind, SectionStatus } from './enums.js';
import type { Report, InsurancePolicy, SiniestroIndicator } from './report.js';

/**
 * Motor de score del vehículo (nivel PRO). Función PURA y EXPLICABLE:
 * a partir del reporte ensamblado calcula un score general 0–100 y un score por
 * concepto, cada uno con su nivel (semáforo) y las razones que lo movieron.
 *
 * Principios:
 *  - Determinístico (no IA) y testeable.
 *  - No penaliza la falta de datos: un concepto sin información queda `UNKNOWN`
 *    y se excluye del promedio (se reporta la cobertura por separado).
 *  - Señales críticas (p. ej. robo) fuerzan el veredicto general a BAD.
 *
 * Hoy puntúa con las señales ya disponibles (robo, SOAT, siniestralidad). Los
 * conceptos DEBTS (papeletas/impuesto) y USAGE (revisión técnica, ex-taxi, GNV)
 * quedan `UNKNOWN` hasta conectar sus fuentes; la estructura ya los contempla.
 */

export interface ConceptScore {
  concept: ScoreConcept;
  label: string;
  /** Peso relativo del concepto en el score general. */
  weight: number;
  /** 0–100, o `null` si no hay datos para puntuarlo. */
  score: number | null;
  level: ScoreLevel;
  /** Explicaciones legibles de qué movió el score. */
  reasons: string[];
}

export interface VehicleScore {
  /** 0–100, o `null` si no hay ninguna señal puntuable. */
  overall: number | null;
  level: ScoreLevel;
  letter: 'A' | 'B' | 'C' | 'D' | 'F' | null;
  /** Proporción ponderada de conceptos con datos (0–1). */
  coverage: number;
  concepts: ConceptScore[];
}

const WEIGHTS: Record<ScoreConcept, number> = {
  [ScoreConcept.LEGAL]: 0.4,
  [ScoreConcept.INSURANCE]: 0.3,
  [ScoreConcept.DEBTS]: 0.15,
  [ScoreConcept.USAGE]: 0.15,
};

const LABELS: Record<ScoreConcept, string> = {
  [ScoreConcept.LEGAL]: 'Legal y registral',
  [ScoreConcept.INSURANCE]: 'Seguro y siniestros',
  [ScoreConcept.DEBTS]: 'Multas y deudas',
  [ScoreConcept.USAGE]: 'Uso y estado',
};

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

function levelFromScore(score: number): ScoreLevel {
  if (score >= 75) return ScoreLevel.GOOD;
  if (score >= 50) return ScoreLevel.WARNING;
  return ScoreLevel.BAD;
}

function letterFromScore(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function availablePayload<T>(report: Report, kind: SectionKind): T | null {
  const section = report.sections.find((s) => s.kind === kind);
  if (!section || section.status !== SectionStatus.AVAILABLE) return null;
  return (section.payload ?? null) as T | null;
}

interface RawConcept {
  /** 0–100, o `null` si no hay datos. */
  score: number | null;
  reasons: string[];
  /** Señal crítica (dealbreaker) que fuerza el general a BAD. */
  critical: boolean;
}

function scoreLegal(report: Report): RawConcept {
  if (!report.vehicle) {
    return { score: null, reasons: ['Sin datos registrales (SUNARP).'], critical: false };
  }
  if (report.vehicle.stolenAlert) {
    return { score: 0, reasons: ['Vehículo reportado como robado.'], critical: true };
  }
  return { score: 100, reasons: ['Sin reporte de robo en SUNARP.'], critical: false };
}

function scoreInsurance(report: Report): RawConcept {
  const soat = availablePayload<InsurancePolicy>(report, SectionKind.SEGUROS);
  const sini = availablePayload<SiniestroIndicator>(report, SectionKind.SINIESTRALIDAD);
  if (!soat && !sini) {
    return { score: null, reasons: ['Sin datos de seguro ni siniestralidad.'], critical: false };
  }
  let score = 100;
  const reasons: string[] = [];
  if (soat) {
    if (soat.hasActiveSoat) reasons.push('SOAT vigente.');
    else {
      score -= 35;
      reasons.push('Sin SOAT vigente registrado.');
    }
  }
  if (sini) {
    if (sini.hasSiniestro) {
      score -= 45;
      reasons.push(`Registra siniestralidad (últimos ${sini.periodYears} años).`);
    } else {
      reasons.push('Sin siniestros registrados.');
    }
  }
  return { score: clamp(score), reasons, critical: false };
}

function scoreDebts(report: Report): RawConcept {
  // Papeletas / impuesto vehicular: fuente aún no conectada (próximamente).
  const papeletas = availablePayload<unknown>(report, SectionKind.PAPELETAS);
  if (papeletas == null) {
    return { score: null, reasons: ['Multas y deudas: próximamente.'], critical: false };
  }
  return { score: 100, reasons: [], critical: false };
}

function scoreUsage(_report: Report): RawConcept {
  // Revisión técnica / ex-taxi (ATU) / GNV: fuentes aún no conectadas.
  return { score: null, reasons: ['Uso y estado: próximamente.'], critical: false };
}

/** Calcula el score del vehículo a partir del reporte ensamblado. */
export function computeScore(report: Report): VehicleScore {
  const raws: Array<{ concept: ScoreConcept; raw: RawConcept }> = [
    { concept: ScoreConcept.LEGAL, raw: scoreLegal(report) },
    { concept: ScoreConcept.INSURANCE, raw: scoreInsurance(report) },
    { concept: ScoreConcept.DEBTS, raw: scoreDebts(report) },
    { concept: ScoreConcept.USAGE, raw: scoreUsage(report) },
  ];

  const concepts: ConceptScore[] = raws.map(({ concept, raw }) => ({
    concept,
    label: LABELS[concept],
    weight: WEIGHTS[concept],
    score: raw.score,
    level: raw.score === null ? ScoreLevel.UNKNOWN : levelFromScore(raw.score),
    reasons: raw.reasons,
  }));

  const totalWeight = raws.reduce((acc, r) => acc + WEIGHTS[r.concept], 0);
  const known = raws.filter((r) => r.raw.score !== null);
  const knownWeight = known.reduce((acc, r) => acc + WEIGHTS[r.concept], 0);
  const coverage = totalWeight > 0 ? Math.round((knownWeight / totalWeight) * 100) / 100 : 0;

  if (known.length === 0 || knownWeight === 0) {
    return { overall: null, level: ScoreLevel.UNKNOWN, letter: null, coverage: 0, concepts };
  }

  const weighted =
    known.reduce((acc, r) => acc + (r.raw.score as number) * WEIGHTS[r.concept], 0) / knownWeight;
  const hasCritical = raws.some((r) => r.raw.critical);
  const overall = hasCritical ? Math.min(clamp(weighted), 15) : clamp(weighted);
  const level = hasCritical ? ScoreLevel.BAD : levelFromScore(overall);

  return { overall, level, letter: letterFromScore(overall), coverage, concepts };
}
