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
  /** ¿Tiene el seguro obligatorio vigente (SOAT o, en taxis, CAT)? */
  hasActiveSoat: boolean;
  /** Tipo que arrojó datos: "SOAT" | "CAT" | "Vehicular". Los taxis usan CAT en vez de SOAT. */
  insuranceType?: string;
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

/** Un siniestro reportado a la SBS, agrupado por la póliza (periodo) bajo la que se cubrió. */
export interface Siniestro {
  /** Tipo de seguro bajo el que se reportó: "SOAT" | "VEHICULAR" | "CAT". */
  tipo: string;
  /** Aseguradora / AFOCAT de la póliza. */
  aseguradora: string | null;
  /** Inicio de vigencia de la póliza (dd/mm/aaaa). */
  desde: string | null;
  /** Fin de vigencia de la póliza (dd/mm/aaaa). */
  hasta: string | null;
  /** N° de accidentes reportados bajo esa póliza. */
  cantidad: number;
}

/** Payload de la sección SINIESTRALIDAD. */
export interface SiniestroIndicator {
  hasSiniestro: boolean;
  periodYears: number;
  /** N° TOTAL de accidentes reportados a la SBS (suma de todas las pólizas: SOAT/Vehicular/CAT). */
  accidentes?: number | null;
  /** Detalle por periodo: en qué pólizas/vigencias se reportaron siniestros (SBS, 3 tipos). */
  siniestros?: Siniestro[];
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

/** Detalle de una papeleta concreta del portal (SAT Lima), tal como la lista el resultado. */
export interface PapeletaDetalle {
  /** N° de papeleta/documento. */
  numero: string | null;
  /** Fecha de la infracción (dd/mm/aaaa). */
  fecha: string | null;
  /** Código/descripción de la falta (p. ej. "M27"). */
  infraccion: string | null;
  /** Importe de la papeleta (S/). */
  monto: number | null;
  /** Estado (Pendiente, En cobranza coactiva, etc.), si el portal lo indica. */
  estado: string | null;
}

/** Payload de la sección PAPELETAS (SAT municipal + SUTRAN cinemómetro). */
export interface PapeletasPayload {
  /** N° de "conceptos" (una entrada por jurisdicción con papeletas). Gate de "sin papeletas". */
  total: number;
  /** N° total de papeletas individuales (Lima + Callao), si se pudo contar. */
  count?: number;
  pendingAmount: number;
  items: PapeletaItem[];
  /** Detalle de papeletas individuales de SAT Lima (número, fecha, falta, importe), si el portal
   *  las listó y el parser las reconoció. Vacío/ausente → la web cae al conteo + total. */
  detalle?: PapeletaDetalle[];
  /** Jurisdicciones efectivamente consultadas (p. ej. ["Lima (SAT)", "Callao"]). */
  checkedScopes?: string[];
  /** Monto con beneficio de pronto pago (descuento) si el portal lo ofrece. */
  benefitAmount?: number;
  /** Fecha límite del beneficio de pronto pago, tal como la muestra el portal (dd/mm/aaaa). */
  benefitUntil?: string | null;
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
  /** Tipo de servicio/ámbito del CITV (p. ej. "PROVINCIAL TRANSPORTE ESPECIAL DE PERSONAS - TAXI"). */
  serviceType?: string | null;
  /** Observaciones REALES del CITV (defectos), ya sin el tipo de servicio mezclado. */
  observaciones?: string | null;
  /** Mención a lunas polarizadas/oscurecidas en el CITV. */
  lunasPolarizadas?: string | null;
}

/** Payload de la sección TRANSPORTE (ATU — uso como taxi/transporte). */
export interface TransporteInfo {
  isPublicTransport: boolean;
  modality: string | null;
  detail: string | null;
  /** Titular de la habilitación (empresa o persona). PII de tercero: enmascarar antes de
   *  producción según se decida (retirar, o dejar nombre + 3 letras del apellido + ***). */
  holder?: string | null;
  /** Documento del titular (p. ej. "DNI 08701061" / "RUC 20..."). PII: ver `holder`. */
  holderDoc?: string | null;
  /** Vigencia de la habilitación (p. ej. "Habilitado hasta 31/12/2029"). */
  validUntil?: string | null;
}

/**
 * Payload de la sección IDENTIDAD_ESPECIFICA (asiento registral SUNARP vía Síguelo).
 * Ficha técnica que la Consulta Vehicular GRATUITA no entrega: N° de versión, carrocería,
 * combustible, cilindrada, potencia, dimensiones y pesos. Se toma del asiento más reciente
 * que contenga la ficha (Primera Inscripción / Cambio de Características), de modo que refleja
 * el estado ACTUAL del vehículo (p. ej. tras conversión a GNV o cambio de color). Todos los
 * campos son texto tal como los declara el registro (conservan unidades: "1.488 L", "4.533 mt").
 */
export interface VehicleSpecs {
  /** N° de Versión — el dato estrella (p. ej. "GL-I GNV"). Diferencia trim/equipamiento. */
  version: string | null;
  /** Categoría vehicular (p. ej. "M1"). */
  category: string | null;
  /** Tipo de uso declarado (p. ej. "Taxis y Colectivos (Categoría M1)"). */
  usage: string | null;
  /** Tipo de carrocería (p. ej. "SEDAN"). */
  bodywork: string | null;
  /** Tipo de combustible (p. ej. "BI-COMBUSTIBLE GNV"). */
  fuel: string | null;
  /** Cilindrada con unidad (p. ej. "1.488 L"). */
  displacement: string | null;
  /** N° de cilindros (p. ej. "4"). */
  cylinders: string | null;
  /** Potencia del motor (p. ej. "78@6000"). */
  power: string | null;
  /** N° de ejes (p. ej. "2"). */
  axles: string | null;
  /** N° de ruedas (p. ej. "4"). */
  wheels: string | null;
  /** Fórmula rodante (p. ej. "4X2"). */
  driveFormula: string | null;
  /** N° de asientos (p. ej. "5"). */
  seats: string | null;
  /** N° de pasajeros (p. ej. "4"). */
  passengers: string | null;
  /** Longitud con unidad (p. ej. "4.533 mt"). */
  length: string | null;
  /** Ancho con unidad (p. ej. "1.705 mt"). */
  width: string | null;
  /** Altura con unidad (p. ej. "1.49 mt"). */
  height: string | null;
  /** Peso bruto con unidad (p. ej. "2.075 tn"). */
  grossWeight: string | null;
  /** Peso neto/seco con unidad (p. ej. "1.200 tn"). */
  netWeight: string | null;
  /** Carga útil con unidad (p. ej. "0.875 tn"). */
  payload: string | null;
  /** Título del asiento del que se tomó la ficha (trazabilidad, p. ej. "2025-3325177"). */
  sourceTitle?: string | null;
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
  /** Motivo/descripción del incumplimiento (SIGM, cuando la garantía está EN EJECUCIÓN). */
  detail?: string | null;
  /** Folio causal electrónico (SIGM), para trazabilidad. */
  folio?: string | null;
}

/** Payload de la sección GRAVAMENES (SIGM — garantías mobiliarias + cargas SUNARP). */
export interface GravamenesPayload {
  /** true si el vehículo registra alguna carga/garantía vigente. */
  hasLiens: boolean;
  total: number;
  items: GravamenItem[];
}

/** Una acción/acto individual dentro de un asiento registral. */
export interface HistorialAccion {
  /** Acto registral: "Compra-Venta", "Cancelación de Afectación", etc. */
  act: string | null;
  /** Precio/monto declarado del acto (texto, p. ej. "US$ 16,000.00"). */
  price: string | null;
  /** Partes intervinientes (comprador/vendedor, o deudor/acreedor), texto. */
  parties: string | null;
}

/**
 * Un evento del historial = UN asiento registral (SPRL/Síguelo), agrupado por su número de título.
 * Un asiento puede registrar VARIAS acciones (p. ej. dos compra-ventas en tracto sucesivo, o una
 * cancelación + una compra-venta): se listan en `acciones`, con sus montos POR SEPARADO — nunca se
 * suman ni se cuentan como asientos distintos.
 */
export interface HistorialEvent {
  /** Fecha de presentación o del asiento (texto, formato dd/mm/aaaa). */
  date: string | null;
  /** N° de título/asiento (AAAA-NNNNNN). */
  title: string | null;
  /** Acciones registradas en este asiento (≥1). */
  acciones: HistorialAccion[];
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
  /** Banderas de riesgo halladas en el historial. `gravamen` = si la sección Gravámenes tiene
   *  alguna carga (vigente o levantada) que revisar → evita mandar a Gravámenes cuando está vacío. */
  flags: { aseguradora: boolean; remate: boolean; financiera: boolean; gravamen?: boolean };
  /** Eventos ordenados cronológicamente (más reciente primero al renderizar). */
  events: HistorialEvent[];
}

/** Una bandera de riesgo priorizada por la IA. */
export interface IaFlag {
  title: string;
  /** Severidad: alta (rojo) · media (ámbar) · baja (informativa). */
  severity: 'alta' | 'media' | 'baja';
  detail: string;
}

/**
 * Payload de la sección IA (ULTRA): recomendación de compra generada por Claude a partir
 * de TODO el reporte (identidad, historial, papeletas, gravámenes, siniestros, SOAT, CITV).
 * No inventa valorización de mercado: el comentario de precio se basa solo en los precios
 * declarados del historial + antigüedad, con su salvedad.
 */
export interface IaAnalysis {
  /** Veredicto global. */
  verdict: 'comprar' | 'precaucion' | 'evitar';
  /** Resumen ejecutivo (2-4 frases). */
  summary: string;
  /** Recomendación accionable para el comprador. */
  recommendation: string;
  /** Comentario cualitativo sobre el precio (no es una tasación de mercado). */
  priceComment: string;
  /** Banderas de riesgo priorizadas. */
  redFlags: IaFlag[];
  /** Puntos a favor. */
  positives: string[];
  /** Estimación del precio BASE de mercado (marca/modelo/versión/año) que hace la IA. La sección
   *  VALORIZACION la usa como ancla; el motor determinístico calcula las bandas de km y los ajustes. */
  valuation?: IaMarketBase | null;
  /** Modelo que generó el análisis (trazabilidad). */
  model?: string;
}

/** Precio base de mercado estimado por la IA (buen estado, km promedio para la antigüedad), en soles. */
export interface IaMarketBase {
  /** Rango base en S/ (0 si la IA no pudo estimar — modelo poco común/importado). */
  baseMin: number;
  baseMax: number;
  confidence: 'alta' | 'media' | 'baja';
  /** En qué se basó (versión, año, tipo de cambio, comparables conocidos). */
  basis: string;
}

/** Precio estimado para un rango de kilometraje (banda de uso). */
export interface ValuationBand {
  /** Etiqueta ("Uso bajo", "Uso promedio", "Uso alto", "Uso muy alto"). */
  label: string;
  /** Rango de km textual ("~45 000–85 000 km"). */
  kmRange: string;
  priceMin: number;
  priceMax: number;
  /** true en la banda que corresponde al km esperado por antigüedad (referencia principal). */
  isExpected?: boolean;
}

/** Un ajuste al precio por la condición del vehículo (derivado del reporte). */
export interface ValuationAdjustment {
  factor: string;
  /** Impacto legible: "−22%", "−S/ 990", "Informativo". */
  impact: string;
  detail: string;
}

/**
 * Payload de la sección VALORIZACION (ULTRA). Como el kilometraje real NO es público en Perú,
 * se dan precios por BANDAS de km (uso bajo/promedio/alto), partiendo de un precio base de mercado
 * (marca/modelo/versión/año, estimado por la IA) y ajustando por la condición hallada en el reporte
 * (siniestro, uso taxi, GNV, gravamen vigente, papeletas, nº de dueños, RTV vencida, robo).
 */
export interface Valuation {
  currency: 'PEN';
  /** false si no se pudo estimar el precio base (sin bandas). */
  available: boolean;
  baseMin: number;
  baseMax: number;
  /** Km esperado por antigüedad (≈15 000 km/año); null si no se conoce el año. */
  expectedKm: number | null;
  bands: ValuationBand[];
  adjustments: ValuationAdjustment[];
  /** Rango final estimado (banda esperada, con ajustes aplicados). */
  netMin: number;
  netMax: number;
  confidence: 'alta' | 'media' | 'baja';
  basis: string;
  /** true = robo vigente u otra señal que desaconseja la compra → no se valoriza como normal. */
  blocked?: boolean;
  disclaimer: string;
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
