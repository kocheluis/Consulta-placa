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
  | 'INFRACCIONES'
  | 'PAPELETAS';

export interface OfficialLink {
  id: string;
  name: string;
  entity: string;
  category: LinkCategory;
  url: string;
  description: string;
  /** Cobertura: nacional o solo una jurisdicción. */
  scope: 'Nacional' | 'Lima';
}

export const OFFICIAL_LINKS: OfficialLink[] = [
  {
    id: 'sunarp',
    name: 'Consulta Vehicular',
    entity: 'SUNARP',
    category: 'REGISTRAL',
    url: 'https://consultavehicular.sunarp.gob.pe/',
    description: 'Titular, marca, modelo, año, color, serie/VIN/motor y alerta de robo.',
    scope: 'Nacional',
  },
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
  {
    id: 'mtc-citv',
    name: 'Récord de Revisión Técnica (CITV)',
    entity: 'MTC',
    category: 'REVISION_TECNICA',
    url: 'https://portal.mtc.gob.pe/reportedgtt/form/frmConsultaCITV.aspx',
    description: 'Certificados de inspección técnica vehicular y su vigencia.',
    scope: 'Nacional',
  },
  {
    id: 'sutran',
    name: 'Consulta de Infracciones',
    entity: 'SUTRAN',
    category: 'INFRACCIONES',
    url: 'https://www.sutran.gob.pe/registro-de-infracciones/',
    description: 'Infracciones de tránsito en la red vial nacional (carreteras).',
    scope: 'Nacional',
  },
  {
    id: 'sat-lima',
    name: 'Consulta de Papeletas',
    entity: 'SAT de Lima',
    category: 'PAPELETAS',
    url: 'https://www.sat.gob.pe/VirtualSAT/modulos/ConsultaPapeletas.aspx',
    description: 'Papeletas de tránsito impuestas en Lima Metropolitana.',
    scope: 'Lima',
  },
];

export const CATEGORY_LABELS: Record<LinkCategory, string> = {
  REGISTRAL: 'Datos registrales',
  SEGUROS: 'Seguro (SOAT) y siniestros',
  REVISION_TECNICA: 'Revisión técnica',
  INFRACCIONES: 'Infracciones',
  PAPELETAS: 'Papeletas',
};
