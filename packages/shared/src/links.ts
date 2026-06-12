/**
 * Catálogo de portales oficiales para la "consulta guiada" gratuita: el usuario
 * abre cada enlace en una pestaña nueva y realiza la consulta él mismo en la
 * fuente oficial (resolviendo allí cualquier CAPTCHA). Sin scraping ni costo.
 *
 * Dominios verificados (2026). Cuando el portal no permite prellenar la placa por
 * URL (SPAs/formularios), el usuario la pega manualmente (la web ofrece copiarla).
 */

export type LinkCategory =
  | 'REGISTRAL'
  | 'SEGUROS'
  | 'REVISION_TECNICA'
  | 'GNV'
  | 'PAPELETAS'
  | 'INFRACCIONES';

export interface OfficialLink {
  id: string;
  name: string;
  entity: string;
  category: LinkCategory;
  url: string;
  description: string;
  /** Cobertura: 'Nacional', 'Lima', 'Callao', 'La Libertad', etc. */
  scope: string;
  /** Nota especial (p. ej. requiere cuenta/pago, se consulta por DNI/brevete). */
  note?: string;
}

export const OFFICIAL_LINKS: OfficialLink[] = [
  // ── Datos registrales (SUNARP) ─────────────────────────────────────────────
  {
    id: 'sunarp',
    name: 'Consulta Vehicular',
    entity: 'SUNARP',
    category: 'REGISTRAL',
    url: 'https://consultavehicular.sunarp.gob.pe/',
    description: 'Titular actual, marca, modelo, año, color, serie/VIN/motor y alerta de robo.',
    scope: 'Nacional',
  },
  {
    id: 'sunarp-sprl',
    name: 'Publicidad Registral en Línea (SPRL)',
    entity: 'SUNARP',
    category: 'REGISTRAL',
    url: 'https://sprl.sunarp.gob.pe/',
    description:
      'Partida registral completa con el historial de TODAS las transferencias (tracto sucesivo), cargas y gravámenes.',
    scope: 'Nacional',
    note: 'Requiere crear una cuenta SPRL y un pago (≈ S/ 5 por página). La consulta vehicular gratuita solo muestra el titular actual.',
  },

  // ── Seguro (SOAT) y siniestralidad ─────────────────────────────────────────
  {
    id: 'sbs',
    name: 'Reporte SOAT y Siniestralidad',
    entity: 'SBS',
    category: 'SEGUROS',
    url: 'https://servicios.sbs.gob.pe/reportesoat/',
    description: 'SOAT/seguro de los últimos 5 años e historial de accidentes.',
    scope: 'Nacional',
  },
  {
    id: 'apeseg',
    name: 'Consulta SOAT',
    entity: 'APESEG',
    category: 'SEGUROS',
    url: 'https://www.apeseg.org.pe/consultas-soat/',
    description: 'Estado del SOAT (aseguradora y vigencia).',
    scope: 'Nacional',
  },

  // ── Revisión técnica ───────────────────────────────────────────────────────
  {
    id: 'mtc-citv',
    name: 'Récord de Revisión Técnica (CITV)',
    entity: 'MTC',
    category: 'REVISION_TECNICA',
    url: 'https://portal.mtc.gob.pe/reportedgtt/form/frmConsultaCITV.aspx',
    description: 'Certificados de inspección técnica vehicular y su vigencia.',
    scope: 'Nacional',
  },

  // ── GNV (gas natural vehicular) ────────────────────────────────────────────
  {
    id: 'infogas',
    name: 'Consulta de Placa GNV',
    entity: 'Infogas',
    category: 'GNV',
    url: 'https://vh.infogas.com.pe/',
    description: 'Estado de la conversión a GNV, certificación, cilindros y carga del vehículo.',
    scope: 'Nacional',
  },

  // ── Papeletas (por jurisdicción) ───────────────────────────────────────────
  {
    id: 'mtc-papeletas',
    name: 'Consulta de Papeletas del Ciudadano',
    entity: 'MTC',
    category: 'PAPELETAS',
    url: 'https://scppp.mtc.gob.pe/',
    description: 'Papeletas a nivel nacional registradas en el sistema del MTC.',
    scope: 'Nacional',
  },
  {
    id: 'sat-lima',
    name: 'Consulta de Papeletas',
    entity: 'SAT de Lima',
    category: 'PAPELETAS',
    url: 'https://www.sat.gob.pe/websitev9/TributosMultas/Papeletas/ConsultasPapeletas',
    description: 'Papeletas de tránsito impuestas en Lima Metropolitana.',
    scope: 'Lima',
  },
  {
    id: 'sat-callao',
    name: 'Papeletas del Callao',
    entity: 'Callao',
    category: 'PAPELETAS',
    url: 'https://pagopapeletascallao.pe/',
    description: 'Consulta y pago de papeletas impuestas en la Provincia Constitucional del Callao.',
    scope: 'Callao',
    note: 'Requiere placa y DNI.',
  },
  {
    id: 'satt-trujillo',
    name: 'Papeletas SATT',
    entity: 'SATT Trujillo',
    category: 'PAPELETAS',
    url: 'https://satt.gob.pe/servicios/papeletas-transito-y-transporte/',
    description: 'Papeletas de tránsito en Trujillo (La Libertad).',
    scope: 'La Libertad',
  },

  // ── Infracciones / récord ──────────────────────────────────────────────────
  {
    id: 'sutran',
    name: 'Récord de Infracciones',
    entity: 'SUTRAN',
    category: 'INFRACCIONES',
    url: 'http://www.sutran.gob.pe/consultas/record-de-infracciones/record-de-infracciones/',
    description: 'Infracciones en la red vial nacional (carreteras y transporte interprovincial).',
    scope: 'Nacional',
  },
  {
    id: 'mtc-record-conductor',
    name: 'Récord de Conductor',
    entity: 'MTC',
    category: 'INFRACCIONES',
    url: 'https://recordconductor.mtc.gob.pe/',
    description: 'Historial de infracciones asociadas a la licencia de conducir.',
    scope: 'Nacional',
    note: 'Se consulta por número de licencia (brevete) o DNI, no por placa.',
  },
];

export const CATEGORY_LABELS: Record<LinkCategory, string> = {
  REGISTRAL: 'Datos registrales y transferencias',
  SEGUROS: 'Seguro (SOAT) y siniestros',
  REVISION_TECNICA: 'Revisión técnica',
  GNV: 'GNV (gas vehicular)',
  PAPELETAS: 'Papeletas (por región)',
  INFRACCIONES: 'Infracciones y récord',
};

/** Orden de aparición de las categorías en la consulta guiada. */
export const CATEGORY_ORDER: LinkCategory[] = [
  'REGISTRAL',
  'SEGUROS',
  'REVISION_TECNICA',
  'GNV',
  'PAPELETAS',
  'INFRACCIONES',
];
