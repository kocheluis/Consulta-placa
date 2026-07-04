/** Fuentes oficiales soportadas. */
export const SourceId = {
  SUNARP: 'SUNARP',
  SBS: 'SBS',
  APESEG: 'APESEG',
  SAT: 'SAT',
  SUTRAN: 'SUTRAN',
  MTC: 'MTC',
  ATU: 'ATU',
  ONPE: 'ONPE',
  SIGM: 'SIGM',
} as const;
export type SourceId = (typeof SourceId)[keyof typeof SourceId];

/** Tipos de sección del reporte (ver SECTION_CATALOG para tier/fuente de cada una). */
export const SectionKind = {
  REGISTRAL: 'REGISTRAL',
  SEGUROS: 'SEGUROS',
  SINIESTRALIDAD: 'SINIESTRALIDAD',
  PAPELETAS: 'PAPELETAS',
  CAPTURA: 'CAPTURA',
  REVISION_TECNICA: 'REVISION_TECNICA',
  TRANSPORTE: 'TRANSPORTE',
  MULTAS_ELECTORALES: 'MULTAS_ELECTORALES',
  GRAVAMENES: 'GRAVAMENES',
  HISTORIAL: 'HISTORIAL',
  /** Identidad específica: versión, carrocería, combustible, cilindrada, dimensiones… (asiento SUNARP). */
  IDENTIDAD_ESPECIFICA: 'IDENTIDAD_ESPECIFICA',
  GNV: 'GNV',
  DEUDA_BANCARIA: 'DEUDA_BANCARIA',
  PNP: 'PNP',
  /** Análisis con IA (ULTRA): recomendación de compra a partir de todo el reporte. */
  IA: 'IA',
} as const;
export type SectionKind = (typeof SectionKind)[keyof typeof SectionKind];

/** Secciones implementadas en el MVP. */
export const MVP_SECTIONS: readonly SectionKind[] = [
  SectionKind.REGISTRAL,
  SectionKind.SEGUROS,
  SectionKind.SINIESTRALIDAD,
];

/** Secciones mostradas como "Próximamente". */
export const COMING_SOON_SECTIONS: readonly SectionKind[] = [
  SectionKind.PAPELETAS,
  SectionKind.GNV,
  SectionKind.DEUDA_BANCARIA,
  SectionKind.PNP,
];

export const SectionStatus = {
  AVAILABLE: 'AVAILABLE',
  UNAVAILABLE: 'UNAVAILABLE',
  COMING_SOON: 'COMING_SOON',
  NOT_FOUND: 'NOT_FOUND',
} as const;
export type SectionStatus = (typeof SectionStatus)[keyof typeof SectionStatus];

export const JobStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  PARTIAL: 'PARTIAL',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const ReportStatus = {
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL',
} as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

/** Nivel del resultado de búsqueda (escalera de valor del producto). */
export const ReportTier = {
  /** Gratis: info común auto-resuelta (marca, modelo, año, color, alerta de robo). */
  BASIC: 'BASIC',
  /** Pago: reporte consolidado + score 0–100 general y por concepto. */
  PRO: 'PRO',
  /** Pago: PRO + recomendación con IA y valor de compra de referencia. */
  ULTRA: 'ULTRA',
} as const;
export type ReportTier = (typeof ReportTier)[keyof typeof ReportTier];

/** Nivel cualitativo de un score (semáforo). */
export const ScoreLevel = {
  GOOD: 'GOOD',
  WARNING: 'WARNING',
  BAD: 'BAD',
  /** Sin datos suficientes para puntuar el concepto. */
  UNKNOWN: 'UNKNOWN',
} as const;
export type ScoreLevel = (typeof ScoreLevel)[keyof typeof ScoreLevel];

/** Conceptos en los que se descompone el score del vehículo (PRO). */
export const ScoreConcept = {
  LEGAL: 'LEGAL',
  INSURANCE: 'INSURANCE',
  DEBTS: 'DEBTS',
  USAGE: 'USAGE',
} as const;
export type ScoreConcept = (typeof ScoreConcept)[keyof typeof ScoreConcept];

export const DataRequestType = {
  ACCESS: 'ACCESS',
  DELETION: 'DELETION',
  RECTIFICATION: 'RECTIFICATION',
  OPPOSITION: 'OPPOSITION',
} as const;
export type DataRequestType = (typeof DataRequestType)[keyof typeof DataRequestType];

export const DataRequestStatus = {
  RECEIVED: 'RECEIVED',
  IN_REVIEW: 'IN_REVIEW',
  RESOLVED: 'RESOLVED',
  REJECTED: 'REJECTED',
} as const;
export type DataRequestStatus = (typeof DataRequestStatus)[keyof typeof DataRequestStatus];
