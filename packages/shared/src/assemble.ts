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
import { maskOwnerName } from './mask.js';

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

  // Deduplicar por tipo de sección: varias fuentes pueden cubrir el mismo kind
  // (p. ej. SBS y APESEG → SEGUROS). Se prefiere AVAILABLE, luego NOT_FOUND.
  const rank = (status: string): number =>
    status === SectionStatus.AVAILABLE ? 3 : status === SectionStatus.NOT_FOUND ? 2 : 1;
  const bestByKind = new Map<string, SourceResult>();
  for (const s of sources) {
    const current = bestByKind.get(s.kind);
    if (!current || rank(s.status) > rank(current.status)) bestByKind.set(s.kind, s);
  }

  const sections: SectionResult[] = [...bestByKind.values()].map((s) => ({
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
    // PII minimizada (Ley 29733): se enmascara el titular ANTES de persistir/servir. Empresas quedan
    // tal cual (razón social/RUC públicos). El dato crudo solo vive en la fuente del VPS (operador).
    const maskedOwner = maskOwnerName(sources.find((s) => s.ownerName)?.ownerName ?? null);
    const owner: OwnerInfo | null = maskedOwner ? { name: maskedOwner, note: OWNER_NOTE } : null;
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
