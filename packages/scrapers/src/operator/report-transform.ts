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
  type GravamenItem,
  type HistorialPayload,
  type HistorialEvent,
  type AuctionInfo,
  type TransporteInfo,
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

/** Monto desde texto ("US$ 12,000.00" → 12000) o null si no hay importe. */
const moneyOrNull = (v: unknown): number | null => {
  const s = String(v ?? '').replace(/[^0-9.,]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

/** Colapsa espacios/saltos y recorta a `max` para que el reporte no se descuadre. */
const clip = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max).trim()}…` : s;
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

  // ── SEGUROS / SOAT (SBS = tabla de pólizas con los 7 campos; APESEG si estuviera) ──
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
    const sd = data(sbs);
    const so = (sd.soat ?? {}) as Record<string, string>;
    const pol: InsurancePolicy = {
      hasActiveSoat: Boolean(sd.vigente),
      insurer: so.compania ?? (sd.compania as string) ?? null,
      policyNumber: so.poliza ?? null,
      validFrom: so.inicio ?? null,
      validTo: so.fin ?? null,
      certificate: so.certificado ?? null,
      use: so.uso ?? null,
      vehicleClass: so.clase ?? null,
    };
    src.push({ kind: SectionKind.SEGUROS, source: SourceId.SBS, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: pol });
  } else if (sbs || apeseg) {
    src.push({ kind: SectionKind.SEGUROS, source: SourceId.SBS, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
  }

  // ── SINIESTRALIDAD (accidentes SBS + subasta Superbid/VMC + banderas del historial) ──
  const superbid = by('SUPERBID');
  const hist = by('HISTORIAL');
  const histFlags = (data(hist).flags ?? {}) as Record<string, boolean>;
  const sbsAccidentes = sbs?.status === 'ENCONTRADO' ? num(data(sbs).accidentes) : null;
  // La fuente Superbid es un lookup en el índice (DB): ENCONTRADO = la placa salió en una
  // subasta; sus banderas (siniestro/aseguradora/remate) vienen en data.flags.
  const subFound = superbid?.status === 'ENCONTRADO';
  const subData = data(superbid);
  const subFlags = (subData.flags ?? {}) as Record<string, boolean>;
  // El historial registral con aseguradora/remate es una señal DURA de siniestro
  // (el vehículo fue adjudicado/rematado por una aseguradora tras pérdida total).
  const histSiniestro = hist?.status === 'ENCONTRADO' && (histFlags.aseguradora || histFlags.remate);
  // El periodo se acota a la edad del vehículo: decir "últimos 5 años" de un auto
  // de 2 años no tiene sentido. SBS reporta hasta 5 años; tomamos el menor.
  const vehYear = num(data(sunarp).year);
  const genYear = new Date(at).getFullYear();
  const periodYears = vehYear ? Math.min(5, Math.max(1, genYear - vehYear)) : 5;
  if (sbsAccidentes != null || subFound || histSiniestro) {
    const hasSiniestro =
      (sbsAccidentes != null && sbsAccidentes > 0) ||
      (subFound && (subFlags.siniestro || subFlags.aseguradora)) ||
      Boolean(histSiniestro);
    const auction: AuctionInfo | null = subFound
      ? {
          subasta: (subData.subasta as string) ?? null,
          estado: (subData.estado as string) ?? null,
          fuente: ((subData.fuente as string) ?? 'SUPERBID').toUpperCase(),
          tipo: subFlags.siniestro ? 'siniestro' : subFlags.aseguradora ? 'aseguradora' : subFlags.remate ? 'remate' : null,
          boletaUrl: (subData.boletaUrl as string) ?? null,
        }
      : null;
    const pay: SiniestroIndicator = { hasSiniestro: Boolean(hasSiniestro), periodYears, accidentes: sbsAccidentes, auction };
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
    const limaAmt = satP?.status === 'ENCONTRADO' ? num(data(satP).montoTotal) : 0;
    if (satP?.status === 'ENCONTRADO') items.push({ type: 'Infracciones Lima', entity: 'SAT Lima', date: null, amount: limaAmt, status: 'PENDIENTE' });
    const callaoAmt = callao?.status === 'ENCONTRADO' ? num(data(callao).total) : 0;
    if (callaoAmt > 0) items.push({ type: 'Papeletas Callao', entity: 'SAT Callao', date: null, amount: callaoAmt, status: 'PENDIENTE' });
    const anyOk = [satP, callao].some((r) => r && r.status !== 'ERROR');
    const checkedScopes: string[] = [];
    if (satP && satP.status !== 'ERROR') checkedScopes.push('Lima (SAT)');
    if (callao && callao.status !== 'ERROR') checkedScopes.push('Callao');
    const pay: PapeletasPayload = { total: items.length, pendingAmount: Math.round((limaAmt + callaoAmt) * 100) / 100, items, checkedScopes };
    src.push({ kind: SectionKind.PAPELETAS, source: SourceId.SAT, status: anyOk ? SectionStatus.AVAILABLE : SectionStatus.UNAVAILABLE, fetchedAt: at, payload: pay });
  }

  // ── REVISIÓN TÉCNICA (MTC CITV) ──
  const mtc = by('MTC_CITV');
  if (mtc) {
    if (mtc.status === 'ENCONTRADO') {
      const md = data(mtc);
      const certs = ((md.certificados ?? []) as Array<Record<string, string>>);
      const vigente = certs.some((c) => /VIGENTE/i.test(c.estado ?? ''));
      const latest = certs[0];
      const pay: RevisionTecnica = {
        hasValid: vigente, status: vigente ? 'Vigente' : certs.length ? 'Vencida' : null,
        lastInspection: latest?.vigenteDesde ?? null, validUntil: latest?.vigenteHasta ?? null, result: latest?.resultado ?? null,
        certificate: latest?.nroCertificado ?? null,
        observaciones: (md.observaciones as string) ?? null,
        lunasPolarizadas: (md.lunasPolarizadas as string) ?? null,
      };
      src.push({ kind: SectionKind.REVISION_TECNICA, source: SourceId.MTC, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: pay });
    } else if (mtc.status === 'SIN_REGISTRO') {
      // No hay CITV (auto nuevo / no obligatorio aún): sección disponible y vacía; la web
      // decide el mensaje según la antigüedad del vehículo ("aún no requiere" vs "vencida").
      const pay: RevisionTecnica = { hasValid: false, status: null, lastInspection: null, validUntil: null, result: null };
      src.push({ kind: SectionKind.REVISION_TECNICA, source: SourceId.MTC, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: pay });
    } else {
      src.push({ kind: SectionKind.REVISION_TECNICA, source: SourceId.MTC, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
    }
  }

  // ── TRANSPORTE (ATU · taxi/transporte) ──
  const atu = by('ATU');
  if (atu) {
    if (atu.status === 'ENCONTRADO' || atu.status === 'SIN_REGISTRO') {
      const d = data(atu);
      const detail = [d.estado as string, d.titular as string].filter(Boolean).join(' · ') || null;
      const pay: TransporteInfo = {
        isPublicTransport: Boolean(d.isPublicTransport),
        modality: (d.modalidad as string) ?? null,
        detail,
      };
      src.push({ kind: SectionKind.TRANSPORTE, source: SourceId.ATU, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: pay });
    } else {
      src.push({ kind: SectionKind.TRANSPORTE, source: SourceId.ATU, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
    }
  }

  // ── GRAVÁMENES + HISTORIAL de transferencias (SPRL + Síguelo) ──
  if (hist?.status === 'ENCONTRADO') {
    const hd = data(hist);
    // Línea de tiempo de asientos: transferencias, precios y banderas (antes se descartaba).
    const timeline = (hd.timeline ?? []) as Array<Record<string, unknown>>;

    // Detalle de gravámenes/cargas (acreedor, monto, fecha) desde los asientos del
    // historial — entrega el valor que prometía "SIGM" sin un portal aparte. `hasLiens`
    // refleja el estado VIGENTE según SUNARP (flag), no el histórico.
    const RX_GRAV = /gravamen|garant[ií]a mobiliaria|prenda|hipoteca|embargo|medida cautelar/i;
    // Un asiento LEVANTA/cancela la carga. Se busca en acto Y participantes: el motivo suele
    // ir en participantes ("Cancelación a solicitud del Acreedor") y el acto a veces dice
    // "que se cancela" (por eso `cancela\w*`, no solo "cancelación").
    const RX_LEVANT = /cancela|levantamiento|caduc|extinci[oó]n|liberaci[oó]n/i;
    const gravItems: GravamenItem[] = timeline
      .filter((a) => {
        const f = (a.flags ?? {}) as Record<string, boolean>;
        return f.gravamen || f.embargo || RX_GRAV.test(String(a.acto ?? ''));
      })
      .map((a) => {
        const hay = `${a.acto ?? ''} ${a.participantes ?? ''}`;
        return {
          type: clip(a.acto, 60) ?? 'Gravamen',
          creditor: clip(a.participantes, 90),
          amount: moneyOrNull(a.precio ?? a.montoPagado),
          date: (a.fechaPresentacion as string) || (a.fechaAsiento as string) || null,
          status: RX_LEVANT.test(hay) ? 'LEVANTADO' : 'VIGENTE',
        } as GravamenItem;
      });
    // Solo hay carga VIGENTE si las constituciones superan a las cancelaciones/levantamientos.
    // Si el único evento de garantía mobiliaria es su cancelación → el vehículo quedó LIBRE
    // (bandera verde), aunque el texto siga mencionando "garantía mobiliaria".
    const gravVigentes = gravItems.filter((it) => it.status !== 'LEVANTADO').length;
    const gravLevantados = gravItems.filter((it) => it.status === 'LEVANTADO').length;
    const grav: GravamenesPayload = {
      hasLiens: gravVigentes > gravLevantados,
      total: gravItems.length,
      items: gravItems,
    };
    src.push({ kind: SectionKind.GRAVAMENES, source: SourceId.SUNARP, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: grav });
    const titulos = (hd.titulos ?? []) as unknown[];
    const events: HistorialEvent[] = timeline.map((a) => ({
      date: (a.fechaPresentacion as string) || (a.fechaAsiento as string) || null,
      act: clip(a.acto, 80),
      title: (a.titulo as string) ?? null,
      price: clip(a.precio ?? a.montoPagado, 40),
      parties: clip(a.participantes, 140),
    }));
    const transfers = timeline.filter((a) => /transferencia|compra\s*venta|adjudicaci/i.test(String(a.acto ?? ''))).length;
    const histPay: HistorialPayload = {
      totalAsientos: timeline.length,
      totalTitulos: titulos.length,
      transfers,
      flags: { aseguradora: Boolean(histFlags.aseguradora), remate: Boolean(histFlags.remate), financiera: Boolean(histFlags.financiera) },
      events,
    };
    src.push({ kind: SectionKind.HISTORIAL, source: SourceId.SUNARP, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: histPay });
  } else if (hist) {
    // El historial (SPRL) corrió pero FALLÓ (bloqueo por IP, Turnstile, etc.). Antes se
    // omitían estas secciones → la web las pintaba como "Próximamente" (engañoso: sí las
    // ofrecemos, solo que esta consulta falló). Emitirlas como UNAVAILABLE hace que la web
    // muestre "no disponible / reintentar" en su lugar. Ver riesgo de UX de fuente fallida.
    src.push({ kind: SectionKind.GRAVAMENES, source: SourceId.SUNARP, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
    src.push({ kind: SectionKind.HISTORIAL, source: SourceId.SUNARP, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
  }

  const report = buildReport({ id, plateDisplay: plate, plateNormalized: plate, generatedAt: at, sources: src });
  // buildReport agrega COMING_SOON aunque ya aportemos la sección (p. ej. PAPELETAS) → dedupe por kind.
  const seen = new Set<string>();
  report.sections = report.sections.filter((s) => (seen.has(s.kind) ? false : (seen.add(s.kind), true)));
  return report;
}
