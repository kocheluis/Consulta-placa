import type {
  SourceId,
  SectionKind,
  SectionStatus,
  ReportStatus,
} from './enums.js';

/** Datos registrales no personales del vehículo (SUNARP Consulta Vehicular). */
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
  /** Estado registral, p. ej. "EN CIRCULACION". */
  registralStatus?: string | null;
  /** Anotaciones registrales, p. ej. "NINGUNA". */
  annotations?: string | null;
  /** Sede registral SUNARP, p. ej. "LIMA". */
  sede?: string | null;
}

/** Titular — dato personal, minimizado. */
export interface OwnerInfo {
  name: string;
  note: string;
}

/** Payload de la sección SEGUROS / SOAT (APESEG). */
export interface InsurancePolicy {
  hasActiveSoat: boolean;
  insurer: string | null;
  policyNumber: string | null;
  validFrom: string | null;
  validTo: string | null;
  /** N° de certificado SOAT. */
  certificate?: string | null;
  /** Uso, p. ej. "PARTICULAR". */
  use?: string | null;
  /** Clase, p. ej. "CAMIONETA SUV/RURAL". */
  vehicleClass?: string | null;
  /** Tipo de póliza, p. ej. "DIGITAL". */
  policyType?: string | null;
}

/** Subasta detectada (Superbid/VMC) — señal de siniestro/remate. */
export interface AuctionInfo {
  /** Nombre/etiqueta de la subasta, p. ej. "23º SUBASTA RIMAC". */
  subasta: string | null;
  /** "abierta" / "cerrada". */
  estado: string | null;
  /** Portal de origen: "SUPERBID" / "VMC". */
  fuente: string | null;
  /** Tipo derivado de las banderas: "siniestro" / "aseguradora" / "remate". */
  tipo: string | null;
  /** URL de la boleta informativa SUNARP del lote (si está). */
  boletaUrl: string | null;
}

/** Payload de la sección SINIESTRALIDAD. */
export interface SiniestroIndicator {
  hasSiniestro: boolean;
  periodYears: number;
  /** N° de accidentes reportados al SOAT (SBS), si se conoce. */
  accidentes?: number | null;
  /** Detalle de la subasta si la placa apareció en un remate de siniestro. */
  auction?: AuctionInfo | null;
}

/** Una papeleta/infracción individual. */
export interface PapeletaItem {
  type: string;
  entity: string;
  date: string | null;
  amount: number;
  status: string;
}

/** Payload de la sección PAPELETAS (SAT municipal + SUTRAN cinemómetro). */
export interface PapeletasPayload {
  total: number;
  pendingAmount: number;
  items: PapeletaItem[];
  /** Jurisdicciones efectivamente consultadas (p. ej. ["Lima (SAT)", "Callao"]). */
  checkedScopes?: string[];
}

/** Payload de la sección CAPTURA (orden de captura SAT). */
export interface CapturaIndicator {
  hasCapture: boolean;
  detail: string | null;
}

/** Payload de la sección REVISION_TECNICA (MTC). */
export interface RevisionTecnica {
  hasValid: boolean;
  status: string | null;
  lastInspection: string | null;
  validUntil: string | null;
  result: string | null;
  /** N° del último certificado CITV. */
  certificate?: string | null;
  /** Observaciones del CITV (si las hay). */
  observaciones?: string | null;
  /** Mención a lunas polarizadas/oscurecidas en el CITV. */
  lunasPolarizadas?: string | null;
}

/** Payload de la sección TRANSPORTE (ATU — uso como taxi/transporte). */
export interface TransporteInfo {
  isPublicTransport: boolean;
  modality: string | null;
  detail: string | null;
}

/** Payload de la sección MULTAS_ELECTORALES (ONPE, por DNI del titular). */
export interface MultasElectorales {
  hasFine: boolean;
  amount: number | null;
  detail: string | null;
}

/** Una carga/gravamen individual (SIGM / SUNARP). */
export interface GravamenItem {
  /** Tipo: "Garantía mobiliaria", "Prenda vehicular", "Embargo", etc. */
  type: string;
  /** Acreedor o entidad a favor de quien se inscribe. */
  creditor: string | null;
  amount: number | null;
  date: string | null;
  /** VIGENTE / LEVANTADO. */
  status: string;
}

/** Payload de la sección GRAVAMENES (SIGM — garantías mobiliarias + cargas SUNARP). */
export interface GravamenesPayload {
  /** true si el vehículo registra alguna carga/garantía vigente. */
  hasLiens: boolean;
  total: number;
  items: GravamenItem[];
}

/** Un evento del historial registral (un asiento de SPRL/Síguelo). */
export interface HistorialEvent {
  /** Fecha de presentación o del asiento (texto, formato dd/mm/aaaa). */
  date: string | null;
  /** Acto registral: "Compraventa", "Garantía mobiliaria", etc. */
  act: string | null;
  /** N° de título (AAAA-NNNNNN). */
  title: string | null;
  /** Precio declarado del acto (texto, p. ej. "US$ 12,000.00"). */
  price: string | null;
  /** Partes intervinientes (comprador/vendedor), texto. */
  parties: string | null;
}

/**
 * Payload de la sección HISTORIAL (SPRL + Síguelo): línea de tiempo de asientos
 * registrales con transferencias, precios y banderas de riesgo.
 */
export interface HistorialPayload {
  /** N° total de asientos registrales encontrados. */
  totalAsientos: number;
  /** N° de títulos. */
  totalTitulos: number;
  /** N° de transferencias de propiedad (compraventas/adjudicaciones). */
  transfers: number;
  /** Banderas de riesgo halladas en el historial. */
  flags: { aseguradora: boolean; remate: boolean; financiera: boolean };
  /** Eventos ordenados cronológicamente (más reciente primero al renderizar). */
  events: HistorialEvent[];
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
