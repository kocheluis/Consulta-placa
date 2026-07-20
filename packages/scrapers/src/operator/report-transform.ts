import {
  buildReport,
  maskOwnerName,
  maskDoc,
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
  type PapeletaDetalle,
  type GravamenesPayload,
  type GravamenItem,
  type HistorialPayload,
  type HistorialEvent,
  type AuctionInfo,
  type TransporteInfo,
  type VehicleSpecs,
} from '@app/shared';
import type { OperatorSourceResult } from './index.js';
import { agruparAsientos, type AsientoRecord } from './asiento-parser.js';

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

  // GRAVAMENES: SIGM (garantías mobiliarias VIGENTES) es la fuente autoritativa. Si respondió,
  // reemplaza al heurístico de asientos (más abajo). SIGM cubre prendas/garantías, NO embargos
  // judiciales. El acreedor/monto no vienen en la lista (están en el "Detalle" → fase 2).
  const sigmRes = by('SIGM');
  const sigmOk = !!sigmRes && (sigmRes.status === 'ENCONTRADO' || sigmRes.status === 'SIN_REGISTRO');
  if (sigmOk) {
    const sd = data(sigmRes);
    const sigmItems = ((sd.items ?? []) as Array<Record<string, unknown>>).map((f) => ({
      type: 'Garantía mobiliaria',
      creditor: (f.acreedor as string) || null, // del Detalle §3 (acreedor); el deudor §2 NO se expone (PII/L-01)
      amount: (f.amount as number) ?? null, // monto de ejecución (Detalle)
      date: (f.fechaInscripcion as string) || null,
      status: String(f.ultimaOperacion ?? '').toUpperCase() || 'VIGENTE',
      detail: (f.incumplimiento as string) || null, // del Detalle §5 (descripción del incumplimiento)
      folio: (f.folio as string) || null,
    } as GravamenItem));
    const sigmPayload: GravamenesPayload = { hasLiens: Boolean(sd.hasLiens) || sigmItems.length > 0, total: sigmItems.length, items: sigmItems };
    src.push({ kind: SectionKind.GRAVAMENES, source: SourceId.SIGM, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: sigmPayload });
  }

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

  // ── SEGUROS (SOAT de APESEG en tiempo real; CAT de taxis vía SBS) ──
  // La SBS está congelada en may-2024 → NO se usa su SOAT para la vigencia. El SOAT lo da APESEG;
  // si no hay SOAT (taxi), se muestra el CAT que trae la SBS. Orden: APESEG SOAT → SBS CAT →
  // "sin SOAT" (APESEG respondió sin registro) → SOAT SBS (último recurso si APESEG falló).
  const apeseg = by('APESEG_SOAT');
  const sbs = by('SBS_SOAT');
  const sd = data(sbs);
  const sbsCat = (sd.cat ?? null) as Record<string, string> | null;
  const sbsSoat = (sd.soat ?? null) as Record<string, string> | null;
  // ¿Es taxi/transporte? Señal nacional = tipo de servicio del CITV; respaldo = ATU (Lima).
  const isTaxi = /taxi|transporte\s+(p[uú]blico|especial de personas)|servicio\s+p[uú]blico/i
    .test(String(data(by('MTC_CITV')).tipoServicio ?? '')) || Boolean(data(by('ATU')).isPublicTransport);
  if (apeseg?.status === 'ENCONTRADO') {
    const d = data(apeseg) as Record<string, string>;
    const pol: InsurancePolicy = {
      hasActiveSoat: /VIGENTE/i.test(d.estado ?? ''), insuranceType: 'SOAT', insurer: d.compania ?? null, policyNumber: null,
      validFrom: d.inicio ?? null, validTo: d.fin ?? null, certificate: d.certificado ?? null,
      use: d.uso ?? null, vehicleClass: d.clase ?? null, policyType: d.tipo ?? null,
    };
    src.push({ kind: SectionKind.SEGUROS, source: SourceId.APESEG, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: pol });
  } else if (sbs?.status === 'ENCONTRADO' && sbsCat) {
    // Taxi: APESEG no cubre CAT/AFOCAT → lo trae la SBS.
    const pol: InsurancePolicy = {
      hasActiveSoat: Boolean(sd.catVigente), insuranceType: 'CAT',
      insurer: sbsCat.compania ?? null, policyNumber: sbsCat.poliza ?? null,
      validFrom: sbsCat.inicio ?? null, validTo: sbsCat.fin ?? null, certificate: sbsCat.certificado ?? null,
      use: sbsCat.uso ?? null, vehicleClass: sbsCat.clase ?? null,
    };
    src.push({ kind: SectionKind.SEGUROS, source: SourceId.SBS, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: pol });
  } else if (apeseg?.status === 'SIN_REGISTRO') {
    // APESEG respondió: sin SOAT vigente (particular sin SOAT). Sección disponible, no es error.
    const pol: InsurancePolicy = { hasActiveSoat: false, insuranceType: isTaxi ? 'CAT' : 'SOAT', insurer: null, policyNumber: null, validFrom: null, validTo: null };
    src.push({ kind: SectionKind.SEGUROS, source: SourceId.APESEG, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: pol });
  } else if (sbs?.status === 'ENCONTRADO' && sbsSoat) {
    // Último recurso (APESEG ausente/erró): SOAT de la SBS (puede estar desactualizado).
    const pol: InsurancePolicy = {
      hasActiveSoat: Boolean(sd.soatVigente), insuranceType: 'SOAT',
      insurer: sbsSoat.compania ?? null, policyNumber: sbsSoat.poliza ?? null,
      validFrom: sbsSoat.inicio ?? null, validTo: sbsSoat.fin ?? null, certificate: sbsSoat.certificado ?? null,
      use: sbsSoat.uso ?? null, vehicleClass: sbsSoat.clase ?? null,
    };
    src.push({ kind: SectionKind.SEGUROS, source: SourceId.SBS, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: pol });
  } else if (sbs || apeseg) {
    src.push({ kind: SectionKind.SEGUROS, source: SourceId.SBS, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
  }

  // ── SINIESTRALIDAD (accidentes SBS + subasta Superbid/VMC + banderas del historial) ──
  const superbid = by('SUPERBID');
  const hist = by('HISTORIAL');
  const histFlags = (data(hist).flags ?? {}) as Record<string, boolean>;
  // Siniestralidad SBS: N° total de accidentes (suma de los 3 tipos) + el detalle por periodo.
  const sbsAccidentes = sbs?.status === 'ENCONTRADO' ? num(data(sbs).totalSiniestros ?? data(sbs).accidentes) : null;
  const sbsSiniestros = (sbs?.status === 'ENCONTRADO' ? (data(sbs).siniestros ?? []) : []) as Array<Record<string, unknown>>;
  // La fuente Superbid es un lookup en el índice (DB): ENCONTRADO = la placa salió en una
  // subasta; sus banderas (siniestro/aseguradora/remate) vienen en data.flags.
  const subFound = superbid?.status === 'ENCONTRADO';
  const subData = data(superbid);
  const subFlags = (subData.flags ?? {}) as Record<string, boolean>;
  // SOLO la ASEGURADORA (adjudicación tras pérdida total) es señal de siniestro. Un 'remate'
  // FINANCIERO (banco/financiera ejecutando una garantía por falta de pago) NO es un siniestro
  // — es una carga y va a Gravámenes, no a Siniestralidad (caso CHP605: remate Santander).
  const histSiniestro = hist?.status === 'ENCONTRADO' && histFlags.aseguradora;
  // El periodo se acota a la edad del vehículo: decir "últimos 5 años" de un auto
  // de 2 años no tiene sentido. SBS reporta hasta 5 años; tomamos el menor.
  const vehYear = num(data(sunarp).year);
  const genYear = new Date(at).getFullYear();
  const periodYears = vehYear ? Math.min(5, Math.max(1, genYear - vehYear)) : 5;
  // Superbid SOLO cuenta para siniestralidad si la subasta es por siniestro/aseguradora
  // (pérdida total). Un remate FINANCIERO (banco/financiera) NO es siniestro → se ignora aquí.
  const auctionSiniestro = subFound && (subFlags.siniestro || subFlags.aseguradora);
  if (sbsAccidentes != null || auctionSiniestro || histSiniestro) {
    const hasSiniestro =
      (sbsAccidentes != null && sbsAccidentes > 0) || auctionSiniestro || Boolean(histSiniestro);
    const auction: AuctionInfo | null = auctionSiniestro
      ? {
          subasta: (subData.subasta as string) ?? null,
          estado: (subData.estado as string) ?? null,
          fuente: ((subData.fuente as string) ?? 'SUPERBID').toUpperCase(),
          tipo: subFlags.siniestro ? 'siniestro' : 'aseguradora',
          boletaUrl: (subData.boletaUrl as string) ?? null,
        }
      : null;
    const siniestros = sbsSiniestros.map((s) => ({
      tipo: String(s.tipo ?? ''), aseguradora: (s.aseguradora as string) ?? null,
      desde: (s.desde as string) ?? null, hasta: (s.hasta as string) ?? null, cantidad: num(s.cantidad),
    }));
    const pay: SiniestroIndicator = { hasSiniestro: Boolean(hasSiniestro), periodYears, accidentes: sbsAccidentes, siniestros, auction };
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
    const limaCount = satP?.status === 'ENCONTRADO' ? num(data(satP).count) : 0;
    const limaDetalle = satP?.status === 'ENCONTRADO' ? ((data(satP).detalle as PapeletaDetalle[] | undefined) ?? []) : [];
    if (satP?.status === 'ENCONTRADO') items.push({ type: `Infracciones Lima${limaCount ? ` (${limaCount})` : ''}`, entity: 'SAT Lima', date: null, amount: limaAmt, status: 'PENDIENTE' });
    const callaoAmt = callao?.status === 'ENCONTRADO' ? num(data(callao).total) : 0;
    const callaoCount = callao?.status === 'ENCONTRADO' ? num(data(callao).count) : 0;
    // Callao ENCONTRADO = SÍ hay papeletas (aunque no se haya leído el monto): registra el concepto.
    // Antes solo se agregaba si el monto era > 0 → cuando el parser fallaba, el reporte mentía "sin papeletas".
    if (callao?.status === 'ENCONTRADO') {
      items.push({ type: `Papeletas Callao${callaoCount ? ` (${callaoCount})` : ''}`, entity: 'SAT Callao', date: null, amount: callaoAmt, status: 'PENDIENTE' });
    }
    const anyOk = [satP, callao].some((r) => r && r.status !== 'ERROR');
    const checkedScopes: string[] = [];
    if (satP && satP.status !== 'ERROR') checkedScopes.push('Lima (SAT)');
    if (callao && callao.status !== 'ERROR') checkedScopes.push('Callao');
    const benefitAmount = callao?.status === 'ENCONTRADO' ? num(data(callao).benefit) : 0;
    const benefitUntil = callao?.status === 'ENCONTRADO' ? ((data(callao).benefitUntil as string | null | undefined) ?? null) : null;
    const papeletaCount = limaCount + callaoCount;
    const pay: PapeletasPayload = {
      total: items.length,
      ...(papeletaCount > 0 ? { count: papeletaCount } : {}),
      pendingAmount: Math.round((limaAmt + callaoAmt) * 100) / 100,
      items, checkedScopes,
      ...(limaDetalle.length ? { detalle: limaDetalle } : {}),
      ...(benefitAmount > 0 ? { benefitAmount, benefitUntil } : {}),
    };
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
        serviceType: (md.tipoServicio as string) ?? null,
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
      // PII minimizada (Ley 29733): se enmascara el titular (nombre + documento) antes de pasar al
      // reporte del cliente. Empresa → tal cual (razón social/RUC públicos); persona → nombres + apellido
      // recortado, DNI recortado. El dato crudo solo vive en la fuente del VPS (operador).
      const pay: TransporteInfo = {
        isPublicTransport: Boolean(d.isPublicTransport),
        modality: (d.modalidad as string) ?? null,
        detail: (d.estado as string) ?? null,
        holder: maskOwnerName((d.titular as string) ?? null),
        holderDoc: maskDoc((d.documento as string) ?? null),
        validUntil: (d.vigencia as string) ?? null,
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
    const esCarga = (a: Record<string, unknown>) => {
      const f = (a.flags ?? {}) as Record<string, boolean>;
      return f.gravamen || f.embargo || RX_GRAV.test(String(a.acto ?? ''));
    };
    const esCancelacion = (a: Record<string, unknown>) => RX_LEVANT.test(`${a.acto ?? ''} ${a.participantes ?? ''}`);
    const cargas = timeline.filter(esCarga);
    const cancelaciones = cargas.filter(esCancelacion).length;
    // Se listan las CONSTITUCIONES (crean la carga); cada cancelación levanta la más antigua →
    // una garantía ya cancelada se muestra LEVANTADA, no como carga viva. La cancelación en sí
    // no es una carga y no se lista (caso CHP605: garantía Santander constituida y luego cancelada).
    const constituciones = cargas.filter((a) => !esCancelacion(a));
    const gravItems: GravamenItem[] = constituciones.map((a, i) => ({
      type: clip(a.acto, 60) ?? 'Gravamen',
      creditor: clip(a.participantes, 90),
      amount: moneyOrNull(a.precio ?? a.montoPagado),
      date: (a.fechaPresentacion as string) || (a.fechaAsiento as string) || null,
      status: i < cancelaciones ? 'LEVANTADO' : 'VIGENTE',
    } as GravamenItem));
    const gravVigentes = gravItems.filter((it) => it.status !== 'LEVANTADO').length;
    const grav: GravamenesPayload = {
      hasLiens: gravVigentes > 0,
      total: gravItems.length,
      items: gravItems,
    };
    if (!sigmOk) src.push({ kind: SectionKind.GRAVAMENES, source: SourceId.SUNARP, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: grav }); // SIGM manda si respondió
    const titulos = (hd.titulos ?? []) as unknown[];
    // Un mismo asiento (título AAAA-NNNNNN) puede traer VARIAS acciones (dos compra-ventas en
    // tracto sucesivo, o cancelación + compra-venta). Se agrupan por asiento: el reporte cuenta
    // ASIENTOS, no acciones, y muestra los montos por separado (nunca los suma). Ver CDK293.
    const grupos = agruparAsientos(timeline as unknown as AsientoRecord[]);
    const events: HistorialEvent[] = grupos.map((g) => ({
      date: g.fechaPresentacion || g.fechaAsiento || null,
      title: g.titulo,
      acciones: g.acciones.map((a) => ({
        act: clip(a.acto, 80),
        price: clip(a.precio || a.montoPagado, 40),
        parties: clip(a.participantes, 140),
      })),
    }));
    // Transferencias de dominio = compraventas + adjudicaciones (cuenta ACCIONES: un asiento en
    // tracto sucesivo transfiere el dominio más de una vez). La primera inscripción es el origen.
    const transfers = grupos.reduce(
      (n, g) => n + g.acciones.filter((a) => /compra\s*-?\s*venta|adjudicaci[oó]n/i.test(String(a.acto ?? ''))).length,
      0,
    );
    const histPay: HistorialPayload = {
      totalAsientos: grupos.length,
      totalTitulos: titulos.length,
      transfers,
      flags: { aseguradora: Boolean(histFlags.aseguradora), remate: Boolean(histFlags.remate), financiera: Boolean(histFlags.financiera), gravamen: (grav.total ?? 0) > 0 },
      events,
    };
    src.push({ kind: SectionKind.HISTORIAL, source: SourceId.SUNARP, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: histPay });

    // ── IDENTIDAD ESPECÍFICA (ficha técnica del asiento: versión, carrocería, combustible…) ──
    // Como el historial SÍ corrió, la sección siempre se emite (así el cliente la ve): AVAILABLE con
    // la ficha si algún asiento la trajo (la mayoría la tiene en su Primera Inscripción / Cambio de
    // Características), o UNAVAILABLE si ningún asiento la expuso. No se exige `version`: si se
    // extrajo carrocería/combustible pero no la versión, la sección igual aporta valor.
    const especs = (hd.caracteristicas ?? null) as VehicleSpecs | null;
    const hasSpecs = !!especs && Object.entries(especs).some(([k, v]) => k !== 'sourceTitle' && v != null);
    src.push(hasSpecs
      ? { kind: SectionKind.IDENTIDAD_ESPECIFICA, source: SourceId.SUNARP, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: especs! }
      : { kind: SectionKind.IDENTIDAD_ESPECIFICA, source: SourceId.SUNARP, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
  } else if (hist) {
    // El historial (SPRL) corrió pero FALLÓ (bloqueo por IP, Turnstile, etc.). Antes se
    // omitían estas secciones → la web las pintaba como "Próximamente" (engañoso: sí las
    // ofrecemos, solo que esta consulta falló). Emitirlas como UNAVAILABLE hace que la web
    // muestre "no disponible / reintentar" en su lugar. Ver riesgo de UX de fuente fallida.
    if (!sigmOk) src.push({ kind: SectionKind.GRAVAMENES, source: SourceId.SUNARP, status: SectionStatus.UNAVAILABLE, fetchedAt: at }); // SIGM ya la cubrió
    src.push({ kind: SectionKind.HISTORIAL, source: SourceId.SUNARP, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
    src.push({ kind: SectionKind.IDENTIDAD_ESPECIFICA, source: SourceId.SUNARP, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
  }

  const report = buildReport({ id, plateDisplay: plate, plateNormalized: plate, generatedAt: at, sources: src });
  // buildReport agrega COMING_SOON aunque ya aportemos la sección (p. ej. PAPELETAS) → dedupe por kind.
  const seen = new Set<string>();
  report.sections = report.sections.filter((s) => (seen.has(s.kind) ? false : (seen.add(s.kind), true)));
  return report;
}
