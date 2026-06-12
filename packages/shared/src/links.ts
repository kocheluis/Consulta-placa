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
  | 'IMPUESTO_VEHICULAR'
  | 'CAPTURA'
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
    url: 'https://www.sat.gob.pe/',
    description: 'Papeletas de tránsito impuestas en Lima Metropolitana.',
    scope: 'Lima',
    note: 'En el portal entra a "Consultas en línea" / Oficina Virtual e ingresa tu placa.',
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
  {
    id: 'satp-piura',
    name: 'SAT de Piura (SATP)',
    entity: 'SATP',
    category: 'PAPELETAS',
    url: 'https://satp.gob.pe/',
    description: 'Papeletas e impuesto vehicular en Piura.',
    scope: 'Piura',
  },
  {
    id: 'satica-ica',
    name: 'SAT de Ica (SATICA)',
    entity: 'SATICA',
    category: 'PAPELETAS',
    url: 'https://www.satica.gob.pe/',
    description: 'Papeletas e impuesto vehicular en Ica.',
    scope: 'Ica',
  },
  {
    id: 'sath-huancayo',
    name: 'SAT de Huancayo (SATH)',
    entity: 'SATH',
    category: 'PAPELETAS',
    url: 'https://www.sath.gob.pe/',
    description: 'Papeletas e impuesto vehicular en Huancayo (Junín).',
    scope: 'Junín',
  },
  {
    id: 'satch-chiclayo',
    name: 'SAT de Chiclayo (SATCH)',
    entity: 'SATCH',
    category: 'PAPELETAS',
    url: 'https://www.satch.gob.pe/',
    description: 'Papeletas e impuesto vehicular en Chiclayo (Lambayeque).',
    scope: 'Lambayeque',
  },
  {
    id: 'satcaj-cajamarca',
    name: 'SAT de Cajamarca (SATCAJ)',
    entity: 'SATCAJ',
    category: 'PAPELETAS',
    url: 'https://www.satcaj.gob.pe/',
    description: 'Papeletas e impuesto vehicular en Cajamarca.',
    scope: 'Cajamarca',
  },
  {
    id: 'sat-tacna',
    name: 'SAT de Tacna',
    entity: 'SAT Tacna',
    category: 'PAPELETAS',
    url: 'https://www.sat-t.gob.pe/',
    description: 'Papeletas e impuesto vehicular en Tacna.',
    scope: 'Tacna',
  },
  {
    id: 'arequipa-papeletas',
    name: 'Papeletas — Municipalidad de Arequipa',
    entity: 'MPA',
    category: 'PAPELETAS',
    url: 'https://www.muniarequipa.gob.pe/',
    description: 'Infracciones y papeletas de tránsito en Arequipa.',
    scope: 'Arequipa',
    note: 'En la Oficina Virtual de la municipalidad, sección infracciones/papeletas.',
  },
  {
    id: 'cusco-tributos',
    name: 'Pagos y Tributos — Municipalidad del Cusco',
    entity: 'MPC',
    category: 'PAPELETAS',
    url: 'https://pagos.cusco.gob.pe/',
    description: 'Impuesto vehicular y obligaciones municipales en Cusco.',
    scope: 'Cusco',
  },

  // ── Impuesto vehicular (municipal, por jurisdicción) ───────────────────────
  {
    id: 'sat-lima-impuesto',
    name: 'Impuesto Vehicular',
    entity: 'SAT de Lima',
    category: 'IMPUESTO_VEHICULAR',
    url: 'https://www.sat.gob.pe/',
    description: 'Deuda del impuesto al patrimonio vehicular (vehículos de hasta 3 años) en Lima.',
    scope: 'Lima',
    note: 'En "Consultas en línea" elige Impuesto Vehicular. El impuesto es municipal: para otras provincias consulta el SAT o municipalidad correspondiente.',
  },
  {
    id: 'callao-impuesto',
    name: 'Tributos y Papeletas del Callao',
    entity: 'Callao',
    category: 'IMPUESTO_VEHICULAR',
    url: 'https://pagopapeletascallao.pe/',
    description: 'Consulta y pago de obligaciones vehiculares en la Provincia Constitucional del Callao.',
    scope: 'Callao',
    note: 'Requiere placa y DNI.',
  },

  // ── Orden de captura / internamiento por deuda ─────────────────────────────
  {
    id: 'sat-lima-captura',
    name: 'Orden de Captura',
    entity: 'SAT de Lima',
    category: 'CAPTURA',
    url: 'https://www.sat.gob.pe/VirtualSAT/modulos/Capturas.aspx',
    description:
      'Verifica si el vehículo tiene orden de captura o internamiento por deuda impaga (papeletas o impuesto vehicular).',
    scope: 'Lima',
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
  IMPUESTO_VEHICULAR: 'Impuesto vehicular',
  CAPTURA: 'Orden de captura',
  INFRACCIONES: 'Infracciones y récord',
};

/** Orden de aparición de las categorías en la consulta guiada. */
export const CATEGORY_ORDER: LinkCategory[] = [
  'REGISTRAL',
  'SEGUROS',
  'REVISION_TECNICA',
  'GNV',
  'PAPELETAS',
  'IMPUESTO_VEHICULAR',
  'CAPTURA',
  'INFRACCIONES',
];
