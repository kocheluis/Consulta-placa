import {
  buildReport,
  maskOwnerName,
  maskDoc,
  maskHistorialParties,
  classifyPublicUse,
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
  type ImpuestoVehicularPayload,
  type ImpuestoSatValidation,
  type AuctionInfo,
  type TransporteInfo,
  type VehicleSpecs,
  type GnvPayload,
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

// Fuentes CRUDAS → institución pública, para el bloque "Fuentes consultadas". Varias consultas al mismo
// portal (SAT_CAPTURA/SAT_PAPELETAS/SAT_IMPUESTO) colapsan a una sola institución ("SAT Lima").
const SOURCE_INSTITUTION: Record<string, string> = {
  SUNARP: 'SUNARP', HISTORIAL: 'Síguelo', SIGM: 'SIGM',
  SAT_CAPTURA: 'SAT Lima', SAT_PAPELETAS: 'SAT Lima', SAT_IMPUESTO: 'SAT Lima',
  CALLAO_PAPELETAS: 'SAT Callao', SATT_PAPELETAS: 'SATT Trujillo', MTC_CITV: 'MTC', SBS_SOAT: 'SBS', APESEG_SOAT: 'APESEG',
  ATU: 'ATU', SUPERBID: 'Superbid', FISE_GNV: 'FISE', INFOGAS_GNV: 'Infogás',
};
// Orden estable de exhibición (por relevancia/reconocimiento).
const INSTITUTION_ORDER = ['SUNARP', 'Síguelo', 'SIGM', 'SAT Lima', 'SAT Callao', 'SATT Trujillo', 'MTC', 'SBS', 'APESEG', 'ATU', 'Superbid', 'FISE', 'Infogás'];

/** Instituciones consultadas CON resultado (ENCONTRADO/SIN_REGISTRO); las que erraron se omiten para no
 *  implicar que dieron dato. Ordenadas por INSTITUTION_ORDER. */
function institutionsConsulted(results: OperatorSourceResult[]): string[] {
  const set = new Set<string>();
  for (const r of results) {
    if (r.status !== 'ENCONTRADO' && r.status !== 'SIN_REGISTRO') continue;
    const inst = SOURCE_INSTITUTION[r.source];
    if (inst) set.add(inst);
  }
  return INSTITUTION_ORDER.filter((i) => set.has(i));
}

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
  // Placa INEXISTENTE: SUNARP detectó el modal "No se ha encontrado la placa" (data.plateNotFound).
  // Reporte MÍNIMO con el flag → la web muestra un banner y NO cobra/consume crédito (no hay datos que
  // entregar). Corta antes de armar secciones (todas saldrían "no registrada").
  if ((data(by('SUNARP')) as { plateNotFound?: boolean }).plateNotFound === true) {
    return { ...buildReport({ id, plateDisplay: plate, plateNormalized: plate, generatedAt: at, sources: [] }), plateNotFound: true };
  }
  const src: SourceResult[] = [];

  // GRAVÁMENES — DOS registros COMPLEMENTARIOS, no uno solo:
  //  (1) SIGM/RMC (sigm-consulta): el Registro Mobiliario de Contratos.
  //  (2) el HISTORIAL de la partida vehicular (SPRL/Síguelo): garantías inscritas en el Registro de
  //      Propiedad Vehicular. Por Ley 28677, la garantía sobre un bien REGISTRADO —el vehículo— se
  //      inscribe en SU partida, no necesariamente en el RMC.
  // ⇒ Una garantía mobiliaria sobre el vehículo suele estar en (2) y NO en (1): SIGM devuelve
  //   SIN_REGISTRO aunque el vehículo TENGA una carga vigente (BSY873: SCANIA SERVICES sobre la flota
  //   de OBRASCON — un título con muchas partidas, una por vehículo). Por eso SIGM MANDA solo cuando
  //   ÉL encontró cargas; si viene vacío, el historial de la partida es la fuente autoritativa.
  // El push de la sección se decide junto al historial (abajo); aquí solo se calcula el payload. Si el
  // historial NO corrió (fuente ausente), se emite SIGM aquí mismo (única fuente).
  const sigmRes = by('SIGM');
  const sigmOk = !!sigmRes && (sigmRes.status === 'ENCONTRADO' || sigmRes.status === 'SIN_REGISTRO');
  let sigmPayload: GravamenesPayload | null = null;
  if (sigmOk) {
    const sd = data(sigmRes);
    const sigmItems = ((sd.items ?? []) as Array<Record<string, unknown>>).map((f) => ({
      type: 'Garantía mobiliaria',
      // Acreedor del Detalle §3 (normalmente banco/financiera → intacto; persona con DNI → se
      // enmascara). El deudor §2 NO se expone (PII/L-01).
      creditor: maskHistorialParties((f.acreedor as string) || null),
      amount: (f.amount as number) ?? null, // monto de ejecución (Detalle)
      date: (f.fechaInscripcion as string) || null,
      status: String(f.ultimaOperacion ?? '').toUpperCase() || 'VIGENTE',
      detail: (f.incumplimiento as string) || null, // del Detalle §5 (descripción del incumplimiento)
      folio: (f.folio as string) || null,
    } as GravamenItem));
    sigmPayload = { hasLiens: Boolean(sd.hasLiens) || sigmItems.length > 0, total: sigmItems.length, items: sigmItems };
  }
  const sigmHasLiens = !!sigmPayload && (sigmPayload.total ?? 0) > 0;
  // Historial ausente (la fuente ni corrió): abajo no se empuja nada → emite SIGM aquí.
  if (sigmOk && !by('HISTORIAL')) {
    src.push({ kind: SectionKind.GRAVAMENES, source: SourceId.SIGM, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: sigmPayload! });
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
  // ¿Es taxi/servicio público? Señales: tipo de uso del ASIENTO (registral, nacional) + tipo de
  // servicio del CITV + habilitación ATU (Lima/Callao).
  const especsUse = ((data(by('HISTORIAL')).caracteristicas ?? null) as VehicleSpecs | null);
  const pubUse = classifyPublicUse(especsUse?.usage, especsUse?.category);
  const isTaxi = pubUse.isPublic || /taxi|transporte\s+(p[uú]blico|especial de personas)|servicio\s+p[uú]blico/i
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
          // Solo afirmamos ROBO si el portal lo dice (nombre de la subasta / lote: "robo" / "recuperado");
          // en cualquier otro caso la causa queda desconocida (NO asumimos choque).
          causa: subFlags.robo ? 'robo' : null,
          boletaUrl: (subData.boletaUrl as string) ?? null,
        }
      : null;
    const siniestros = sbsSiniestros.map((s) => ({
      tipo: String(s.tipo ?? ''), aseguradora: (s.aseguradora as string) ?? null,
      desde: (s.desde as string) ?? null, hasta: (s.hasta as string) ?? null, cantidad: num(s.cantidad),
    }));
    // PÉRDIDA TOTAL confirmada: aseguradora como parte del historial (adjudicación tras siniestro) o
    // remate por siniestro/aseguradora. NO la disparan los accidentes SBS por sí solos (pueden ser leves).
    const perdidaTotal = Boolean(histSiniestro) || auctionSiniestro;
    const pay: SiniestroIndicator = { hasSiniestro: Boolean(hasSiniestro), perdidaTotal, periodYears, accidentes: sbsAccidentes, siniestros, auction };
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

  // ── PAPELETAS (SAT Lima + Callao + SATT Trujillo) ──
  const satP = by('SAT_PAPELETAS');
  const callao = by('CALLAO_PAPELETAS');
  const satt = by('SATT_PAPELETAS');
  if (satP || callao || satt) {
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
    const sattAmt = satt?.status === 'ENCONTRADO' ? num(data(satt).total) : 0;
    const sattCount = satt?.status === 'ENCONTRADO' ? num(data(satt).count) : 0;
    if (satt?.status === 'ENCONTRADO') {
      items.push({ type: `Papeletas Trujillo${sattCount ? ` (${sattCount})` : ''}`, entity: 'SATT Trujillo', date: null, amount: sattAmt, status: 'PENDIENTE' });
    }
    const anyOk = [satP, callao, satt].some((r) => r && r.status !== 'ERROR');
    const checkedScopes: string[] = [];
    if (satP && satP.status !== 'ERROR') checkedScopes.push('Lima (SAT)');
    if (callao && callao.status !== 'ERROR') checkedScopes.push('Callao');
    if (satt && satt.status !== 'ERROR') checkedScopes.push('Trujillo (SATT)');
    const benefitAmount = callao?.status === 'ENCONTRADO' ? num(data(callao).benefit) : 0;
    const benefitUntil = callao?.status === 'ENCONTRADO' ? ((data(callao).benefitUntil as string | null | undefined) ?? null) : null;
    const papeletaCount = limaCount + callaoCount + sattCount;
    const pay: PapeletasPayload = {
      total: items.length,
      ...(papeletaCount > 0 ? { count: papeletaCount } : {}),
      pendingAmount: Math.round((limaAmt + callaoAmt + sattAmt) * 100) / 100,
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
        esServicio: isTaxi,
        observaciones: (md.observaciones as string) ?? null,
        lunasPolarizadas: (md.lunasPolarizadas as string) ?? null,
      };
      src.push({ kind: SectionKind.REVISION_TECNICA, source: SourceId.MTC, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: pay });
    } else if (mtc.status === 'SIN_REGISTRO') {
      // No hay CITV: la web decide el mensaje según la ANTIGÜEDAD y el USO ("aún no requiere" para un
      // particular reciente vs "vencida/requerida" para un taxi, que la necesita aunque sea nuevo).
      const pay: RevisionTecnica = { hasValid: false, status: null, lastInspection: null, validUntil: null, result: null, esServicio: isTaxi };
      src.push({ kind: SectionKind.REVISION_TECNICA, source: SourceId.MTC, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: pay });
    } else {
      src.push({ kind: SectionKind.REVISION_TECNICA, source: SourceId.MTC, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
    }
  }

  // ── TRANSPORTE / USO PÚBLICO (tipo de uso del asiento SUNARP + habilitación ATU Lima/Callao) ──
  // La señal REGISTRAL (asiento) manda: es nacional y no depende de que ATU responda. Si ATU falló
  // pero el asiento trae el tipo de uso, la sección IGUAL sale (antes quedaba "no disponible").
  const atu = by('ATU');
  const atuOk = !!atu && (atu.status === 'ENCONTRADO' || atu.status === 'SIN_REGISTRO');
  const hasRegistralUse = !!especsUse?.usage;
  if (atuOk || hasRegistralUse) {
    const d = data(atu);
    // Historial de TIPO DE USO: un vehículo puede haber sido taxi/servicio público y luego cambiar a
    // particular. La ficha ACTUAL (especsUse) muestra el estado de hoy; los asientos "Cambio de Tipo de
    // Uso" del historial dicen CUÁNDO cambió. Así distinguimos "es público" de "FUE público" (evita el
    // mensaje confuso "SERVICIO PÚBLICO" cuando hoy figura como particular).
    const histTl = (data(by('HISTORIAL')).timeline ?? []) as Array<Record<string, unknown>>;
    const fechaDe = (a: Record<string, unknown>): string | null => (a.fechaAsiento as string) || (a.fechaPresentacion as string) || null;
    const usageChangeDates = histTl.filter((a) => /tipo\s+de\s+uso/i.test(String(a.acto ?? ''))).map(fechaDe).filter((x): x is string => !!x);
    const firstInscriptionDate = histTl.filter((a) => /primera inscripci[oó]n/i.test(String(a.acto ?? ''))).map(fechaDe).find((x): x is string => !!x) ?? null;
    // ATU vigente = habilitación con vigencia (proxy de "hoy es público"); sin vigencia lo tratamos como
    // señal de que LO FUE. La ficha registral actual manda para "hoy".
    const atuVigente = Boolean(d.isPublicTransport) && !!d.vigencia;
    const currentlyPublic = pubUse.isPublic || atuVigente;
    const wasPublic = currentlyPublic || Boolean(d.isPublicTransport) || usageChangeDates.length > 0;
    // PII minimizada (Ley 29733): titular ATU (nombre + documento) enmascarado; el dato crudo solo
    // vive en la fuente del VPS (operador).
    const pay: TransporteInfo = {
      isPublicTransport: wasPublic, // para la valorización: el desgaste por uso intensivo aplica aunque hoy sea particular
      currentlyPublic,
      wasPublic,
      usageChangeDates,
      firstInscriptionDate,
      modality: (d.modalidad as string) ?? null,
      detail: (d.estado as string) ?? null,
      holder: maskOwnerName((d.titular as string) ?? null),
      holderDoc: maskDoc((d.documento as string) ?? null),
      validUntil: (d.vigencia as string) ?? null,
      registralPublicUse: hasRegistralUse ? pubUse.isPublic : null,
      registralUsage: especsUse?.usage ?? null,
      category: especsUse?.category ?? null,
      serviceKind: pubUse.kind,
    };
    src.push({ kind: SectionKind.TRANSPORTE, source: atuOk ? SourceId.ATU : SourceId.SUNARP, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: pay });
  } else if (atu) {
    src.push({ kind: SectionKind.TRANSPORTE, source: SourceId.ATU, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
  }

  // ── GNV (FISE deuda de conversión + Infogas estado) — solo vehículos a gas ──
  // El gate del motor SALTA estas fuentes para vehículos no-gas y emite SIN_REGISTRO con
  // `data.aplicable=false` → aquí se distingue "no aplica" (no es a gas) de "sin crédito"
  // (vehículo gas sin financiamiento FISE). Ambas fuentes se COMBINAN en UNA sección.
  const fise = by('FISE_GNV');
  const infogas = by('INFOGAS_GNV');
  if (fise || infogas) {
    const fd = data(fise);
    const gd = data(infogas);
    const skipped = (r?: OperatorSourceResult): boolean => !!r && r.status === 'SIN_REGISTRO' && (data(r).aplicable === false);
    const fiseOk = !!fise && (fise.status === 'ENCONTRADO' || fise.status === 'SIN_REGISTRO') && !skipped(fise);
    const infogasOk = !!infogas && (infogas.status === 'ENCONTRADO' || infogas.status === 'SIN_REGISTRO') && !skipped(infogas);
    const allSkipped = [fise, infogas].filter(Boolean).every((r) => skipped(r));
    const emptyGnv: GnvPayload = {
      applies: true, hasDebt: null, debtPending: null, debtOverdue: null, financed: null, paid: null,
      fuel: null, hasCredit: null, cylinderExpiry: null, annualReviewExpiry: null, enabled: null,
    };
    if (allSkipped) {
      // Vehículo NO a gas → la sección aplica=false (la web dice "no aplica", no "sin datos").
      src.push({ kind: SectionKind.GNV, source: SourceId.FISE, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: { ...emptyGnv, applies: false } });
    } else if (fiseOk || infogasOk) {
      const pay: GnvPayload = {
        ...emptyGnv,
        // FISE manda en la deuda: ENCONTRADO → tieneDeuda; SIN_REGISTRO (real) → nunca tuvo crédito.
        hasDebt: fiseOk ? (fise!.status === 'ENCONTRADO' ? Boolean(fd.tieneDeuda) : false) : null,
        debtPending: fiseOk && fise!.status === 'ENCONTRADO' ? ((fd.pendiente as number) ?? null) : null,
        debtOverdue: fiseOk && fise!.status === 'ENCONTRADO' ? ((fd.vencido as number) ?? null) : null,
        financed: fiseOk && fise!.status === 'ENCONTRADO' ? ((fd.financiamiento as number) ?? null) : null,
        paid: fiseOk && fise!.status === 'ENCONTRADO' ? ((fd.pagado as number) ?? null) : null,
        // || null (no ?? null): un string VACÍO del scraper NO debe pintar una fila en blanco.
        fuel: (gd.combustible as string) || null,
        hasCredit: infogasOk && infogas!.status === 'ENCONTRADO' ? Boolean(gd.tieneCredito) : null,
        cylinderExpiry: (gd.vencimientoCilindro as string) || null,
        annualReviewExpiry: (gd.vencimientoRevision as string) || null,
        enabled: (gd.habilitado as string) || null,
      };
      src.push({ kind: SectionKind.GNV, source: fiseOk ? SourceId.FISE : SourceId.INFOGAS, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: pay });
    } else {
      // Ambas corrieron y fallaron (captcha/Cloudflare) → "no disponible / reintentar".
      src.push({ kind: SectionKind.GNV, source: SourceId.FISE, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
    }
  }

  // ── IMPUESTO VEHICULAR · Capa B (VALIDACIÓN real en SAT Lima, por placa) ──
  // Independiente del historial: si la fuente `sat-impuesto` corrió, trae lo REALMENTE pagado/pendiente.
  // Se adjunta a la sección IMPUESTO_VEHICULAR (junto al estimado de Capa A). PII: sin nombres (solo cuotas).
  const satRes = by('SAT_IMPUESTO');
  const satData = data(satRes);
  const satVal: ImpuestoSatValidation | null = satRes?.status === 'ENCONTRADO' && satData.found
    ? {
        found: true,
        pendingTotal: num(satData.pendingTotal),
        pendingCount: num(satData.pendingCount),
        paidTotal: num(satData.paidTotal),
        paidCount: num(satData.paidCount),
        paidYears: ((satData.paidYears as number[]) ?? []).map(Number),
        pendingYears: ((satData.pendingYears as number[]) ?? []).map(Number),
        // Se rellena abajo, en la Capa A, cuando ya conocemos los ejercicios devengados (dueYears).
        unemittedYears: [],
        multaPaidTotal: num(satData.multaPaidTotal),
        multaPendingTotal: num(satData.multaPendingTotal),
        cuotas: ((satData.cuotas as Array<Record<string, unknown>>) ?? []).map((c) => ({
          year: num(c.year), cuota: String(c.cuota ?? ''),
          amount: c.estado === 'pendiente' ? (num(c.deuda) || num(c.total)) : num(c.pagado),
          estado: c.estado === 'pendiente' ? ('pendiente' as const) : ('pagado' as const),
          vencimiento: (c.vencimiento as string) || null,
        })),
      }
    : (satRes?.status === 'SIN_REGISTRO' ? { found: false, pendingTotal: 0, pendingCount: 0, paidTotal: 0, paidCount: 0, paidYears: [], pendingYears: [], unemittedYears: [], multaPaidTotal: 0, multaPendingTotal: 0, cuotas: [] } : null);

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
    const gravItems: GravamenItem[] = constituciones.map((a, i) => {
      // El "Monto de gravamen" (p. ej. "US$ 184,080.00") conserva su MONEDA verbatim (la garantía suele
      // ser en dólares); no se convierte a número para no pintarlo como S/. Precio/MontoPagado (compra)
      // sí son numéricos S/. Preferimos el monto de gravamen cuando existe.
      const montoGrav = ((a.montoGravamen as string) || '').replace(/\s+/g, ' ').trim() || null;
      return {
        type: clip(a.acto, 60) ?? 'Gravamen',
        // Participantes: personas (nombre+DNI) enmascaradas; empresas acreedoras intactas.
        creditor: maskHistorialParties(clip(a.participantes, 90)),
        amount: montoGrav ? null : moneyOrNull(a.precio ?? a.montoPagado),
        amountLabel: montoGrav,
        date: (a.fechaPresentacion as string) || (a.fechaAsiento as string) || null,
        status: i < cancelaciones ? 'LEVANTADO' : 'VIGENTE',
      } as GravamenItem;
    });
    const gravVigentes = gravItems.filter((it) => it.status !== 'LEVANTADO').length;
    const grav: GravamenesPayload = {
      hasLiens: gravVigentes > 0,
      total: gravItems.length,
      items: gravItems,
    };
    // SIGM manda SOLO si ÉL encontró cargas (trae el detalle del RMC). Si SIGM vino vacío, el
    // historial de la partida vehicular es la fuente: detecta la garantía inscrita en el Registro de
    // Propiedad Vehicular que el RMC no lista (BSY873). Antes, un SIGM vacío tapaba esta sección.
    src.push(sigmHasLiens
      ? { kind: SectionKind.GRAVAMENES, source: SourceId.SIGM, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: sigmPayload! }
      : { kind: SectionKind.GRAVAMENES, source: SourceId.SUNARP, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: grav });
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
        // Dueños ANTERIORES = terceros (Ley 29733): personas (nombre+DNI) enmascaradas; las
        // empresas (acreedores/financieras) y el texto del acto quedan legibles. 220 chars: los
        // campos ahora vienen etiquetados y separados por " · " (deudor/doc/civil/dirección/acreedor).
        parties: maskHistorialParties(clip(a.participantes, 220)),
        note: clip(a.observacion, 240) || null,
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

    // ── IMPUESTO VEHICULAR (Capa A — DERIVADA de la 1ª inscripción; regla de 3 años) ──
    // El Impuesto al Patrimonio Vehicular grava 3 ejercicios desde el AÑO SIGUIENTE a la 1ª
    // inscripción en SUNARP. Con el año de esa inscripción (del historial) decimos si sigue AFECTO
    // (sus cuotas deben estar pagadas — las impagas las asume el comprador) o ya INAFECTO. NO
    // consulta la deuda real: eso es por titular en el SAT, no por placa (Capa B).
    const parseTituloYear = (t: unknown): number | null => {
      const m = /(\d{4})\s*-\s*\d+/.exec(String(t ?? ''));
      const y = m ? Number(m[1]) : NaN;
      return Number.isFinite(y) && y >= 1980 && y <= 2100 ? y : null;
    };
    let regYear: number | null = null;
    let declaredValue: string | null = null;
    for (const g of grupos) {
      const primera = g.acciones.find((a) => /primera inscripci[oó]n/i.test(String(a.acto ?? '')));
      if (primera) { regYear = parseTituloYear(g.titulo); declaredValue = clip(primera.precio || primera.montoPagado, 40); break; }
    }
    // Sin "Primera Inscripción" explícita → el título más antiguo aproxima la 1ª inscripción.
    if (regYear == null) {
      const years = grupos.map((g) => parseTituloYear(g.titulo)).filter((y): y is number => y != null);
      if (years.length) regYear = Math.min(...years);
    }
    // Fecha en que el TITULAR ACTUAL adquirió el vehículo = acto NOTARIAL de la última transferencia
    // (compra-venta/adjudicación). La propiedad se transfiere con el acto —la inscripción SUNARP es
    // DECLARATIVA—, así que ESTA fecha (no la de inscripción) decide quién era dueño al 1-ene de cada
    // año. La fecha notarial vive en `documentos[].fecha` del asiento; fallback: fecha de presentación.
    const parseDmy = (s: unknown): number | null => {
      const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s ?? ''));
      return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
    };
    const RX_TRANSFER = /compra\s*-?\s*venta|adjudicaci[oó]n/i;
    let currentOwnerSince: string | null = null;
    let currentOwnerSinceTs: number | null = null;
    for (const t of timeline) {
      if (!RX_TRANSFER.test(String(t.acto ?? ''))) continue;
      const docs = (t.documentos ?? []) as Array<{ fecha?: string }>;
      const raw = (docs[0]?.fecha as string) || (t.fechaPresentacion as string) || '';
      const ts = parseDmy(raw);
      if (ts != null && (currentOwnerSinceTs == null || ts > currentOwnerSinceTs)) { currentOwnerSinceTs = ts; currentOwnerSince = String(raw).slice(0, 10); }
    }
    const curYear = new Date(at).getFullYear();
    const sede = (data(sunarp).sede as string) ?? null;
    let impPay: ImpuestoVehicularPayload;
    if (regYear != null) {
      const affectedYears = [regYear + 1, regYear + 2, regYear + 3];
      const lastAffectedYear = regYear + 3;
      const declVal = moneyOrNull(declaredValue);
      const estAnnual = declVal != null ? Math.round(declVal * 0.01) : null;
      const estimatedCurrency = declaredValue
        ? (/US\$|\bUSD\b|\$/.test(declaredValue) ? 'USD' : /S\/|\bPEN\b|soles/i.test(declaredValue) ? 'PEN' : null)
        : null;
      // Obligado de cada ejercicio = dueño al 1-ene. Si el titular actual adquirió ANTES del 1-ene de Y,
      // ese año era suyo; si adquirió después, era de un dueño anterior. Sin transferencias → el 1er
      // dueño sigue siendo el titular (todos suyos). La deuda impaga —de quien sea— la asume el comprador.
      const breakdown = affectedYears.map((year) => ({
        year,
        obligado: (currentOwnerSinceTs == null || currentOwnerSinceTs < Date.UTC(year, 0, 1) ? 'titular' : 'anterior') as 'titular' | 'anterior',
        estimated: estAnnual,
      }));
      const dueYears = affectedYears.filter((y) => y <= curYear);
      // Hueco Capa A vs Capa B: ejercicios YA VENCIDOS (< año de consulta) que la Capa A dice devengados
      // pero que el SAT NO registra —ni pagados ni pendientes—. Si el SAT conoce ALGÚN año (p.ej. 2024
      // pagado) pero le faltan devengados posteriores, ese "sin deuda pendiente" NO es prueba de pago:
      // el vehículo probablemente salió del padrón del SAT (baja / suspensión por robo o pérdida total),
      // o quedó sin declarar (omiso). Se excluye el año en curso (sus cuotas pueden no estar emitidas aún).
      const satKnown = new Set<number>([...(satVal?.paidYears ?? []), ...(satVal?.pendingYears ?? [])]);
      const unemittedYears = satVal?.found && satKnown.size > 0
        ? dueYears.filter((y) => y < curYear && !satKnown.has(y))
        : [];
      impPay = {
        afecto: curYear <= lastAffectedYear,
        sat: satVal ? { ...satVal, unemittedYears } : null,
        registrationYear: regYear,
        affectedYears,
        currentOwnerSince,
        breakdown,
        lastAffectedYear,
        dueYears,
        upcomingYears: affectedYears.filter((y) => y > curYear),
        declaredValue,
        estimatedAnnual: estAnnual,
        estimatedCurrency,
        registralOffice: sede,
      };
    } else {
      impPay = { afecto: null, sat: satVal, registrationYear: null, affectedYears: [], currentOwnerSince, breakdown: [], lastAffectedYear: null, dueYears: [], upcomingYears: [], declaredValue: null, estimatedAnnual: null, estimatedCurrency: null, registralOffice: sede };
    }
    src.push({ kind: SectionKind.IMPUESTO_VEHICULAR, source: SourceId.SUNARP, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: impPay });

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
    // Historial FALLÓ: sin la partida no derivamos gravámenes; queda lo que diga SIGM (sus cargas o
    // "sin registro en el RMC"). Si SIGM tampoco respondió → no disponible.
    src.push(sigmOk
      ? { kind: SectionKind.GRAVAMENES, source: SourceId.SIGM, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: sigmPayload! }
      : { kind: SectionKind.GRAVAMENES, source: SourceId.SUNARP, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
    // SUNARP marcó la partida como INCOMPLETA ("no visualizada por usuario externo" — error de SUNARP,
    // típico de placas MUY antiguas): NO es fallo nuestro. Mostramos el propietario ACTUAL (de la Consulta
    // Vehicular) y avisamos que el histórico no está disponible, en vez de "no disponible / reintentar".
    const hi = data(hist);
    if (hi.partidaIncompleta === true) {
      const ownerName = ((hi.vehiculo as { ownerName?: string | null } | null)?.ownerName) ?? ((data(sunarp).ownerName as string | null) ?? null);
      const histPay: HistorialPayload = { totalAsientos: 0, totalTitulos: 0, transfers: 0, flags: { aseguradora: false, remate: false, financiera: false, gravamen: false }, events: [], partidaIncompleta: true, currentOwner: ownerName };
      src.push({ kind: SectionKind.HISTORIAL, source: SourceId.SUNARP, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: histPay });
    } else {
      src.push({ kind: SectionKind.HISTORIAL, source: SourceId.SUNARP, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
    }
    src.push({ kind: SectionKind.IDENTIDAD_ESPECIFICA, source: SourceId.SUNARP, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
    // El impuesto vehicular (afectación) se DERIVA del año de la 1ª inscripción → depende del historial.
    // Pero la VALIDACIÓN SAT (Capa B) es independiente: si corrió, se emite la sección con solo esa capa.
    if (satVal) {
      const impB: ImpuestoVehicularPayload = { afecto: null, sat: satVal, registrationYear: null, affectedYears: [], currentOwnerSince: null, breakdown: [], lastAffectedYear: null, dueYears: [], upcomingYears: [], declaredValue: null, estimatedAnnual: null, estimatedCurrency: null, registralOffice: (data(sunarp).sede as string) ?? null };
      src.push({ kind: SectionKind.IMPUESTO_VEHICULAR, source: SourceId.SAT, status: SectionStatus.AVAILABLE, fetchedAt: at, payload: impB });
    } else {
      src.push({ kind: SectionKind.IMPUESTO_VEHICULAR, source: SourceId.SUNARP, status: SectionStatus.UNAVAILABLE, fetchedAt: at });
    }
  }

  const report = buildReport({ id, plateDisplay: plate, plateNormalized: plate, generatedAt: at, sources: src });
  // buildReport agrega COMING_SOON aunque ya aportemos la sección (p. ej. PAPELETAS) → dedupe por kind.
  const seen = new Set<string>();
  report.sections = report.sections.filter((s) => (seen.has(s.kind) ? false : (seen.add(s.kind), true)));
  report.sourcesConsulted = institutionsConsulted(results);
  return report;
}
