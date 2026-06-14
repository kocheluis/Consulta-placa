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
  | 'TRANSPORTE'
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

  // ── Habilitación de transporte / taxi ──────────────────────────────────────
  {
    id: 'atu',
    name: 'Consulta de Vehículos (taxi / transporte)',
    entity: 'ATU',
    category: 'TRANSPORTE',
    url: 'https://sistemas.atu.gob.pe/ConsultaVehiculo',
    description:
      'Verifica si el vehículo está o estuvo habilitado como taxi/transporte urbano (modalidad, titular y conductores). Útil para detectar autos usados como taxi (mayor desgaste).',
    scope: 'Lima y Callao',
    note: 'Requiere placa y código de verificación (captcha).',
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
    url: 'https://www.sat.gob.pe/VirtualSAT/modulos/papeletas.aspx',
    description: 'Papeletas de tránsito impuestas en Lima Metropolitana.',
    scope: 'Lima',
    note: 'En el menú "Consultas en línea" toca el ícono "Consulta de papeletas / Multas Administrativas" (el portal de SAT no permite enlace directo a la sub-consulta).',
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
    name: 'Consulta en línea SATP',
    entity: 'SAT de Piura',
    category: 'PAPELETAS',
    url: 'https://web.satp.gob.pe/servicios/consulta-en-linea',
    description: 'Papeletas e impuesto vehicular en Piura.',
    scope: 'Piura',
  },
  {
    id: 'satica-ica',
    name: 'Consulta de Papeletas SATICA',
    entity: 'SAT de Ica',
    category: 'PAPELETAS',
    url: 'https://www.satica.gob.pe/servicios/consulta-de-papeletas',
    description: 'Papeletas e impuesto vehicular en Ica.',
    scope: 'Ica',
  },
  {
    id: 'sath-huancayo',
    name: 'Huancayo Virtual (SATH)',
    entity: 'Municipalidad de Huancayo',
    category: 'PAPELETAS',
    url: 'https://www.munihuancayo.gob.pe/virtual/',
    description: 'Consulta de deuda y papeletas del SATH en Huancayo (Junín).',
    scope: 'Junín',
  },
  {
    id: 'satch-chiclayo',
    name: 'VirtualSATCH',
    entity: 'SAT de Chiclayo',
    category: 'PAPELETAS',
    url: 'https://virtualsatch.satch.gob.pe/',
    description: 'Record de infracciones y papeletas por placa en Chiclayo (Lambayeque).',
    scope: 'Lambayeque',
  },
  {
    id: 'satcaj-cajamarca',
    name: 'Consultas en línea SAT Cajamarca',
    entity: 'SAT de Cajamarca',
    category: 'PAPELETAS',
    url: 'https://www.satcajamarca.gob.pe/#/consultas',
    description: 'Papeletas e impuesto vehicular en Cajamarca.',
    scope: 'Cajamarca',
  },
  {
    id: 'sat-tarapoto',
    name: 'SAT Tarapoto',
    entity: 'SAT de Tarapoto',
    category: 'PAPELETAS',
    url: 'https://www.sat-t.gob.pe/',
    description: 'Papeletas e impuesto vehicular en Tarapoto (San Martín).',
    scope: 'San Martín',
  },
  {
    id: 'tacna-papeletas',
    name: 'Papeletas — Municipalidad de Tacna',
    entity: 'MP Tacna',
    category: 'PAPELETAS',
    url: 'https://www.munitacna.gob.pe/pagina/sf/servicios/papeletas',
    description: 'Papeletas de infracción de tránsito en Tacna.',
    scope: 'Tacna',
  },
  {
    id: 'arequipa-papeletas',
    name: 'Papeletas — Municipalidad de Arequipa',
    entity: 'MP Arequipa',
    category: 'PAPELETAS',
    url: 'https://www.muniarequipa.gob.pe/oficina-virtual/c0nInfrPermisos/faltas/papeletas.php',
    description: 'Infracciones y papeletas de tránsito en Arequipa.',
    scope: 'Arequipa',
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
    url: 'https://www.sat.gob.pe/WebSitev8/IncioOV2.aspx',
    description: 'Deuda del impuesto al patrimonio vehicular (vehículos de hasta 3 años) en Lima.',
    scope: 'Lima',
    note: 'En el menú "Consultas en línea" toca "Consulta Tributos". El impuesto es municipal: otras provincias en su SAT.',
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
    note: 'En el menú "Consultas en línea" toca "Captura de vehículos".',
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
  TRANSPORTE: 'Habilitación de transporte / taxi',
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
  'TRANSPORTE',
  'GNV',
  'PAPELETAS',
  'IMPUESTO_VEHICULAR',
  'CAPTURA',
  'INFRACCIONES',
];
