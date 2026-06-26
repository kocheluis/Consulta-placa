import {
  buildReport,
  SectionKind,
  SectionStatus,
  SourceId,
  type SourceResult,
  type Report,
  type InsurancePolicy,
  type SiniestroIndicator,
  type CapturaIndicator,
  type RevisionTecnica,
  type PapeletasPayload,
  type PapeletaItem,
  type GravamenesPayload,
} from '@app/shared';
import type { OperatorSourceResult } from './index.js';

/**
 * Transforma los resultados crudos del motor del operador (por fuente) al `Report`
 * normalizado que renderiza la web (`@app/shared`). Mapea cada fuente a un `SourceResult`
 * y delega el ensamblado (vehículo, titular, secciones "Próximamente", PARTIAL, disclaimer)
 * a `buildReport`. Es el puente que conecta la trastienda (VPS) con el cliente (placape.pe).
 */
const toStatus = (s: string): SectionStatus =>
  s === 'ENCONTRADO' ? SectionStatus.AVAILABLE
    : s === 'SIN_REGISTRO' ? SectionStatus.NOT_FOUND
      : SectionStatus.UNAVAILABLE;

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export function toWebReport(plate: string, results: OperatorSourceResult[], generatedAt: string, id: string): Report {
  const by = (source: string): OperatorSourceResult | undefined => results.find((r) => r.source === source);
  const data = (r?: OperatorSourceResult): Record<string, unknown> => (r?.data ?? {}) as Record<string, unknown>;
  const at = generatedAt;
  const src: SourceResult[] = [];

  // ── REGISTRAL + vehículo + titular (SUNARP) ──
  const sunarp = by('SUNARP');
  if (sunarp) {
    const d = data(sunarp);
    src.push({
      kind: SectionKind.REGISTRAL, source: SourceId.SUNARP, status: toStatus(sunarp.status), fetchedAt: at,
      vehicle: {
        brand: (d.brand as string) ?? null, model: (d.model as string) ?? null,
        year: (d.year as number) ?? null, color: (d.color as string) ?? null,
        serie: (d.serie as string) ?? null, vin: (d.vin as string) ?? null,
        engineNumber: (d.engineNumber as string) ?? null, plateDisplay: (d.plateDisplay as string) ?? plate,
        platePrevious: (d.platePrevious as string) ?? null, stolenAlert: Boolean(d.stolenAlert),
        registralStatus: (d.registralStatus as string) ?? null, annotations: (d.annotations as string) ?? null,
        sede: (d.sede as string) ?? null,
      },
      ownerName: (d.ownerName as string) ?? null,
    });
  }

  // ── SEGUROS / SOAT (APESEG completo; si no, SBS sólo aseguradora) ──
  const apeseg = by('APESEG_SOAT');
  const sbs = by('SBS_SOAT');
  if (apeseg?.status === 'ENCONTRADO') {
    const d = data(apeseg) as Record<string, string>;
    const pol: InsurancePolicy = {
      hasActiveSoat: /VIGENTE/i.test(d.estado ?? ''), insurer: d.compania ?? null, policyNumber: null,
      validFrom: d.inicio ?? null, validTo: d.fin ?? null, certificate: d.certificado ?? null,
      use: d.uso ?? null, vehicleClass: d.clase ?? null, policyType: d.tipo ?? null,
    };
    src.push({ kind: SectionKind.SEGUROS, source: SourceId.APESEG, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: pol });
  } else if (sbs?.status === 'ENCONTRADO') {
    const d = data(sbs) as Record<string, string>;
    const pol: InsurancePolicy = { hasActiveSoat: !!d.compania, insurer: d.compania ?? null, policyNumber: null, validFrom: null, validTo: null };
    src.push({ kind: SectionKind.SEGUROS, source: SourceId.SBS, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: pol });
  } else if (sbs || apeseg) {
    src.push({ kind: SectionKind.SEGUROS, source: SourceId.SBS, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
  }

  // ── SINIESTRALIDAD (accidentes SBS o subasta de siniestro Superbid/VMC) ──
  const superbid = by('SUPERBID');
  const sbsAccidentes = sbs?.status === 'ENCONTRADO' ? num(data(sbs).accidentes) : null;
  // La fuente Superbid es un lookup en el índice (DB): ENCONTRADO = la placa salió en una
  // subasta; sus banderas (siniestro/aseguradora/remate) vienen en data.flags.
  const subFound = superbid?.status === 'ENCONTRADO';
  const subFlags = (data(superbid).flags ?? {}) as Record<string, boolean>;
  if (sbsAccidentes != null || subFound) {
    const hasSiniestro = (sbsAccidentes != null && sbsAccidentes > 0) || (subFound && (subFlags.siniestro || subFlags.aseguradora));
    const pay: SiniestroIndicator = { hasSiniestro: Boolean(hasSiniestro), periodYears: 5 };
    src.push({ kind: SectionKind.SINIESTRALIDAD, source: SourceId.SBS, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: pay });
  } else if (sbs) {
    src.push({ kind: SectionKind.SINIESTRALIDAD, source: SourceId.SBS, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
  }

  // ── CAPTURA (SAT Lima) ──
  const cap = by('SAT_CAPTURA');
  if (cap) {
    if (cap.status === 'ENCONTRADO' || cap.status === 'SIN_REGISTRO') {
      const d = data(cap);
      const pay: CapturaIndicator = { hasCapture: Boolean(d.ordenDeCaptura), detail: (d.detalle as string) ?? null };
      src.push({ kind: SectionKind.CAPTURA, source: SourceId.SAT, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: pay });
    } else {
      src.push({ kind: SectionKind.CAPTURA, source: SourceId.SAT, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
    }
  }

  // ── PAPELETAS (SAT Lima + Callao) ──
  const satP = by('SAT_PAPELETAS');
  const callao = by('CALLAO_PAPELETAS');
  if (satP || callao) {
    const items: PapeletaItem[] = [];
    if (satP?.status === 'ENCONTRADO') items.push({ type: 'Infracciones Lima', entity: 'SAT Lima', date: null, amount: 0, status: 'PENDIENTE' });
    const callaoAmt = callao?.status === 'ENCONTRADO' ? num(data(callao).total) : 0;
    if (callaoAmt > 0) items.push({ type: 'Papeletas Callao', entity: 'SAT Callao', date: null, amount: callaoAmt, status: 'PENDIENTE' });
    const anyOk = [satP, callao].some((r) => r && r.status !== 'ERROR');
    const pay: PapeletasPayload = { total: items.length, pendingAmount: callaoAmt, items };
    src.push({ kind: SectionKind.PAPELETAS, source: SourceId.SAT, status: anyOk ? SectionStatus.AVAILABLE : SectionStatus.UNAVAILABLE, fetchedAt: at, payload: pay });
  }

  // ── REVISIÓN TÉCNICA (MTC CITV) ──
  const mtc = by('MTC_CITV');
  if (mtc) {
    if (mtc.status === 'ENCONTRADO') {
      const certs = ((data(mtc).certificados ?? []) as Array<Record<string, string>>);
      const vigente = certs.some((c) => /VIGENTE/i.test(c.estado ?? ''));
      const latest = certs[0];
      const pay: RevisionTecnica = {
        hasValid: vigente, status: vigente ? 'Vigente' : certs.length ? 'Vencida' : null,
        lastInspection: latest?.vigenteDesde ?? null, validUntil: latest?.vigenteHasta ?? null, result: latest?.resultado ?? null,
      };
      src.push({ kind: SectionKind.REVISION_TECNICA, source: SourceId.MTC, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: pay });
    } else {
      src.push({ kind: SectionKind.REVISION_TECNICA, source: SourceId.MTC, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
    }
  }

  // ── GRAVÁMENES (banderas del historial registral) ──
  const hist = by('HISTORIAL');
  if (hist?.status === 'ENCONTRADO') {
    const f = (data(hist).flags ?? {}) as Record<string, boolean>;
    const pay: GravamenesPayload = { hasLiens: Boolean(f.gravamen || f.embargo), total: 0, items: [] };
    src.push({ kind: SectionKind.GRAVAMENES, source: SourceId.SUNARP, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: pay });
  }

  const report = buildReport({ id, plateDisplay: plate, plateNormalized: plate, generatedAt: at, sources: src });
  // buildReport agrega COMING_SOON aunque ya aportemos la sección (p. ej. PAPELETAS) → dedupe por kind.
  const seen = new Set<string>();
  report.sections = report.sections.filter((s) => (seen.has(s.kind) ? false : (seen.add(s.kind), true)));
  return report;
}
