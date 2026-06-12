import {
  COMING_SOON_SECTIONS,
  MVP_SECTIONS,
  SectionStatus,
  ReportStatus,
} from './enums.js';
import {
  DISCLAIMER_TEXT,
  OWNER_NOTE,
  type Report,
  type SectionResult,
  type SourceResult,
  type VehicleData,
  type OwnerInfo,
} from './report.js';

export interface BuildReportInput {
  id: string;
  plateDisplay: string;
  plateNormalized: string;
  generatedAt: string;
  sources: SourceResult[];
}

/**
 * Función pura: combina los SourceResult de los scrapers en un Report consolidado.
 * - Añade siempre las secciones "Próximamente" (FR-032).
 * - Marca status=PARTIAL si alguna sección MVP quedó UNAVAILABLE (FR-034).
 * - Consolida los datos de vehículo y el titular (minimizado) desde las fuentes.
 * - Incluye el disclaimer legal (FR-033).
 */
export function buildReport(input: BuildReportInput): Report {
  const { id, plateDisplay, generatedAt, sources } = input;

  const sections: SectionResult[] = sources.map((s) => ({
    kind: s.kind,
    source: s.source,
    status: s.status,
    fetchedAt: s.fetchedAt,
    errorReason: s.errorReason ?? null,
    payload: s.payload,
  }));

  // Secciones "Próximamente" que no provienen de ninguna fuente.
  for (const kind of COMING_SOON_SECTIONS) {
    sections.push({ kind, source: null, status: SectionStatus.COMING_SOON, fetchedAt: null });
  }

  // Vehículo: combinar datos aportados por las fuentes (SUNARP es la principal).
  let vehicle: (VehicleData & { owner: OwnerInfo | null }) | null = null;
  const vehicleParts = sources.filter((s) => s.vehicle).map((s) => s.vehicle!);
  if (vehicleParts.length > 0) {
    const merged = Object.assign({}, ...vehicleParts) as Partial<VehicleData>;
    const ownerName = sources.find((s) => s.ownerName)?.ownerName ?? null;
    const owner: OwnerInfo | null = ownerName ? { name: ownerName, note: OWNER_NOTE } : null;
    vehicle = {
      brand: merged.brand ?? null,
      model: merged.model ?? null,
      year: merged.year ?? null,
      color: merged.color ?? null,
      serie: merged.serie ?? null,
      vin: merged.vin ?? null,
      engineNumber: merged.engineNumber ?? null,
      plateDisplay: merged.plateDisplay ?? plateDisplay,
      platePrevious: merged.platePrevious ?? null,
      stolenAlert: merged.stolenAlert ?? false,
      owner,
    };
  }

  // PARTIAL si alguna sección MVP esperada quedó no disponible.
  const mvpUnavailable = sections.some(
    (s) => MVP_SECTIONS.includes(s.kind) && s.status === SectionStatus.UNAVAILABLE,
  );
  const status = mvpUnavailable ? ReportStatus.PARTIAL : ReportStatus.COMPLETE;

  return {
    id,
    placa: plateDisplay,
    status,
    generatedAt,
    disclaimer: DISCLAIMER_TEXT,
    vehicle,
    sections,
  };
}
