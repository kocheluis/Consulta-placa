/**
 * Documento PDF del reporte (A4) — diseño "Reporte PDF — BASIC/PRO/ULTRA" del design system PlacaPe.pe
 * (Claude Design, templates/reporte-*). Solo existe al IMPRIMIR (`hidden print:block`): el botón
 * «Descargar PDF» llama a window.print() y el navegador lo guarda como PDF.
 *
 * Paginación: tabla de una celda cuyo <thead>/<tfoot> se repiten en cada hoja → encabezado (logo +
 * nivel + folio) y pie (sello + dominio) en todas las páginas. `@page { margin: 0 }` (globals.css) evita
 * que el navegador imprima su propia fecha/URL.
 *
 * Privacidad: imprime SOLO lo que el cliente ya tiene en pantalla (el reporte llega recortado por nivel y
 * con los terceros enmascarados desde la API). No se imprime el nombre del solicitante.
 */
import type { ReactNode } from 'react';
import type {
  Report, SectionResult, SectionCatalogEntry, InsurancePolicy, SiniestroIndicator, PapeletasPayload,
  CapturaIndicator, RevisionTecnica, GravamenesPayload, HistorialPayload, TransporteInfo, GnvPayload,
  ImpuestoVehicularPayload, IaAnalysis, Valuation, VehicleScore,
} from '@app/shared';
import { formatPlateDisplay, ScoreLevel, SectionStatus } from '@app/shared';

/* ── Paleta del template (tokens/colors.css del design system) ── */
const C = {
  ink: '#0E1B22', body: '#2E434E', muted: '#647884', subtle: '#8A9BA5', line: '#E9EEF1', lineSoft: '#F0F3F5',
  azul950: '#07222E', azul900: '#0A2E3D', azul700: '#14506B', azul200: '#C4E0EA', azul100: '#E1EFF4', azul50: '#EFF6F9',
  teal700: '#0F8A7E', teal500: '#16B5A3', teal300: '#71DACD', teal200: '#A8E9E0', teal100: '#D7F5F0', teal50: '#ECFAF7',
  page: '#F5F8FA',
};
type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'none';
const TONE: Record<Tone, { fg: string; bg: string; bd: string; solid: string }> = {
  ok: { fg: '#137A45', bg: '#EFFBF3', bd: '#DCF5E5', solid: '#18994F' },
  warn: { fg: '#B8770A', bg: '#FEF8E9', bd: '#FBEFCE', solid: '#DA9211' },
  bad: { fg: '#B82B2B', bg: '#FEF0F0', bd: '#FBE0E0', solid: '#DD3B3B' },
  info: { fg: '#14506B', bg: '#EFF6F9', bd: '#C4E0EA', solid: '#1A6584' },
  none: { fg: '#647884', bg: '#F5F8FA', bd: '#E9EEF1', solid: '#8A9BA5' },
};
const SORA = "'Sora', system-ui, sans-serif";
const MONO = "'JetBrains Mono', monospace";

