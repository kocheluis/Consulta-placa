import { ReportTier, ScoreConcept, SectionKind } from './enums.js';

/**
 * Catálogo de secciones del reporte — ÚNICA FUENTE DE VERDAD del producto.
 * Define, por sección: a qué nivel (tier) pertenece, qué fuente(s) la alimentan,
 * a qué concepto de score aporta, y dónde vive su dato en `Report.sections`
 * (`dataKind`) cuando ya está conectada.
 *
 * Modelo de niveles (confirmado jun-2026):
 *  - BASIC  (gratis): SUNARP Consulta Vehicular + SBS SOAT (sin siniestralidad) + MTC revisión técnica.
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
  /**
   * true = la fuente aún NO está conectada en producción: se muestra como
   * "Próximamente" y NO se ofrece como upsell de pago (integridad: no cobramos
   * por un dato que todavía no entregamos). Ver `fuentes-inventario.md`.
   */
  comingSoon?: boolean;
}

export const SECTION_CATALOG: readonly SectionCatalogEntry[] = [
  // ── BASIC: SUNARP + APESEG ──────────────────────────────────────────
  {
    key: 'identidad',
    label: 'Identidad básica del vehículo',
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
    label: 'Seguros (SOAT / CAT)',
    icon: 'health_and_safety',
    tier: ReportTier.BASIC,
    sources: ['SBS'],
    concept: ScoreConcept.INSURANCE,
    dataKind: SectionKind.SEGUROS,
    blurb: 'Seguro obligatorio contra accidentes: SOAT (vehículos particulares) o CAT (transporte público/taxi, reemplaza al SOAT). El seguro vehicular es una cobertura opcional. Muestra compañía, vigencia, certificado y uso. (La siniestralidad queda en PRO.)',
  },
  // ── PRO: el resto de fuentes ────────────────────────────────────────
  {
    key: 'identidad_especifica',
    label: 'Identidad específica del vehículo',
    icon: 'tune',
    tier: ReportTier.PRO,
    sources: ['SUNARP'],
    concept: null,
    dataKind: SectionKind.IDENTIDAD_ESPECIFICA,
    blurb: 'Ficha técnica que la consulta gratuita no da: N° de versión, tipo de carrocería, combustible, cilindrada, potencia, dimensiones y pesos — tomada del asiento registral (refleja el estado actual del vehículo).',
  },
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
    tier: ReportTier.BASIC, // gratis: parte del combo de la consulta gratuita (SUNARP + SOAT + CITV).
    sources: ['MTC'],
    concept: ScoreConcept.USAGE,
    dataKind: SectionKind.REVISION_TECNICA,
    blurb: 'Estado de la revisión técnica (vigente/vencida), última fecha y resultado.',
  },
  {
    key: 'captura',
    label: 'Orden de captura',
    icon: 'gavel',
    tier: ReportTier.PRO,
    sources: ['SAT'],
    concept: ScoreConcept.LEGAL,
    dataKind: SectionKind.CAPTURA,
    blurb: 'Si la placa registra orden de captura vigente.',
  },
  {
    key: 'transporte',
    label: 'Uso como taxi / transporte',
    icon: 'local_taxi',
    tier: ReportTier.PRO,
    sources: ['ATU'],
    concept: ScoreConcept.USAGE,
    dataKind: SectionKind.TRANSPORTE,
    blurb: 'Si el vehículo está o estuvo registrado para taxi/transporte (uso intensivo).',
  },
  {
    key: 'gravamenes',
    label: 'Gravámenes / prendas',
    icon: 'account_balance',
    tier: ReportTier.PRO,
    sources: ['SIGM', 'SUNARP'],
    concept: ScoreConcept.LEGAL,
    dataKind: SectionKind.GRAVAMENES,
    blurb: 'Prendas, garantías mobiliarias (SIGM) y embargos inscritos: indica si el vehículo está libre o en garantía de un crédito.',
  },
  {
    key: 'historial',
    label: 'Historial de transferencias',
    icon: 'history',
    tier: ReportTier.PRO,
    sources: ['SUNARP'],
    concept: ScoreConcept.LEGAL,
    dataKind: SectionKind.HISTORIAL,
    blurb: 'Línea de tiempo de asientos registrales: compraventas, precios declarados, partes y banderas (aseguradora/remate/financiera).',
  },
  {
    key: 'multas_electorales',
    label: 'Multas electorales',
    icon: 'how_to_vote',
    tier: ReportTier.PRO,
    sources: ['ONPE'],
    concept: ScoreConcept.DEBTS,
    dataKind: SectionKind.MULTAS_ELECTORALES,
    blurb: 'Multas electorales del titular (por DNI, con su consentimiento).',
    comingSoon: true,
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
    comingSoon: true,
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
    comingSoon: true,
  },
  {
    key: 'ia',
    label: 'Análisis con IA',
    icon: 'auto_awesome',
    tier: ReportTier.ULTRA,
    sources: [],
    concept: null,
    dataKind: SectionKind.IA,
    blurb: 'Recomendación de compra, precio justo y banderas, a partir de todo el reporte.',
  },
];

/** Rango numérico del nivel, para comparar (BASIC < PRO < ULTRA). */
export const TIER_RANK: Record<ReportTier, number> = {
  [ReportTier.BASIC]: 1,
  [ReportTier.PRO]: 2,
  [ReportTier.ULTRA]: 3,
};
