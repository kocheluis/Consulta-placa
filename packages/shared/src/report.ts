import type {
  SourceId,
  SectionKind,
  SectionStatus,
  ReportStatus,
} from './enums.js';

/** Datos registrales no personales del vehículo. */
export interface VehicleData {
  brand: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  serie: string | null;
  vin: string | null;
  engineNumber: string | null;
  plateDisplay: string;
  platePrevious: string | null;
  stolenAlert: boolean;
}

/** Titular — dato personal, minimizado. */
export interface OwnerInfo {
  name: string;
  note: string;
}

/** Payload de la sección SEGUROS. */
export interface InsurancePolicy {
  hasActiveSoat: boolean;
  insurer: string | null;
  policyNumber: string | null;
  validFrom: string | null;
  validTo: string | null;
}

/** Payload de la sección SINIESTRALIDAD. */
export interface SiniestroIndicator {
  hasSiniestro: boolean;
  periodYears: number;
}

/**
 * Resultado crudo que devuelve un scraper para una sección concreta.
 * Es el contrato estable que aísla la fragilidad de las fuentes externas.
 */
export interface SourceResult {
  kind: SectionKind;
  source: SourceId;
  status: SectionStatus;
  fetchedAt: string | null;
  errorReason?: string | null;
  payload?: unknown;
  /** Datos de vehículo aportados por esta fuente (p. ej. SUNARP). */
  vehicle?: Partial<VehicleData>;
  /** Nombre del titular, si la fuente lo expone (dato personal). */
  ownerName?: string | null;
}

/** Sección ya ensamblada para la respuesta al cliente. */
export interface SectionResult {
  kind: SectionKind;
  source: SourceId | null;
  status: SectionStatus;
  fetchedAt: string | null;
  errorReason?: string | null;
  payload?: unknown;
}

/** Reporte consolidado entregado al cliente. */
export interface Report {
  id: string;
  placa: string;
  status: ReportStatus;
  generatedAt: string;
  disclaimer: string;
  vehicle: (VehicleData & { owner: OwnerInfo | null }) | null;
  sections: SectionResult[];
}

export const DISCLAIMER_TEXT =
  'Información referencial obtenida de portales públicos oficiales (SUNARP, SBS, APESEG). ' +
  'No constituye un certificado oficial. Los datos pueden variar respecto a la fuente al momento de su consulta.';

export const OWNER_NOTE = 'Dato registral público de SUNARP — uso referencial.';