const soles = (n: number | null | undefined) =>
  n == null ? '—' : `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const fecha = (iso: string | null | undefined) => {
  if (!iso) return null;
  // 'YYYY-MM-DD' sin hora se lee como medianoche UTC → en Perú salía el día anterior: se fija al mediodía local.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
};

/* ── Un hallazgo por sección (fila del cuadro) ── */
export interface Finding { value: string; pill: string; tone: Tone }

export function sectionFinding(entry: SectionCatalogEntry, section: SectionResult | undefined, report: Report): Finding | null {
  const v = report.vehicle;
  if (entry.comingSoon) return null;
  if (entry.key === 'propietarios') {
    const h = report.sections.find((s) => s.kind === 'HISTORIAL' && s.status === SectionStatus.AVAILABLE)?.payload as HistorialPayload | undefined;
    if (!v?.owner && !h) return null;
    return h
      ? { value: `${h.transfers} transferencia${h.transfers === 1 ? '' : 's'} registrada${h.transfers === 1 ? '' : 's'}`, pill: 'SUNARP', tone: 'info' }
      : { value: 'Titular registrado en SUNARP', pill: 'Registrado', tone: 'info' };
  }
  if (!section || section.status === SectionStatus.COMING_SOON) return null;
  if (section.status === SectionStatus.NOT_FOUND) return { value: 'Sin resultados en la fuente', pill: 'Sin registro', tone: 'none' };
  if (section.status !== SectionStatus.AVAILABLE) return { value: 'La fuente no respondió en esta consulta', pill: 'No disponible', tone: 'none' };
  const p = section.payload;
  switch (entry.key) {
    case 'identidad':
      if (v?.stolenAlert) return { value: 'Reportado como robado', pill: 'Robo', tone: 'bad' };
      return { value: v?.registralStatus ? `SUNARP · ${v.registralStatus.toLowerCase()}` : 'Coincide con SUNARP', pill: 'Verificado', tone: 'ok' };
    case 'identidad_especifica':
      return { value: 'Ficha técnica registral', pill: 'Disponible', tone: 'info' };
    case 'soat': {
      const s = p as InsurancePolicy | undefined;
      if (s?.hasActiveSoat) return { value: [s.insurer, s.validTo ? `vence ${fecha(s.validTo)}` : null].filter(Boolean).join(' · ') || 'SOAT vigente', pill: 'Vigente', tone: 'ok' };
      return { value: s?.validTo ? `Venció ${fecha(s.validTo)}` : 'Sin SOAT vigente', pill: 'Sin SOAT', tone: 'warn' };
    }
    case 'revision_tecnica': {
      const r = p as RevisionTecnica | undefined;
      if (r?.hasValid) return { value: r.validUntil ? `Vence ${fecha(r.validUntil)}` : 'Certificado vigente', pill: 'Vigente', tone: 'ok' };
      if (!r?.lastInspection && !r?.validUntil) return { value: 'Sin inspecciones registradas', pill: 'Sin registro', tone: 'none' };
      return { value: r.validUntil ? `Venció ${fecha(r.validUntil)}` : 'Certificado no vigente', pill: 'Vencida', tone: 'warn' };
    }
    case 'siniestralidad': {
      const s = p as SiniestroIndicator | undefined;
      if (s?.perdidaTotal) return { value: 'Declarado pérdida total', pill: 'Pérdida total', tone: 'bad' };
      if (s?.hasSiniestro) {
        const n = s.accidentes ?? s.siniestros?.reduce((a, x) => a + (x.cantidad || 1), 0) ?? 1;
        return { value: `${n} siniestro${n === 1 ? '' : 's'} en ${s.periodYears} años`, pill: `${n} alerta${n === 1 ? '' : 's'}`, tone: 'bad' };
      }
      return { value: `Sin siniestros en ${s?.periodYears ?? 5} años`, pill: 'Limpio', tone: 'ok' };
    }
    case 'papeletas': {
      const s = p as PapeletasPayload | undefined;
      const n = s?.count ?? s?.total ?? 0;
      if (s && (s.pendingAmount > 0 || n > 0)) return { value: `${n} pendiente${n === 1 ? '' : 's'}`, pill: s.pendingAmount > 0 ? soles(s.pendingAmount) : `${n}`, tone: 'warn' };
      return { value: 'Sin papeletas pendientes', pill: 'Al día', tone: 'ok' };
    }
    case 'impuesto_vehicular': {
      const s = p as ImpuestoVehicularPayload | undefined;
      if (s?.sat?.found && s.sat.pendingTotal > 0) return { value: `Impuesto pendiente (${s.sat.pendingCount} cuota${s.sat.pendingCount === 1 ? '' : 's'})`, pill: soles(s.sat.pendingTotal), tone: 'warn' };
      if (s?.sat?.found) return { value: 'Sin deuda en el SAT', pill: 'Al día', tone: 'ok' };
      if (s?.afecto === false) return { value: 'Ya no está afecto al impuesto', pill: 'No afecto', tone: 'ok' };
      return { value: 'Ver años afectos en el detalle', pill: 'Revisar', tone: 'info' };
    }
    case 'captura': {
      const s = p as CapturaIndicator | undefined;
      return s?.hasCapture ? { value: s.detail || 'Orden de captura vigente', pill: 'Con orden', tone: 'bad' } : { value: 'Sin órdenes de captura', pill: 'Limpio', tone: 'ok' };
    }
    case 'transporte': {
      const s = p as TransporteInfo | undefined;
      if (s?.currentlyPublic ?? s?.isPublicTransport) return { value: s?.modality || 'Servicio de transporte público', pill: 'Servicio público', tone: 'warn' };
      if (s?.wasPublic) return { value: 'Fue de servicio público', pill: 'Fue público', tone: 'warn' };
      return { value: 'Sin registro de servicio público', pill: 'Particular', tone: 'ok' };
    }
    case 'gnv': {
      const s = p as GnvPayload | undefined;
      if (!s?.applies) return { value: 'Sin conversión a GNV registrada', pill: 'No aplica', tone: 'none' };
      if (s.hasDebt) return { value: 'Crédito de conversión con deuda', pill: soles(s.debtPending), tone: 'warn' };
      return { value: s.financed ? `Crédito cancelado (financiado ${soles(s.financed)})` : 'Sin deuda de conversión', pill: 'Sin deuda', tone: 'ok' };
    }
    case 'gravamenes': {
      const s = p as GravamenesPayload | undefined;
      if (s?.hasLiens) return { value: `${s.total} gravamen${s.total === 1 ? '' : 'es'} vigente${s.total === 1 ? '' : 's'}`, pill: 'Con gravamen', tone: 'bad' };
      return { value: s?.partialHistory ? 'Sin gravámenes (historial parcial)' : 'Sin prendas ni garantías', pill: 'Libre', tone: 'ok' };
    }
    case 'historial': {
      const s = p as HistorialPayload | undefined;
      if (!s) return null;
      const risky = s.flags?.remate || s.flags?.aseguradora;
      return {
        value: `${s.totalAsientos} asiento${s.totalAsientos === 1 ? '' : 's'} · ${s.transfers} transferencia${s.transfers === 1 ? '' : 's'}`,
        pill: s.flags?.remate ? 'Remate' : s.flags?.aseguradora ? 'Aseguradora' : 'Revisado',
        tone: risky ? 'warn' : 'info',
      };
    }
    case 'valorizacion': {
      const s = p as Valuation | undefined;
      if (!s?.available || s.blocked) return { value: 'No se pudo estimar con confianza', pill: 'Sin estimar', tone: 'none' };
      return { value: `Rango ${soles(s.netMin)} – ${soles(s.netMax)}`, pill: 'Referencial', tone: 'info' };
    }
    case 'ia': {
      const s = p as IaAnalysis | undefined;
      if (!s) return null;
      const m = { comprar: ['Comprar', 'ok'], precaucion: ['Precaución', 'warn'], evitar: ['Evitar', 'bad'] } as const;
      const [pill, tone] = m[s.verdict] ?? ['Ver', 'info'];
      return { value: 'Recomendación de compra', pill, tone };
    }
    default:
      return { value: 'Ver detalle', pill: 'Disponible', tone: 'info' };
  }
}

/* ── Piezas visuales ── */
function Pill({ tone, children, width }: { tone: Tone; children: ReactNode; width?: number }) {
  const t = TONE[tone];
  return (
    <span style={{ flex: 'none', width, textAlign: 'center', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: t.fg, background: t.bg, border: `1px solid ${t.bd}`, borderRadius: 999, padding: '4px 8px', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function Logo({ dark }: { dark?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
      <svg width="22" height="22" viewBox="0 0 120 120" fill="none" aria-hidden="true">
        <rect x="8" y="24" width="104" height="72" rx="16" fill={dark ? '#FFFFFF' : C.azul900} />
        <rect x="20" y="35" width="80" height="50" rx="9" fill={dark ? C.azul900 : '#FFFFFF'} />
        <rect x="20" y="35" width="20" height="50" rx="9" fill={dark ? C.teal500 : C.azul700} />
        <rect x="31" y="35" width="9" height="50" fill={dark ? C.teal500 : C.azul700} />
        <path d="M52 61 L60 69 L80 47" stroke={C.teal500} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      <span style={{ fontFamily: SORA, fontWeight: 800, fontSize: dark ? 26 : 14, letterSpacing: '-0.02em', color: dark ? '#fff' : C.azul900 }}>
        placa<span style={{ color: dark ? '#3FC9B8' : C.teal500 }}>pe</span>
      </span>
    </span>
  );
}

const VERDICT: Record<string, { title: string; tone: Tone; icon: string }> = {
  [ScoreLevel.GOOD]: { title: 'Sin alertas relevantes', tone: 'ok', icon: 'check_circle' },
  [ScoreLevel.WARNING]: { title: 'Revisar antes de comprar', tone: 'warn', icon: 'error' },
  [ScoreLevel.BAD]: { title: 'Alerta: no comprar sin verificar', tone: 'bad', icon: 'dangerous' },
  [ScoreLevel.UNKNOWN]: { title: 'Score no disponible', tone: 'none', icon: 'help' },
};

/** Tarjeta de detalle de una sección (envuelve el cuerpo REAL de la web). */
export function PdfSection({ icon, title, finding, children }: { icon: string; title: string; finding: Finding | null; children: ReactNode }) {
  return (
    <div className="pdf-section" style={{ marginTop: 12, border: `1px solid ${C.line}`, borderRadius: 14, padding: '14px 18px', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, breakAfter: 'avoid' }}>
        <span className="material-symbols-rounded" style={{ fontSize: 20, color: C.azul700 }}>{icon}</span>
        <span style={{ flex: 1, fontFamily: SORA, fontWeight: 700, fontSize: 14.5, color: C.ink }}>{title}</span>
        {finding && <Pill tone={finding.tone}>{finding.pill}</Pill>}
      </div>
      <div className="pdf-body">{children}</div>
    </div>
  );
}

export interface ReportPdfProps {
  report: Report;
  score: VehicleScore;
  /** Nivel visible: 'BASIC' o el Completo (PRO/ULTRA). */
  complete: boolean;
  issuedAt: string;
  folio: string;
  sources: string[];
  findings: Array<{ entry: SectionCatalogEntry; finding: Finding }>;
  /** Bloques de detalle (PdfSection) ya renderizados por la página. */
  details: ReactNode;
}

export function ReportPdf({ report, score, complete, issuedAt, folio, sources, findings, details }: ReportPdfProps) {
  const v = report.vehicle;
  const tierLabel = complete ? 'Completo' : 'Básico';
  const verdict = VERDICT[score.level] ?? VERDICT[ScoreLevel.UNKNOWN]!;
  const vt = TONE[verdict.tone];
  const ia = report.sections.find((s) => s.kind === 'IA' && s.status === SectionStatus.AVAILABLE)?.payload as IaAnalysis | undefined;
  const reasons = score.concepts.flatMap((c) => c.reasons).slice(0, 2).join(' ');
  const vehicleLine = v ? [v.brand, v.model, v.year, v.color].filter(Boolean).join(' · ') : 'Vehículo';
  const counts = { ok: 0, warn: 0, bad: 0 } as Record<Tone, number>;
  findings.forEach((f) => { counts[f.finding.tone] = (counts[f.finding.tone] ?? 0) + 1; });
  const emitted = new Date(issuedAt);
  const emittedLabel = Number.isNaN(emitted.getTime()) ? issuedAt
    : `${emitted.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })} · ${emitted.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`;

  return (
    <div className="pdf-doc hidden print:block" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: C.ink, background: '#fff' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }} role="presentation">
        <thead>
          <tr><td style={{ padding: '9mm 13mm 5mm' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 7, borderBottom: `2px solid ${C.teal500}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <Logo />
                <span style={{ width: 1, height: 14, background: '#D7DFE4', margin: '0 3px' }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>
                  Reporte de Historial Vehicular · <span style={{ color: C.teal700, fontWeight: 700 }}>{tierLabel.toUpperCase()}</span>
                </span>
              </div>
              <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 500, color: C.muted }}>Folio {folio}</span>
            </div>
          </td></tr>
        </thead>
        <tfoot>
          <tr><td style={{ padding: '4mm 13mm 8mm' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 7, borderTop: `1px solid ${C.line}`, fontSize: 9, color: C.subtle }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="material-symbols-rounded" style={{ fontSize: 13, color: C.teal500, fontVariationSettings: "'FILL' 1" }}>verified</span>
                Documento generado por <strong style={{ color: C.muted }}>PlacaPe</strong> · Consolida {sources.length} fuente{sources.length === 1 ? '' : 's'} oficial{sources.length === 1 ? '' : 'es'}{ia ? ' + análisis con IA' : ''}
              </span>
              <span style={{ fontFamily: MONO }}>placape.pe</span>
            </div>
          </td></tr>
        </tfoot>
        <tbody>
          <tr><td style={{ padding: '0 13mm' }}>

            {/* ── PORTADA ── */}
            <div style={{ background: `linear-gradient(135deg, #0C6F64 0%, ${C.azul900} 55%, ${C.azul950} 100%)`, borderRadius: 16, padding: '22px 26px', color: '#fff', breakInside: 'avoid', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'radial-gradient(circle, rgba(22,181,163,0.28), transparent 70%)' }} />
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', position: 'relative' }}>
                <Logo dark />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 7 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: complete ? `linear-gradient(135deg, ${C.teal500}, ${C.teal700})` : 'rgba(255,255,255,0.14)', border: '1px solid rgba(168,233,224,0.6)', borderRadius: 999, padding: '5px 13px', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#fff' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 15, fontVariationSettings: "'FILL' 1" }}>{complete ? 'workspace_premium' : 'bolt'}</span>
                    Reporte {tierLabel}
                  </span>
                  <span style={{ fontSize: 10, color: '#93C4D6' }}>Emitido: {emittedLabel}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 24, gap: 20, position: 'relative' }}>
                <div>
                  <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.teal300 }}>Placa consultada</p>
                  <div style={{ display: 'inline-flex', alignItems: 'center', background: C.page, border: `2px solid ${C.teal500}`, borderRadius: 10, padding: '6px 8px 6px 16px', gap: 12 }}>
                    <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 32, letterSpacing: '0.10em', color: C.azul900 }}>{formatPlateDisplay(report.placa)}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: C.azul900, borderRadius: 6, padding: '5px 8px' }}>
                      <span style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, color: C.teal300, lineHeight: 1 }}>PE</span>
                      <span style={{ fontSize: 7, color: '#93C4D6', lineHeight: 1.4 }}>PERÚ</span>
                    </span>
                  </div>
                  <p style={{ margin: '12px 0 0', fontSize: 15, color: C.azul100, fontWeight: 500 }}>{vehicleLine}</p>
                </div>
                <div style={{ textAlign: 'right', fontSize: 12, lineHeight: 1.9, color: C.azul200, whiteSpace: 'nowrap' }}>
                  <div><span style={{ color: '#7FB0C6' }}>Folio</span>&nbsp; <span style={{ fontFamily: MONO, color: '#fff' }}>{folio}</span></div>
                  <div><span style={{ color: '#7FB0C6' }}>Datos al</span>&nbsp; <span style={{ color: '#fff' }}>{fecha(report.generatedAt)}</span></div>
                  <div><span style={{ color: '#7FB0C6' }}>Fuentes</span>&nbsp; <span style={{ color: '#fff' }}>{sources.length} oficiales{ia ? ' + IA' : ''}</span></div>
                </div>
              </div>
            </div>

            {v?.stolenAlert && (
              <div style={{ marginTop: 14, border: `1px solid ${TONE.bad.bd}`, background: TONE.bad.bg, borderRadius: 12, padding: '12px 16px', color: TONE.bad.fg, fontWeight: 700, fontSize: 13, breakInside: 'avoid' }}>
                Vehículo reportado como ROBADO — verifica con SUNARP / PNP antes de cualquier trato.
              </div>
            )}

            {/* ── VEREDICTO ── */}
            <div style={{ marginTop: 14, border: `1px solid ${vt.bd}`, background: vt.bg, borderRadius: 14, padding: '16px 20px', breakInside: 'avoid' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ flex: 'none', width: 60, height: 60, borderRadius: '50%', background: vt.solid, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 32, color: '#fff', fontVariationSettings: "'FILL' 1" }}>{verdict.icon}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: '0 0 2px', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: vt.fg }}>Veredicto del semáforo</p>
                  <p style={{ margin: 0, fontFamily: SORA, fontWeight: 800, fontSize: 22, color: C.ink, letterSpacing: '-0.02em' }}>{verdict.title}</p>
                  {(ia?.summary || reasons) && <p style={{ margin: '4px 0 0', fontSize: 12.5, color: C.body, lineHeight: 1.5 }}>{ia?.summary || reasons}</p>}
                </div>
                {score.overall != null && (
                  <div style={{ flex: 'none', textAlign: 'center', paddingLeft: 16, borderLeft: `1px solid ${vt.bd}` }}>
                    <p style={{ margin: 0, fontFamily: SORA, fontWeight: 800, fontSize: 38, lineHeight: 1, color: vt.fg }}>{score.overall}<span style={{ fontSize: 15, color: vt.solid }}>/100</span></p>
                    <p style={{ margin: '4px 0 0', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.subtle }}>Score PlacaPe</p>
                  </div>
                )}
              </div>
              {score.overall != null && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ position: 'relative', height: 9, borderRadius: 999, background: 'linear-gradient(90deg, #DD3B3B 0%, #DD3B3B 50%, #DA9211 50%, #DA9211 75%, #18994F 75%, #18994F 100%)' }}>
                    <div style={{ position: 'absolute', top: -4, left: `${score.overall}%`, transform: 'translateX(-50%)', width: 4, height: 17, borderRadius: 3, background: C.ink, boxShadow: `0 0 0 3px ${vt.bg}` }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    <span style={{ color: TONE.bad.fg }}>Alerta</span><span style={{ color: TONE.warn.fg }}>Revisar</span><span style={{ color: TONE.ok.fg }}>Limpio</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── ANÁLISIS CON IA ── */}
            {ia && (
              <div style={{ marginTop: 12, border: `1px solid ${C.teal200}`, background: `linear-gradient(135deg, ${C.teal50}, ${C.page})`, borderRadius: 14, padding: '16px 20px', breakInside: 'avoid' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 22, color: C.teal700, fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                  <span style={{ flex: 1, fontFamily: SORA, fontWeight: 700, fontSize: 15, color: C.azul900 }}>Análisis con IA · Conclusión</span>
                </div>
                <p style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.6, color: '#1C2D36' }}>{ia.recommendation}</p>
                {ia.priceComment && <p style={{ margin: '0 0 10px', fontSize: 12, lineHeight: 1.55, color: C.body }}><strong>Precio:</strong> {ia.priceComment}</p>}
                {(ia.redFlags.length > 0 || ia.positives.length > 0) && (
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                    {ia.redFlags.map((f) => {
                      const t = TONE[f.severity === 'alta' ? 'bad' : f.severity === 'media' ? 'warn' : 'info'];
                      return <span key={f.title} style={{ fontSize: 10.5, fontWeight: 700, color: t.fg, background: t.bg, border: `1px solid ${t.bd}`, borderRadius: 999, padding: '4px 11px' }}>{f.title}</span>;
                    })}
                    {ia.positives.slice(0, 3).map((x) => (
                      <span key={x} style={{ fontSize: 10.5, fontWeight: 700, color: TONE.ok.fg, background: TONE.ok.bg, border: `1px solid ${TONE.ok.bd}`, borderRadius: 999, padding: '4px 11px' }}>{x}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── CUADRO DE HALLAZGOS ── */}
            {findings.length > 0 && (
              <div style={{ marginTop: 12, border: `1px solid ${C.line}`, borderRadius: 14, background: '#fff', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', background: C.page, borderBottom: `1px solid ${C.line}`, breakAfter: 'avoid' }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 20, color: C.azul700 }}>fact_check</span>
                  <span style={{ flex: 1, fontFamily: SORA, fontWeight: 700, fontSize: 14.5, color: C.ink }}>Cuadro de hallazgos</span>
                  <span style={{ fontSize: 11, color: C.muted }}>
                    <strong style={{ color: TONE.ok.fg }}>{counts.ok}</strong> ok · <strong style={{ color: TONE.warn.fg }}>{counts.warn}</strong> revisar · <strong style={{ color: TONE.bad.fg }}>{counts.bad}</strong> alerta
                  </span>
                </div>
                {findings.map(({ entry, finding }, i) => (
                  <div key={entry.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 20px', breakInside: 'avoid', borderBottom: i < findings.length - 1 ? `1px solid ${C.lineSoft}` : 'none' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 18, color: C.muted, width: 22 }}>{entry.icon}</span>
                    <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: C.ink }}>{entry.label}</span>
                    <span style={{ flex: 1.2, fontSize: 11.5, color: C.muted }}>{finding.value}</span>
                    <Pill tone={finding.tone} width={104}>{finding.pill}</Pill>
                  </div>
                ))}
              </div>
            )}

            {/* ── SCORE POR CONCEPTO ── */}
            {score.concepts.some((c) => c.score != null) && (
              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: `repeat(${score.concepts.filter((c) => c.score != null).length}, 1fr)`, gap: 10, breakInside: 'avoid' }}>
                {score.concepts.filter((c) => c.score != null).map((c) => {
                  const t = TONE[c.level === ScoreLevel.GOOD ? 'ok' : c.level === ScoreLevel.WARNING ? 'warn' : 'bad'];
                  return (
                    <div key={c.concept} style={{ border: `1px solid ${t.bd}`, background: t.bg, borderRadius: 12, padding: '10px 14px' }}>
                      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.subtle }}>{c.label}</p>
                      <p style={{ margin: '2px 0 0', fontFamily: SORA, fontWeight: 800, fontSize: 22, color: t.fg }}>{c.score}</p>
                      {c.reasons[0] && <p style={{ margin: '2px 0 0', fontSize: 10.5, lineHeight: 1.45, color: C.body }}>{c.reasons[0]}</p>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── DETALLE POR SECCIÓN ── */}
            <p style={{ margin: '18px 0 0', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.subtle, breakAfter: 'avoid' }}>Detalle por fuente</p>
            {details}

            {/* ── UPSELL (Básico) ── */}
            {!complete && (
              <div style={{ marginTop: 14, borderRadius: 14, padding: '16px 20px', background: `linear-gradient(135deg, ${C.azul900}, #0C6F64)`, color: '#fff', breakInside: 'avoid' }}>
                <p style={{ margin: 0, fontFamily: SORA, fontWeight: 700, fontSize: 15 }}>¿Quieres el historial completo?</p>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: C.azul200, lineHeight: 1.5 }}>
                  El reporte <strong style={{ color: '#fff' }}>Completo</strong> suma historial de dueños, papeletas, gravámenes, orden de captura, siniestralidad, impuesto vehicular, GNV, valorización y análisis con IA. Actívalo en placape.pe.
                </p>
              </div>
            )}

            {/* ── SELLO ── */}
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, breakInside: 'avoid' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 50, height: 50, borderRadius: '50%', border: `2px solid ${C.teal500}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.teal50 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 24, color: C.teal700, fontVariationSettings: "'FILL' 1" }}>verified_user</span>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: C.ink }}>Sello PlacaPe · Reporte {tierLabel}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
                    Datos de {sources.length} fuente{sources.length === 1 ? '' : 's'} oficial{sources.length === 1 ? '' : 'es'}{ia ? ' + análisis con IA' : ''} al <strong style={{ color: C.body }}>{fecha(report.generatedAt)}</strong>.
                    {sources.length > 0 && <> Fuentes: {sources.join(', ')}.</>}
                  </p>
                </div>
              </div>
              <div style={{ flex: 'none', textAlign: 'center', border: `1px solid ${C.line}`, borderRadius: 10, padding: '8px 12px' }}>
                <p style={{ margin: '0 0 3px', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.subtle }}>Código de folio</p>
                <p style={{ margin: 0, fontFamily: MONO, fontWeight: 700, fontSize: 13, letterSpacing: '0.08em', color: C.azul900 }}>{folio}</p>
              </div>
            </div>

            <p style={{ margin: '12px 0 0', fontSize: 9, color: '#A0AEB6', lineHeight: 1.5, textAlign: 'justify' }}>
              {report.disclaimer} Este documento es un reporte informativo generado por PlacaPe a partir de fuentes públicas y oficiales
              {ia ? ' y de un análisis asistido por IA' : ''}. Refleja los registros disponibles a la fecha indicada y no constituye una tasación
              oficial, peritaje mecánico ni documento con valor legal por sí mismo. Recomendamos una inspección física del vehículo antes de la compra.
            </p>
          </td></tr>
        </tbody>
      </table>
    </div>
  );
}
