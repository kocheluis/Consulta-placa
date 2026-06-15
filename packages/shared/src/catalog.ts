import { ReportTier, ScoreConcept, SectionKind } from './enums.js';

/**
 * Catálogo de secciones del reporte — ÚNICA FUENTE DE VERDAD del producto.
 * Define, por sección: a qué nivel (tier) pertenece, qué fuente(s) la alimentan,
 * a qué concepto de score aporta, y dónde vive su dato en `Report.sections`
 * (`dataKind`) cuando ya está conectada.
 *
 * Modelo de niveles (confirmado jun-2026):
 *  - BASIC  (gratis): SUNARP Consulta Vehicular + APESEG SOAT.
 *  - PRO            : todo lo demás (SBS, SAT, MTC, SUTRAN, ATU, ONPE…), con score.
 *  - ULTRA          : PRO + valorización de mercado, análisis con IA y odómetro.
 *
 * La UI itera este catálogo: muestra el dato si está disponible, "Próximamente"
 * si la fuente aún no se conecta, o un candado "Mejora a PRO/ULTRA" si la sección
 * está por encima del nivel del usuario.
 */
export interface SectionCatalogEntry {
  /** Id estable de la sección (no confundir con SectionKind del scraper). */
  key: string;
  label: string;
  /** Material Symbol. */
  icon: string;
  tier: ReportTier;
  /** Fuentes oficiales que la alimentan. */
  sources: string[];
  /** Concepto de score al que aporta (null = informativo, no puntúa). */
  concept: ScoreConcept | null;
  /** Dónde está el dato en Report.sections (null = fuente aún no conectada). */
  dataKind: SectionKind | null;
  /** Resumen de qué entrega (para slots aún sin dato). */
  blurb: string;
}

export const SECTION_CATALOG: readonly SectionCatalogEntry[] = [
  // ── BASIC: SUNARP + APESEG ──────────────────────────────────────────
  {
    key: 'identidad',
    label: 'Identidad del vehículo',
    icon: 'directions_car',
    tier: ReportTier.BASIC,
    sources: ['SUNARP'],
    concept: ScoreConcept.LEGAL,
    dataKind: SectionKind.REGISTRAL,
    blurb: 'Marca, modelo, año, color, serie, VIN, motor, placa anterior, estado registral, anotaciones y sede.',
  },
  {
    key: 'propietarios',
    label: 'Propietario(s)',
    icon: 'person',
    tier: ReportTier.BASIC,
    sources: ['SUNARP'],
    concept: ScoreConcept.LEGAL,
    dataKind: null,
    blurb: 'Titular(es) registrado(s) según SUNARP (dato público minimizado).',
  },
  {
    key: 'soat',
    label: 'SOAT',
    icon: 'health_and_safety',
    tier: ReportTier.BASIC,
    sources: ['APESEG'],
    concept: ScoreConcept.INSURANCE,
    dataKind: SectionKind.SEGUROS,
    blurb: 'Compañía, estado (vigente), inicio/fin, certificado, uso, clase y tipo.',
  },
  // ── PRO: el resto de fuentes ────────────────────────────────────────
  {
    key: 'siniestralidad',
    label: 'Siniestralidad',
    icon: 'car_crash',
    tier: ReportTier.PRO,
    sources: ['SBS'],
    concept: ScoreConcept.INSURANCE,
    dataKind: SectionKind.SINIESTRALIDAD,
    blurb: 'Si el vehículo registra siniestros reportados a las aseguradoras.',
  },
  {
    key: 'papeletas',
    label: 'Papeletas e infracciones',
    icon: 'receipt_long',
    tier: ReportTier.PRO,
    sources: ['SAT', 'SUTRAN'],
    concept: ScoreConcept.DEBTS,
    dataKind: SectionKind.PAPELETAS,
    blurb: 'Papeletas municipales (SAT) y por cinemómetro en carretera (SUTRAN), con montos.',
  },
  {
    key: 'revision_tecnica',
    label: 'Revisión técnica',
    icon: 'fact_check',
    tier: ReportTier.PRO,
    sources: ['MTC'],
    concept: ScoreConcept.USAGE,
    dataKind: null,
    blurb: 'Estado de la revisión técnica (vigente/vencida), última fecha y resultado.',
  },
  {
    key: 'captura',
    label: 'Orden de captura',
    icon: 'gavel',
    tier: ReportTier.PRO,
    sources: ['SAT'],
    concept: ScoreConcept.LEGAL,
    dataKind: null,
    blurb: 'Si la placa registra orden de captura vigente.',
  },
  {
    key: 'transporte',
    label: 'Uso como taxi / transporte',
    icon: 'local_taxi',
    tier: ReportTier.PRO,
    sources: ['ATU'],
    concept: ScoreConcept.USAGE,
    dataKind: null,
    blurb: 'Si el vehículo está o estuvo registrado para taxi/transporte (uso intensivo).',
  },
  {
    key: 'gravamenes',
    label: 'Gravámenes / prendas',
    icon: 'account_balance',
    tier: ReportTier.PRO,
    sources: ['SUNARP'],
    concept: ScoreConcept.LEGAL,
    dataKind: null,
    blurb: 'Si el vehículo está libre o registra gravámenes, prendas o embargos.',
  },
  {
    key: 'multas_electorales',
    label: 'Multas electorales',
    icon: 'how_to_vote',
    tier: ReportTier.PRO,
    sources: ['ONPE'],
    concept: ScoreConcept.DEBTS,
    dataKind: null,
    blurb: 'Multas electorales del titular (por DNI, con su consentimiento).',
  },
  // ── ULTRA: valorización + IA + odómetro ─────────────────────────────
  {
    key: 'odometro',
    label: 'Análisis de odómetro',
    icon: 'speed',
    tier: ReportTier.ULTRA,
    sources: ['MTC'],
    concept: ScoreConcept.USAGE,
    dataKind: null,
    blurb: 'Lecturas históricas de kilometraje y coherencia (detección de retroceso).',
  },
  {
    key: 'valorizacion',
    label: 'Valorización de mercado',
    icon: 'payments',
    tier: ReportTier.ULTRA,
    sources: ['Neoauto', 'Mercado Libre', 'Autocosmos', 'Facebook'],
    concept: null,
    dataKind: null,
    blurb: 'Precio estimado y rango según avisos del mercado en tiempo real.',
  },
  {
    key: 'ia',
    label: 'Análisis con IA',
    icon: 'auto_awesome',
    tier: ReportTier.ULTRA,
    sources: [],
    concept: null,
    dataKind: null,
    blurb: 'Recomendación de compra, precio justo y banderas, a partir de todo el reporte.',
  },
];

/** Rango numérico del nivel, para comparar (BASIC < PRO < ULTRA). */
export const TIER_RANK: Record<ReportTier, number> = {
  [ReportTier.BASIC]: 1,
  [ReportTier.PRO]: 2,
  [ReportTier.ULTRA]: 3,
};
