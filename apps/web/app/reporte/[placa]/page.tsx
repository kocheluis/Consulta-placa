'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type {
  Report,
  SectionResult,
  InsurancePolicy,
  SiniestroIndicator,
  SectionCatalogEntry,
  OwnerInfo,
  PapeletasPayload,
  CapturaIndicator,
  RevisionTecnica,
  GravamenesPayload,
  HistorialPayload,
  TransporteInfo,
  VehicleSpecs,
  IaAnalysis,
  Valuation,
} from '@app/shared';
import {
  formatPlateDisplay,
  computeScore,
  ScoreLevel,
  SectionStatus,
  SECTION_CATALOG,
  TIER_RANK,
  ReportTier,
} from '@app/shared';
import { useConsulta } from '@/lib/use-consulta';
import { getPaidTier, buyReport, type Tier } from '@/lib/account';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Tag } from '@/components/ui/Tag';
import { RiskGauge } from '@/components/RiskGauge';
import { StateScreen } from '@/components/StateScreen';
import { LeadGate } from '@/components/LeadGate';
import { getStoredLead } from '@/lib/lead';

// Activo por defecto (el pipeline ya está vivo). Kill-switch: NEXT_PUBLIC_PRO_ENABLED=false.
const PRO_ENABLED = process.env.NEXT_PUBLIC_PRO_ENABLED !== 'false';

/* ── Mapeos de presentación ───────────────────────────────────────── */
type GaugeLevel = 'limpio' | 'revisar' | 'alerta';
const SCORE_TO_GAUGE: Record<string, GaugeLevel> = {
  [ScoreLevel.GOOD]: 'limpio',
  [ScoreLevel.WARNING]: 'revisar',
  [ScoreLevel.BAD]: 'alerta',
};
type Tone = 'success' | 'warning' | 'danger' | 'neutral';
const SCORE_TO_TONE: Record<string, Tone> = {
  [ScoreLevel.GOOD]: 'success',
  [ScoreLevel.WARNING]: 'warning',
  [ScoreLevel.BAD]: 'danger',
  [ScoreLevel.UNKNOWN]: 'neutral',
};
/* ── Helpers de UI ────────────────────────────────────────────────── */
function DefGrid({ items }: { items: [string, string | null | undefined][] }) {
  const rows = items.filter(([, v]) => v != null && v !== '');
  if (rows.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5">
          <span className="font-body text-xs font-semibold uppercase tracking-wide text-slate-400">{k}</span>
          <span className="font-body text-[15px] font-medium text-foreground">{v}</span>
        </div>
      ))}
    </div>
  );
}

function StatusLine({ tone, icon, children }: { tone: Tone; icon: string; children: ReactNode }) {
  const bg: Record<Tone, string> = {
    success: 'bg-success-bg text-success',
    warning: 'bg-warning-bg text-warning-fg',
    danger: 'bg-danger-bg text-danger',
    neutral: 'bg-slate-100 text-muted',
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5">
      <div className={`grid h-10 w-10 flex-none place-items-center rounded-lg ${bg[tone]}`}>
        <Icon name={icon} className="text-[22px]" />
      </div>
      <p className="font-body text-[15px] font-semibold text-foreground">{children}</p>
    </div>
  );
}

function Unavailable({ status, onRetry }: { status: string; onRetry: () => void }) {
  if (status === SectionStatus.NOT_FOUND) {
    return <p className="font-body text-sm text-muted">Sin resultados en la fuente.</p>;
  }
  return (
    <div className="flex flex-col items-start gap-2.5">
      <p className="font-body text-sm text-warning-fg">Información no disponible en este momento.</p>
      <Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>
        Reintentar
      </Button>
    </div>
  );
}

/* ── Página ───────────────────────────────────────────────────────── */
export default function ReportePage() {
  const params = useParams<{ placa: string }>();
  const placa = (params.placa ?? '').toUpperCase();
  const [refreshToken, setRefreshToken] = useState(0);
  // Modo operador: ?preview=TOKEN muestra el reporte COMPLETO (sin candado ni lead gate)
  // para incrustarlo en la consola del operador; el token lo valida el route handler.
  const [preview, setPreview] = useState<string | undefined>(undefined);
  useEffect(() => {
    try { setPreview(new URLSearchParams(window.location.search).get('preview') || undefined); } catch { /* noop */ }
  }, []);
  const state = useConsulta(placa, refreshToken, PRO_ENABLED, preview);
  const actualizar = () => setRefreshToken((n) => n + 1);

  // Pantalla intermedia (lead gate): null mientras leemos localStorage, luego true si
  // este navegador ya dejó su contacto (o si es preview de operador).
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  useEffect(() => {
    setUnlocked(preview ? true : getStoredLead() != null);
  }, [preview]);

  // Al quedar listo el reporte, retén ~0.9 s mostrando 100% antes de revelarlo (cierre visual).
  const [reveal, setReveal] = useState(false);
  const ready = state.phase === 'done' && !!state.report && (state.report.sections.length > 0 || !!state.report.vehicle);
  useEffect(() => {
    if (!ready) { setReveal(false); return; }
    const t = setTimeout(() => setReveal(true), 900);
    return () => clearTimeout(t);
  }, [ready]);

  // Sin pipeline PRO: invitación restyleada. (En preview de operador se omite.)
  if (!PRO_ENABLED && !preview) {
    return (
      <div className="bg-background px-4 py-12 sm:py-16">
        <ProGate placa={placa} mode="soon" />
      </div>
    );
  }

  // Aún resolviendo si pedir contacto: evita el parpadeo gate↔reporte.
  if (unlocked === null) {
    return <div className="min-h-[60vh] bg-background" />;
  }

  // Captura obligatoria: el reporte se genera en background mientras se llena.
  if (!unlocked) {
    return <LeadGate placa={placa} ready={state.phase === 'done'} onUnlock={() => setUnlocked(true)} />;
  }

  if (state.phase === 'loading' || (ready && !reveal)) {
    return <LoadingView placa={placa} finishing={ready} />;
  }
  if (state.phase === 'error' && state.needsPro) {
    return (
      <div className="bg-background px-4 py-12 sm:py-16">
        <ProGate placa={placa} mode="required" />
      </div>
    );
  }
  if (state.phase === 'error') {
    return (
      <div className="bg-background px-4 py-16 sm:py-24">
        <StateScreen
          tone="danger"
          icon="error"
          title="No pudimos generar el reporte"
          description={state.error || 'Ocurrió un problema al consultar las fuentes. No se te cobró nada.'}
        >
          <div className="flex flex-wrap justify-center gap-3">
            <Button variant="accent" size="lg" icon="refresh" onClick={actualizar}>
              Reintentar
            </Button>
            <Button variant="secondary" size="lg" href="/" icon="arrow_back">
              Nueva consulta
            </Button>
          </div>
        </StateScreen>
      </div>
    );
  }
  if (!state.report) {
    return (
      <div className="bg-background px-4 py-16 sm:py-24">
        <StateScreen
          tone="warning"
          icon="search_off"
          title="No encontramos esa placa"
          description={`No hay registros para ${formatPlateDisplay(placa)} en las fuentes oficiales. Revisa el formato (ej. ABC-123).`}
        >
          <Button variant="accent" size="lg" href="/" iconRight="arrow_forward">
            Probar otra placa
          </Button>
        </StateScreen>
      </div>
    );
  }

  // Sin reporte aún (stub vacío): ofrecer la CONSULTA GRATIS (BASIC) en vez del dashboard vacío.
  if (!preview && state.report.sections.length === 0 && !state.report.vehicle) {
    return <FreeConsultaGate placa={placa} onStarted={actualizar} />;
  }

  return (
    <ReportView
      report={state.report}
      cached={state.cached}
      onRetry={actualizar}
      preview={preview}
    />
  );
}

/* ── Consulta gratis (BASIC): encola el pedido y arranca el polling ─── */
function FreeConsultaGate({ placa, onStarted }: { placa: string; onStarted: () => void }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const start = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/api/consulta-gratis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placa }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (d.ok) {
        onStarted(); // hay pedido en cola → empieza el polling del reporte
        return;
      }
      setErr(d.error || 'No pudimos iniciar la consulta. Verifica el formato de la placa (ej. ABC-123).');
    } catch {
      setErr('Hubo un problema de conexión. Inténtalo de nuevo.');
    }
    setLoading(false);
  };
  return (
    <div className="bg-background px-4 py-16 sm:py-24">
      <StateScreen
        tone="brand"
        icon="bolt"
        title="Consulta gratis"
        description="Genera gratis la identidad del vehículo, su SOAT y su revisión técnica (toma unos segundos). El historial de dueños, papeletas, orden de captura y gravámenes quedan en el reporte Pro."
        footer={`Placa ${formatPlateDisplay(placa)}`}
      >
        <div className="flex flex-col items-center gap-3">
          <Button variant="accent" size="lg" icon="bolt" onClick={start} disabled={loading}>
            {loading ? 'Iniciando…' : 'Generar mi consulta gratis'}
          </Button>
          {err && <p className="font-body text-sm text-danger">{err}</p>}
        </div>
      </StateScreen>
    </div>
  );
}

/* ── Vista del reporte ────────────────────────────────────────────── */
function ReportView({
  report, cached, onRetry, preview,
}: {
  report: Report; cached: boolean; onRetry: () => void; preview?: string;
}) {
  const router = useRouter();
  const v = report.vehicle;
  const score = computeScore(report);

  // Nivel desbloqueado por el usuario para esta placa (pago por reporte).
  // En preview de operador se fuerza ULTRA para mostrar todas las secciones.
  const [currentTier, setCurrentTier] = useState<Tier>(preview ? 'ULTRA' : 'BASIC');
  const [buying, setBuying] = useState<'PRO' | 'ULTRA' | null>(null);
  const [pendingYape, setPendingYape] = useState<{ tier: 'PRO' | 'ULTRA'; orderId?: string } | null>(null);
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;
  const kicked = useRef<string>(''); // evita re-encolar en bucle (clave placa+nivel)

  useEffect(() => {
    if (preview) { setCurrentTier('ULTRA'); return; }
    getPaidTier(report.placa).then(setCurrentTier).catch(() => {});
  }, [report.placa, preview]);

  // ¿El reporte guardado YA cubre el nivel pagado? (guiado por datos, sobrevive recargas).
  // PRO = corrieron las fuentes PRO (aparece CAPTURA/HISTORIAL/GRAVAMENES); ULTRA = además la IA.
  const rankNow = TIER_RANK[currentTier as ReportTier] ?? 1;
  const proReady = report.sections.some((s) => s.kind === 'CAPTURA' || s.kind === 'HISTORIAL' || s.kind === 'GRAVAMENES');
  const ultraReady = report.sections.some((s) => s.kind === 'IA' && s.status === SectionStatus.AVAILABLE);
  const awaitingUltra = !preview && currentTier === 'ULTRA' && !ultraReady;
  const awaitingPro = !preview && rankNow >= TIER_RANK[ReportTier.PRO] && !proReady;
  const awaitingPaid = awaitingPro || awaitingUltra;
  const awaitingTier: 'PRO' | 'ULTRA' = awaitingUltra ? 'ULTRA' : 'PRO';

  // Cierre visual del panel de pago: cuando el reporte pagado queda listo, mantén el anillo en
  // 100% ~0.9 s antes de revelar las secciones (mismo gesto que el reporte gratis). Al terminar,
  // `awaitingTier` vuelve a 'PRO' por defecto, así que recordamos el último nivel en curso.
  const lastPaidTier = useRef<'PRO' | 'ULTRA'>('PRO');
  if (awaitingPaid) lastPaidTier.current = awaitingTier;
  const [paidFinishing, setPaidFinishing] = useState(false);
  const wasAwaiting = useRef(awaitingPaid);
  useEffect(() => {
    if (wasAwaiting.current && !awaitingPaid) {
      setPaidFinishing(true);
      const t = setTimeout(() => setPaidFinishing(false), 900);
      wasAwaiting.current = awaitingPaid;
      return () => clearTimeout(t);
    }
    wasAwaiting.current = awaitingPaid;
  }, [awaitingPaid]);

  const comprar = async (tier: 'PRO' | 'ULTRA') => {
    setBuying(tier);
    try {
      const res = await buyReport(report.placa, tier);
      if (res.status === 'paid') {
        // Aprobado (mock/inline): al desbloquear el nivel, `awaitingPaid` mostrará la pantalla
        // de carga hasta que el motor genere el reporte completo.
        setCurrentTier(await getPaidTier(report.placa));
        onRetryRef.current();
      } else if (res.redirectUrl) {
        window.location.href = res.redirectUrl; // IziPay real
        return;
      } else {
        setPendingYape({ tier, orderId: res.orderId }); // Yape manual
      }
    } catch (err) {
      if ((err as Error).message === 'AUTH_REQUIRED') {
        router.push(`/cuenta?next=/reporte/${report.placa}`);
        return;
      }
    } finally {
      setBuying(null);
    }
  };

  // Reconsulta el nivel pagado (tras yapear, el usuario pulsa "Verificar"). Si ya está pagado,
  // cierra el modal; `awaitingPaid` toma el relevo y muestra la carga.
  const verificarPago = async (): Promise<Tier> => {
    const t = await getPaidTier(report.placa);
    if (t !== 'BASIC') { setCurrentTier(t); setPendingYape(null); onRetryRef.current(); }
    return t;
  };

  // Esperando el reporte del nivel pagado: (1) asegura que la generación esté encolada (una vez
  // por placa+nivel) y (2) sondea cada 4 s hasta que el reporte esté listo. Sobrevive recargas.
  useEffect(() => {
    if (!awaitingPaid) return;
    const tierKey = `${report.placa}:${awaitingTier}`;
    if (kicked.current !== tierKey) {
      kicked.current = tierKey;
      void fetch('/api/generar-reporte', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placa: report.placa }),
      }).catch(() => {});
    }
    const iv = setInterval(() => onRetryRef.current(), 4000);
    return () => clearInterval(iv);
  }, [awaitingPaid, awaitingTier, report.placa]);

  // El reporte de pago aún no está listo → el resto del reporte (gratis) sigue visible; solo el
  // panel PRO/ULTRA muestra la carga (ver <PaidPanelLoading/> en el <main> de abajo).

  const sources = Array.from(new Set(report.sections.map((s) => s.source).filter(Boolean)));
  const summary = v ? [v.brand, v.model, v.year, v.color].filter(Boolean).join(' · ') : 'Vehículo';

  return (
    <div className="bg-background">
      {/* Alerta de robo (máxima jerarquía) */}
      {v?.stolenAlert && (
        <div
          role="alert"
          className="border-b border-danger/30 bg-danger-bg px-4 py-3 text-center"
        >
          <p className="mx-auto flex max-w-[1240px] items-center justify-center gap-2 font-body text-sm font-bold text-danger">
            <Icon name="gpp_bad" fill className="text-[20px]" />
            Vehículo reportado como robado — verifica con SUNARP / PNP antes de cualquier trato.
          </p>
        </div>
      )}

      {/* Barra del reporte */}
      <div className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-3 px-4 py-3 sm:px-7">
          <div className="flex items-center gap-2.5">
            <Icon name="directions_car" className="text-xl text-muted" />
            <span className="font-mono text-[15px] font-bold tracking-wide text-foreground">
              {formatPlateDisplay(report.placa)}
            </span>
            {v && <span className="font-body text-sm text-muted">· {summary}</span>}
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            {report.status === 'PARTIAL' && (
              <Badge tone="warning" size="sm">
                Reporte parcial
              </Badge>
            )}
            <Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>
              Actualizar
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1240px] items-start gap-6 px-4 py-7 sm:px-7 lg:grid-cols-[300px_1fr]">
        {/* Sidebar */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
          <Card padded>
            <div className="mb-3.5 flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-azul-50">
                <Icon name="directions_car" className="text-[26px] text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-base font-bold tracking-wide text-foreground">
                  {formatPlateDisplay(report.placa)}
                </p>
                {v && <p className="mt-0.5 truncate font-body text-[13px] text-muted">{summary}</p>}
              </div>
            </div>
            {score.overall != null ? (
              <RiskGauge score={score.overall} level={SCORE_TO_GAUGE[score.level]} size={76} />
            ) : (
              <div className="rounded-lg border border-border bg-background px-4 py-3 text-center">
                <p className="font-body text-[13px] text-muted">
                  Score no disponible: faltan datos de las fuentes para puntuar.
                </p>
              </div>
            )}
            {cached && (
              <p className="mt-3 font-body text-[12px] text-muted">
                Datos de una consulta previa. Pulsa «Actualizar» para volver a consultar las fuentes.
              </p>
            )}
          </Card>

          {/* Score por concepto */}
          <Card title="Score por concepto" icon="insights">
            <div className="flex flex-col gap-3">
              {score.concepts.map((c) => (
                <div key={c.concept} className="flex items-center justify-between gap-2">
                  <span className="font-body text-sm text-foreground">{c.label}</span>
                  {c.score != null ? (
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-foreground">{c.score}</span>
                      <Badge tone={SCORE_TO_TONE[c.level]} size="sm" icon={null}>
                        {c.level === ScoreLevel.GOOD ? 'OK' : c.level === ScoreLevel.WARNING ? 'Revisar' : 'Alerta'}
                      </Badge>
                    </span>
                  ) : (
                    <Badge tone="neutral" size="sm" icon={null}>
                      Próximamente
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {sources.length > 0 && (
            <Card padded className="border-azul-200 bg-azul-50">
              <p className="mb-2 font-body text-xs font-bold uppercase tracking-wide text-azul-700">Fuentes consultadas</p>
              <div className="flex flex-wrap gap-1.5">
                {sources.map((s) => (
                  <Tag key={s} variant="source">
                    {s}
                  </Tag>
                ))}
              </div>
            </Card>
          )}
        </aside>

        {/* BASIC (gratis) arriba; PRO+ULTRA en UN solo panel abajo (oculto → desbloquear → elegir nivel). */}
        <main className="flex flex-col gap-6">
          <TierPanel tierKey={ReportTier.BASIC} report={report} vehicle={v} currentTier={currentTier} onActivate={comprar} buying={buying} onRetry={onRetry} />
          {awaitingPaid || paidFinishing ? (
            <PaidPanelLoading tier={awaitingPaid ? awaitingTier : lastPaidTier.current} finishing={paidFinishing} />
          ) : (
            <PaidPanel report={report} vehicle={v} currentTier={currentTier} onActivate={comprar} buying={buying} onRetry={onRetry} />
          )}
        </main>
      </div>

      <div className="mx-auto max-w-[1240px] px-4 pb-12 sm:px-7">
        <p className="border-t border-border pt-4 font-body text-xs text-muted">{report.disclaimer}</p>
        <Link href="/" className="mt-4 inline-flex items-center gap-1.5 font-body text-sm font-semibold text-primary hover:underline">
          <Icon name="arrow_back" className="text-[18px]" /> Nueva consulta
        </Link>
      </div>

      {pendingYape && (
        <YapeModal
          plate={formatPlateDisplay(report.placa)}
          tier={pendingYape.tier}
          orderId={pendingYape.orderId}
          onVerify={verificarPago}
          onClose={() => setPendingYape(null)}
        />
      )}
    </div>
  );
}

/* ── Panel por nivel (BASIC / PRO / ULTRA) ────────────────────────── */
const TIER_PANEL_META: Record<string, { name: string; short: string; icon: string; price?: string; desc: string; accent: string }> = {
  [ReportTier.BASIC]: {
    name: 'Reporte gratis', short: 'Gratis', icon: 'bolt',
    desc: 'Identidad del vehículo, propietario, SOAT y revisión técnica.',
    accent: 'bg-azul-50 text-primary',
  },
  [ReportTier.PRO]: {
    name: 'Reporte Pro', short: 'Pro', icon: 'workspace_premium', price: '15.90',
    desc: 'Historial de dueños y precios, papeletas, orden de captura, gravámenes y siniestralidad.',
    accent: 'bg-teal-50 text-teal-700',
  },
  [ReportTier.ULTRA]: {
    name: 'Reporte Ultra', short: 'Ultra', icon: 'auto_awesome', price: '19.90',
    desc: 'Todo lo de Pro + valorización de mercado y recomendación de compra con IA.',
    accent: 'bg-violet-50 text-violet-700',
  },
};

function TierPanel({
  tierKey, report, vehicle, currentTier, onActivate, buying, onRetry,
}: {
  tierKey: ReportTier;
  report: Report;
  vehicle: Report['vehicle'];
  currentTier: Tier;
  onActivate: (tier: 'PRO' | 'ULTRA') => void;
  buying: 'PRO' | 'ULTRA' | null;
  onRetry: () => void;
}) {
  const meta = TIER_PANEL_META[tierKey]!;
  const entries = SECTION_CATALOG.filter((e) => e.tier === tierKey);
  const locked = TIER_RANK[tierKey] > TIER_RANK[currentTier as ReportTier];
  const needed: 'PRO' | 'ULTRA' = tierKey === ReportTier.ULTRA ? 'ULTRA' : 'PRO';
  const sectionByKind = (kind: string | null): SectionResult | undefined =>
    kind ? report.sections.find((s) => s.kind === kind) : undefined;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      {/* Encabezado del panel */}
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <div className={`grid h-11 w-11 flex-none place-items-center rounded-xl ${meta.accent}`}>
          <Icon name={meta.icon} className="text-[24px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-lg font-extrabold tracking-tight text-foreground">{meta.name}</h2>
          <p className="mt-0.5 font-body text-[13px] leading-snug text-muted">{meta.desc}</p>
        </div>
        {tierKey === ReportTier.BASIC ? (
          <Badge tone="success" size="sm" icon="check">Incluido</Badge>
        ) : locked ? (
          <Badge tone="neutral" size="sm" icon="lock">{meta.short}</Badge>
        ) : (
          <Badge tone="success" size="sm" icon="lock_open">Activo</Badge>
        )}
      </div>

      {/* Cuerpo del panel */}
      <div className="p-5">
        {locked ? (
          <TierTeaser
            entries={entries}
            priceLabel={meta.price ? `S/ ${meta.price}` : ''}
            shortName={meta.short}
            busy={buying === needed}
            onActivate={() => onActivate(needed)}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {entries.map((entry) => (
              <SectionBlock
                key={entry.key}
                entry={entry}
                section={sectionByKind(entry.dataKind)}
                vehicle={vehicle}
                onRetry={onRetry}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Teaser de un nivel bloqueado: lista lo que incluye + UN botón para activarlo. */
function TierTeaser({
  entries, priceLabel, shortName, busy, onActivate,
}: {
  entries: readonly SectionCatalogEntry[];
  priceLabel: string;
  shortName: string;
  busy: boolean;
  onActivate: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2.5 sm:grid-cols-2">
        {entries.map((e) => (
          <div key={e.key} className="flex items-start gap-2.5 rounded-xl border border-border bg-background p-3">
            <Icon name={e.icon} className="mt-0.5 text-[20px] text-slate-400" />
            <div className="min-w-0">
              <p className="font-body text-[14px] font-semibold text-foreground">{e.label}</p>
              <p className="font-body text-[12.5px] leading-snug text-muted">{e.blurb}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-background px-4 py-5 text-center">
        <Button variant="accent" size="lg" icon="lock_open" onClick={onActivate} disabled={busy}>
          {busy ? 'Procesando…' : `Activar ${shortName}${priceLabel ? ` · ${priceLabel}` : ''}`}
        </Button>
        <p className="max-w-sm font-body text-[12.5px] leading-snug text-muted">
          Al activarlo, nuestros especialistas procesan tu reporte con todas las fuentes oficiales.
          Estará listo en <strong className="text-foreground">3 a 10 minutos</strong>.
        </p>
      </div>
    </div>
  );
}

/** Un bloque de sección dentro de un panel: encabezado (icono + título) + cuerpo real. */
function SectionBlock({
  entry, section, vehicle, onRetry,
}: {
  entry: SectionCatalogEntry;
  section?: SectionResult;
  vehicle: Report['vehicle'];
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <Icon name={entry.icon} className="text-[20px] text-primary" />
        <h4 className="flex-1 font-heading text-[15px] font-bold text-foreground">{entry.label}</h4>
        {entry.comingSoon && (
          <Badge tone="neutral" size="sm" icon="schedule">Próximamente</Badge>
        )}
      </div>
      <SectionBody entry={entry} section={section} vehicle={vehicle} onRetry={onRetry} />
    </div>
  );
}

/* ── Panel combinado PRO + ULTRA (un solo panel) ──────────────────── */
function PaidPanel({
  report, vehicle, currentTier, onActivate, buying, onRetry,
}: {
  report: Report;
  vehicle: Report['vehicle'];
  currentTier: Tier;
  onActivate: (tier: 'PRO' | 'ULTRA') => void;
  buying: 'PRO' | 'ULTRA' | null;
  onRetry: () => void;
}) {
  const rank = TIER_RANK[currentTier as ReportTier] ?? 1;
  const unlockedPro = rank >= TIER_RANK[ReportTier.PRO];
  const unlockedUltra = rank >= TIER_RANK[ReportTier.ULTRA];
  const proEntries = SECTION_CATALOG.filter((e) => e.tier === ReportTier.PRO);
  const ultraEntries = SECTION_CATALOG.filter((e) => e.tier === ReportTier.ULTRA);
  const sectionByKind = (kind: string | null): SectionResult | undefined =>
    kind ? report.sections.find((s) => s.kind === kind) : undefined;

  // Aún no desbloqueado (BASIC): un solo panel oculto con dos pasos (Desbloquear → elegir nivel).
  if (!unlockedPro) {
    return <LockedPaidPanel proEntries={proEntries} ultraEntries={ultraEntries} onActivate={onActivate} buying={buying} />;
  }

  // Desbloqueado (Pro o Ultra): muestra las secciones Pro; ULTRA muestra además IA, o upsell si es Pro.
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <div className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-teal-50 text-teal-700">
          <Icon name={unlockedUltra ? 'auto_awesome' : 'workspace_premium'} className="text-[24px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-lg font-extrabold tracking-tight text-foreground">
            {unlockedUltra ? 'Reporte Ultra' : 'Reporte Pro'}
          </h2>
          <p className="mt-0.5 font-body text-[13px] leading-snug text-muted">
            {unlockedUltra
              ? 'Todo el detalle registral + análisis con IA.'
              : 'Historial de dueños, papeletas, gravámenes, orden de captura y siniestralidad.'}
          </p>
        </div>
        <Badge tone="success" size="sm" icon="lock_open">Activo</Badge>
      </div>
      <div className="flex flex-col gap-3 p-5">
        {proEntries.map((entry) => (
          <SectionBlock key={entry.key} entry={entry} section={sectionByKind(entry.dataKind)} vehicle={vehicle} onRetry={onRetry} />
        ))}
        {unlockedUltra
          ? ultraEntries.map((entry) => (
              <SectionBlock key={entry.key} entry={entry} section={sectionByKind(entry.dataKind)} vehicle={vehicle} onRetry={onRetry} />
            ))
          : <UltraUpsell busy={buying === 'ULTRA'} onActivate={() => onActivate('ULTRA')} />}
      </div>
    </section>
  );
}

/** Panel bloqueado (usuario BASIC): teaser + dos pasos (Desbloquear → Pro/Ultra). */
function LockedPaidPanel({
  proEntries, ultraEntries, onActivate, buying,
}: {
  proEntries: readonly SectionCatalogEntry[];
  ultraEntries: readonly SectionCatalogEntry[];
  onActivate: (tier: 'PRO' | 'ULTRA') => void;
  buying: 'PRO' | 'ULTRA' | null;
}) {
  const [revealed, setRevealed] = useState(false);
  const all = [...proEntries, ...ultraEntries];
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <div className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-teal-50 text-teal-700">
          <Icon name="workspace_premium" className="text-[24px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-lg font-extrabold tracking-tight text-foreground">Reporte completo (Pro y Ultra)</h2>
          <p className="mt-0.5 font-body text-[13px] leading-snug text-muted">
            Historial de dueños y precios, papeletas, gravámenes, orden de captura, siniestralidad y análisis con IA.
          </p>
        </div>
        <Badge tone="neutral" size="sm" icon="lock">Bloqueado</Badge>
      </div>
      <div className="p-5">
        <div className="grid gap-2.5 sm:grid-cols-2">
          {all.map((e) => (
            <div key={e.key} className="flex items-start gap-2.5 rounded-xl border border-border bg-background p-3">
              <Icon name={e.icon} className="mt-0.5 text-[20px] text-slate-400" />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-body text-[14px] font-semibold text-foreground">
                  {e.label}
                  {e.tier === ReportTier.ULTRA && <Badge tone="info" size="sm" icon={null}>Ultra</Badge>}
                </p>
                <p className="font-body text-[12.5px] leading-snug text-muted">{e.blurb}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-dashed border-border bg-background px-4 py-5">
          {!revealed ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <Button variant="accent" size="lg" icon="lock_open" onClick={() => setRevealed(true)}>
                Desbloquear reporte completo
              </Button>
              <p className="max-w-sm font-body text-[12.5px] leading-snug text-muted">
                Elige tu nivel. Nuestros especialistas procesan el reporte y estará listo en 3 a 10 minutos.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="font-body text-[13px] font-semibold text-foreground">Elige tu nivel</p>
              <div className="flex flex-col items-stretch gap-2.5 sm:flex-row sm:justify-center">
                <Button variant="secondary" size="lg" onClick={() => onActivate('PRO')} disabled={!!buying}>
                  {buying === 'PRO' ? 'Procesando…' : 'Activar Pro · S/ 15.90'}
                </Button>
                <div className="relative">
                  <Button variant="accent" size="lg" icon="auto_awesome" onClick={() => onActivate('ULTRA')} disabled={!!buying}>
                    {buying === 'ULTRA' ? 'Procesando…' : 'Activar Ultra · S/ 19.90'}
                  </Button>
                  <span className="pointer-events-none absolute -top-2.5 right-2 rounded-full bg-teal-600 px-2 py-0.5 font-body text-[10px] font-bold uppercase tracking-wide text-white shadow">
                    Con IA
                  </span>
                </div>
              </div>
              <p className="max-w-md font-body text-[12.5px] leading-snug text-muted">
                <strong className="text-foreground">Ultra</strong> incluye recomendación de compra con IA y valorización de mercado.
                Al activar, el reporte se procesa y estará listo en 3 a 10 minutos.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Upsell a Ultra dentro del panel Pro ya desbloqueado. */
function UltraUpsell({ busy, onActivate }: { busy: boolean; onActivate: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-teal-300 bg-teal-50/60 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon name="auto_awesome" className="text-[20px] text-teal-700" />
        <h4 className="font-heading text-[15px] font-bold text-foreground">Sube a Ultra</h4>
        <Badge tone="info" size="sm" icon={null}>Con IA</Badge>
      </div>
      <p className="mb-3 font-body text-[13px] leading-snug text-muted">
        Recomendación de compra con IA a partir de todo el reporte y valorización de mercado.
      </p>
      <Button variant="accent" size="md" icon="auto_awesome" onClick={onActivate} disabled={busy}>
        {busy ? 'Procesando…' : 'Activar Ultra · S/ 19.90'}
      </Button>
    </div>
  );
}

/* ── Modal de pago con Yape personal (manual) ─────────────────────── */
function YapeModal({
  plate,
  tier,
  orderId,
  onVerify,
  onClose,
}: {
  plate: string;
  tier: 'PRO' | 'ULTRA';
  orderId?: string;
  onVerify: () => Promise<Tier>;
  onClose: () => void;
}) {
  const number = process.env.NEXT_PUBLIC_YAPE_NUMBER ?? '';
  const name = process.env.NEXT_PUBLIC_YAPE_NAME ?? 'PlacaPe';
  const price = tier === 'ULTRA' ? '19.90' : '15.90';
  const ref = (orderId ?? '').slice(0, 8).toUpperCase();
  const [checking, setChecking] = useState(false);
  const [notYet, setNotYet] = useState(false);

  const check = async () => {
    setChecking(true);
    setNotYet(false);
    const t = await onVerify();
    setChecking(false);
    if (t === 'BASIC') setNotYet(true);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-[420px] rounded-2xl bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-heading text-lg font-bold text-foreground">Paga con Yape</h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-muted hover:text-foreground">
            <Icon name="close" className="text-[22px]" />
          </button>
        </div>
        <p className="mb-4 font-body text-sm text-muted">
          Desbloquea tu reporte <strong className="text-foreground">{tier === 'ULTRA' ? 'Ultra' : 'Pro'}</strong> de la placa{' '}
          <span className="font-mono font-bold text-foreground">{plate}</span>.
        </p>
        <div className="mb-4 rounded-xl border border-border bg-background p-4">
          <div className="flex items-baseline justify-between">
            <span className="font-body text-sm text-muted">Monto</span>
            <span className="font-heading text-2xl font-extrabold text-foreground">S/ {price}</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="font-body text-sm text-muted">Yapear a</span>
            <span className="font-mono text-base font-bold text-foreground">{number || '—'}</span>
          </div>
          <p className="mt-0.5 text-right font-body text-[13px] text-muted">{name}</p>
          {ref && (
            <div className="mt-3 rounded-lg bg-azul-50 px-3 py-2 text-center">
              <p className="font-body text-[12px] text-azul-700">En el mensaje del Yape escribe:</p>
              <p className="font-mono text-base font-bold tracking-wider text-primary">{ref}</p>
            </div>
          )}
        </div>
        <p className="mb-4 font-body text-[13px] leading-snug text-muted">
          Apenas confirmemos tu pago (unos minutos) tu reporte se desbloquea. Pulsa «Ya yapeé» para verificar.
        </p>
        {notYet && (
          <p className="mb-3 rounded-md border border-warning/40 bg-warning-bg px-3 py-2 font-body text-[13px] text-warning-fg">
            Aún no vemos tu pago. Si ya yapeaste, espera unos minutos y verifica de nuevo.
          </p>
        )}
        <div className="flex gap-2.5">
          <Button variant="accent" block size="md" icon="check" onClick={check} disabled={checking}>
            {checking ? 'Verificando…' : 'Ya yapeé'}
          </Button>
          <Button variant="secondary" size="md" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}

function ComingSoon({ blurb }: { blurb: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon name="schedule" className="mt-0.5 text-[18px] text-slate-400" />
      <p className="font-body text-sm text-muted">
        {blurb} <span className="text-slate-400">(próximamente)</span>
      </p>
    </div>
  );
}

/** Cuerpo de cada sección desbloqueada: dato real o "próximamente". */
function SectionBody({
  entry,
  section,
  vehicle,
  onRetry,
}: {
  entry: SectionCatalogEntry;
  section?: SectionResult;
  vehicle: Report['vehicle'];
  onRetry: () => void;
}) {
  if (entry.key === 'identidad') {
    if (section?.status === SectionStatus.AVAILABLE && vehicle) {
      return (
        <DefGrid
          items={[
            ['Marca', vehicle.brand],
            ['Modelo', vehicle.model],
            ['Año', vehicle.year ? String(vehicle.year) : null],
            ['Color', vehicle.color],
            ['Serie', vehicle.serie],
            ['VIN', vehicle.vin],
            ['Motor', vehicle.engineNumber],
            ['Placa anterior', vehicle.platePrevious],
            ['Estado', vehicle.registralStatus],
            ['Anotaciones', vehicle.annotations],
            ['Sede', vehicle.sede],
          ]}
        />
      );
    }
    return section ? <Unavailable status={section.status} onRetry={onRetry} /> : <ComingSoon blurb={entry.blurb} />;
  }

  if (entry.key === 'propietarios') {
    return vehicle?.owner ? <PropietariosBody owner={vehicle.owner} /> : <ComingSoon blurb={entry.blurb} />;
  }

  if (entry.key === 'identidad_especifica') {
    return section ? <IdentidadEspecificaBody section={section} onRetry={onRetry} /> : <ComingSoon blurb={entry.blurb} />;
  }

  if (entry.key === 'soat') {
    return section ? <SegurosBody section={section} onRetry={onRetry} /> : <ComingSoon blurb={entry.blurb} />;
  }

  if (entry.key === 'siniestralidad') {
    return section ? <SiniestroBody section={section} onRetry={onRetry} /> : <ComingSoon blurb={entry.blurb} />;
  }

  if (entry.key === 'papeletas') {
    return section ? <PapeletasBody section={section} onRetry={onRetry} /> : <ComingSoon blurb={entry.blurb} />;
  }

  if (entry.key === 'captura') {
    return section ? <CapturaBody section={section} onRetry={onRetry} /> : <ComingSoon blurb={entry.blurb} />;
  }

  if (entry.key === 'revision_tecnica') {
    return section ? <RevisionBody section={section} vehicle={vehicle} onRetry={onRetry} /> : <ComingSoon blurb={entry.blurb} />;
  }

  if (entry.key === 'gravamenes') {
    return section ? <GravamenesBody section={section} onRetry={onRetry} /> : <ComingSoon blurb={entry.blurb} />;
  }

  if (entry.key === 'historial') {
    return section ? <HistorialBody section={section} onRetry={onRetry} /> : <ComingSoon blurb={entry.blurb} />;
  }

  if (entry.key === 'transporte') {
    return section ? <TransporteBody section={section} onRetry={onRetry} /> : <ComingSoon blurb={entry.blurb} />;
  }

  if (entry.key === 'valorizacion') {
    return section ? <ValorizacionBody section={section} onRetry={onRetry} /> : <ComingSoon blurb={entry.blurb} />;
  }

  if (entry.key === 'ia') {
    return section ? <IaBody section={section} onRetry={onRetry} /> : <ComingSoon blurb={entry.blurb} />;
  }

  return <ComingSoon blurb={entry.blurb} />;
}

/* ── Análisis con IA (ULTRA) ──────────────────────────────────────── */
function ValorizacionBody({ section, onRetry }: { section: SectionResult; onRetry: () => void }) {
  if (section.status !== SectionStatus.AVAILABLE) return <Unavailable status={section.status} onRetry={onRetry} />;
  const v = section.payload as Valuation | undefined;
  if (!v) return <Unavailable status={SectionStatus.UNAVAILABLE} onRetry={onRetry} />;
  const soles = (n: number) => `S/ ${Math.round(n).toLocaleString('es-PE')}`;
  const confTone: Record<string, Tone> = { alta: 'success', media: 'warning', baja: 'neutral' };

  if (!v.available) {
    return (
      <div className="flex flex-col gap-3">
        <StatusLine tone="neutral" icon="info">No se pudo estimar el precio base (modelo poco común o importado).{v.basis ? ` ${v.basis}` : ''}</StatusLine>
        <p className="font-body text-[11px] leading-snug text-slate-400">{v.disclaimer}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Rango estimado (banda de uso promedio, con ajustes aplicados) */}
      <div className="rounded-xl border border-border bg-background p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-body text-xs font-bold uppercase tracking-wide text-muted">Precio estimado (uso promedio)</span>
          <Badge tone={confTone[v.confidence] ?? 'neutral'} size="sm" icon={null}>confianza {v.confidence}</Badge>
        </div>
        <p className="mt-1 font-display text-[26px] font-bold text-foreground">{soles(v.netMin)} – {soles(v.netMax)}</p>
        {v.basis && <p className="mt-0.5 font-body text-[12px] text-muted">{v.basis}</p>}
      </div>

      {v.blocked && <StatusLine tone="danger" icon="gpp_bad">Anotación de robo vigente — no proceder con la compra.</StatusLine>}

      {/* Precio por rango de kilometraje */}
      <div>
        <p className="mb-1.5 font-body text-xs font-bold uppercase tracking-wide text-muted">Precio por rango de kilometraje</p>
        <div className="flex flex-col gap-1.5">
          {v.bands.map((b, i) => (
            <div key={i} className={`flex items-center justify-between gap-2 rounded-lg border p-2.5 ${b.isExpected ? 'border-border bg-background' : 'border-border bg-surface'}`}>
              <div className="flex flex-col">
                <span className="font-body text-[13px] font-semibold text-foreground">
                  {b.label}
                  {b.isExpected && <Badge tone="info" size="sm" icon={null}>referencia</Badge>}
                </span>
                <span className="font-body text-[11.5px] text-muted">{b.kmRange}</span>
              </div>
              <span className="font-mono text-[13px] text-foreground">{soles(b.priceMin)} – {soles(b.priceMax)}</span>
            </div>
          ))}
        </div>
        {v.expectedKm != null && (
          <p className="mt-1 font-body text-[11px] text-slate-400">
            Km esperado por antigüedad ≈ {v.expectedKm.toLocaleString('es-PE')} km (≈15 000/año). El kilometraje real no es público en Perú.
          </p>
        )}
      </div>

      {/* Ajustes por condición (ya reflejados en los precios) */}
      {v.adjustments.length > 0 && (
        <div>
          <p className="mb-1.5 font-body text-xs font-bold uppercase tracking-wide text-muted">Ajustes por condición del vehículo</p>
          <div className="flex flex-col gap-1.5">
            {v.adjustments.map((a, i) => (
              <div key={i} className="rounded-lg border border-border bg-surface p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-body text-[13px] font-semibold text-foreground">{a.factor}</span>
                  <span className="font-mono text-[12px] text-danger">{a.impact}</span>
                </div>
                <p className="mt-0.5 font-body text-[12px] text-muted">{a.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="font-body text-[11px] leading-snug text-slate-400">{v.disclaimer}</p>
    </div>
  );
}

function IaBody({ section, onRetry }: { section: SectionResult; onRetry: () => void }) {
  if (section.status !== SectionStatus.AVAILABLE) return <Unavailable status={section.status} onRetry={onRetry} />;
  const a = section.payload as IaAnalysis | undefined;
  if (!a) return <Unavailable status={SectionStatus.UNAVAILABLE} onRetry={onRetry} />;
  const V: Record<string, { tone: Tone; icon: string; label: string }> = {
    comprar: { tone: 'success', icon: 'thumb_up', label: 'Comprar' },
    precaucion: { tone: 'warning', icon: 'warning', label: 'Con precaución' },
    evitar: { tone: 'danger', icon: 'gpp_bad', label: 'Evitar' },
  };
  const verdict = V[a.verdict] ?? V.precaucion!;
  const sevTone: Record<string, Tone> = { alta: 'danger', media: 'warning', baja: 'neutral' };
  return (
    <div className="flex flex-col gap-3">
      <StatusLine tone={verdict.tone} icon={verdict.icon}>Veredicto de la IA: {verdict.label}</StatusLine>
      {a.summary && <p className="font-body text-[15px] leading-relaxed text-foreground">{a.summary}</p>}

      {a.redFlags.length > 0 && (
        <div className="flex flex-col gap-2">
          {a.redFlags.map((f, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-3">
              <div className="flex items-center gap-2">
                <Badge tone={sevTone[f.severity] ?? 'neutral'} size="sm" icon={null}>{f.severity}</Badge>
                <span className="font-body text-[14px] font-semibold text-foreground">{f.title}</span>
              </div>
              <p className="mt-1 font-body text-[13px] text-muted">{f.detail}</p>
            </div>
          ))}
        </div>
      )}

      {a.positives.length > 0 && (
        <div className="rounded-lg border border-success/30 bg-success-bg p-3">
          <p className="mb-1 font-body text-xs font-bold uppercase tracking-wide text-success">Puntos a favor</p>
          <ul className="list-disc pl-5 font-body text-[13px] text-foreground">
            {a.positives.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}

      <div className="rounded-lg border border-border bg-background p-3">
        <p className="font-body text-[13px] leading-relaxed text-foreground"><strong>Recomendación:</strong> {a.recommendation}</p>
        {a.priceComment && <p className="mt-1.5 font-body text-[12.5px] leading-snug text-muted"><strong>Precio:</strong> {a.priceComment}</p>}
      </div>

      <p className="font-body text-[11px] leading-snug text-slate-400">
        Análisis generado por IA a partir del reporte. Es referencial y no reemplaza una inspección mecánica ni asesoría legal.
      </p>
    </div>
  );
}

function PapeletasBody({ section, onRetry }: { section: SectionResult; onRetry: () => void }) {
  if (section.status !== SectionStatus.AVAILABLE) return <Unavailable status={section.status} onRetry={onRetry} />;
  const p = section.payload as PapeletasPayload | undefined;
  if (!p) return <Unavailable status={SectionStatus.UNAVAILABLE} onRetry={onRetry} />;
  const dondeTxt = p.checkedScopes && p.checkedScopes.length ? p.checkedScopes.join(' ni ') : 'las jurisdicciones consultadas';
  if (p.total === 0) {
    return <StatusLine tone="success" icon="verified">{`Sin papeletas pendientes en ${dondeTxt}`}</StatusLine>;
  }
  const nPapeletas = p.count ?? p.total;
  return (
    <div className="flex flex-col gap-3">
      <StatusLine tone="warning" icon="receipt_long">
        {`${nPapeletas} papeleta${nPapeletas === 1 ? '' : 's'}${p.pendingAmount > 0 ? ` · S/ ${p.pendingAmount.toFixed(2)} pendiente` : ''}`}
      </StatusLine>
      {p.benefitAmount && p.benefitAmount > 0 ? (
        <StatusLine tone="success" icon="savings">
          {`Beneficio de pronto pago: S/ ${p.benefitAmount.toFixed(2)}${p.benefitUntil ? ` si cancelas antes del ${p.benefitUntil}` : ''}`}
        </StatusLine>
      ) : null}
      <DefGrid items={p.items.map((it) => [it.entity, it.amount > 0 ? `S/ ${it.amount.toFixed(2)}` : 'Pendiente (revisar en el portal)'] as [string, string])} />
      {p.detalle && p.detalle.length > 0 && (
        <ol className="flex flex-col gap-2">
          {p.detalle.map((d, i) => (
            <li key={i} className="rounded-lg border border-border bg-surface p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-body text-[13px] font-semibold text-foreground">
                  {d.infraccion ? `Falta ${d.infraccion}` : 'Papeleta'}{d.numero ? ` · ${d.numero}` : ''}
                </span>
                {d.monto != null && d.monto > 0 && <span className="font-mono text-[13px] text-foreground">S/ {d.monto.toFixed(2)}</span>}
              </div>
              {(d.fecha || d.estado) && (
                <div className="mt-0.5 flex flex-wrap gap-x-3 font-body text-[12px] text-muted">
                  {d.fecha && <span>{d.fecha}</span>}
                  {d.estado && <span className="capitalize">{d.estado}</span>}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function CapturaBody({ section, onRetry }: { section: SectionResult; onRetry: () => void }) {
  if (section.status !== SectionStatus.AVAILABLE) return <Unavailable status={section.status} onRetry={onRetry} />;
  const c = section.payload as CapturaIndicator | undefined;
  if (!c) return <Unavailable status={SectionStatus.UNAVAILABLE} onRetry={onRetry} />;
  return c.hasCapture ? (
    <StatusLine tone="danger" icon="gavel">Registra orden de captura en Lima (SAT) — verifica con la autoridad</StatusLine>
  ) : (
    <StatusLine tone="success" icon="verified">Sin orden de captura registrada en Lima (SAT)</StatusLine>
  );
}

// Cronograma oficial de la 1ª ITV según el ÚLTIMO dígito de la placa (Reglamento Nacional de
// Inspecciones Técnicas Vehiculares): mes de referencia + etiqueta legible.
const CITV_CRONOGRAMA: Record<string, { month: number; label: string }> = {
  '0': { month: 1, label: 'enero-febrero' }, '1': { month: 3, label: 'marzo' }, '2': { month: 4, label: 'abril' },
  '3': { month: 5, label: 'mayo' }, '4': { month: 6, label: 'junio' }, '5': { month: 7, label: 'julio-agosto' },
  '6': { month: 9, label: 'septiembre' }, '7': { month: 10, label: 'octubre' }, '8': { month: 11, label: 'noviembre' },
  '9': { month: 12, label: 'diciembre' },
};

function RevisionBody({ section, vehicle, onRetry }: { section: SectionResult; vehicle: Report['vehicle']; onRetry: () => void }) {
  const params = useParams<{ placa: string }>();
  if (section.status !== SectionStatus.AVAILABLE) return <Unavailable status={section.status} onRetry={onRetry} />;
  const r = section.payload as RevisionTecnica | undefined;
  if (!r) return <Unavailable status={SectionStatus.UNAVAILABLE} onRetry={onRetry} />;
  // Regla de la ITV (Reglamento): PARTICULAR obligada desde el 4º año (exento los 3 primeros);
  // SERVICIO (taxi/transporte/carga) desde el 3er año. El mes exacto lo fija el cronograma según
  // el último dígito de la placa. Sin certificado, solo es "vencida" si YA le corresponde; si es
  // nuevo —o no sabemos la edad— NO se alarma.
  const year = vehicle?.year ?? null;
  const servicio = /taxi|transporte|colectiv|carga|mercanc|servicio/i.test(r.serviceType ?? '');
  const lastDigit = (params.placa ?? '').replace(/\D/g, '').slice(-1);
  const crono = lastDigit ? CITV_CRONOGRAMA[lastDigit] : undefined;
  const now = new Date();
  const noCert = !r.lastInspection && !r.validUntil;
  // Año de la 1ª ITV: particular = 4º año (refYear+3, exento 3 años); servicio = 3er año (refYear+2).
  const dueYear = year != null ? year + (servicio ? 2 : 3) : null;
  const dueMonth = crono?.month ?? 1;
  const obligado = dueYear != null && (now.getFullYear() > dueYear || (now.getFullYear() === dueYear && now.getMonth() + 1 >= dueMonth));
  const vencida = !r.hasValid && (!noCert || obligado); // tuvo CITV (vencido) o ya obligado sin él
  const cuando = dueYear != null ? `${crono ? `${crono.label} de ` : ''}${dueYear}` : null;
  return (
    <div className="flex flex-col gap-3">
      {r.hasValid ? (
        <StatusLine tone="success" icon="fact_check">Revisión técnica vigente</StatusLine>
      ) : vencida ? (
        <StatusLine tone="warning" icon="warning">Revisión técnica vencida o sin registro vigente</StatusLine>
      ) : (
        <StatusLine tone="success" icon="schedule">
          {cuando
            ? `Aún no requiere revisión técnica — ${servicio ? 'vehículo de servicio: obligatoria desde el 3er año' : 'particular: obligatoria desde el 4º año'}; le corresponde desde ${cuando}.`
            : 'Aún no requiere revisión técnica (vehículo nuevo / aún no obligado).'}
        </StatusLine>
      )}
      {/lunas|polariza|oscurec/i.test(r.lunasPolarizadas ?? '') && (
        <StatusLine tone="warning" icon="dark_mode">Posibles lunas polarizadas (mención en el CITV — verificar)</StatusLine>
      )}
      <DefGrid
        items={[
          ['Estado', r.status],
          ['Última', r.lastInspection],
          ['Vence', r.validUntil],
          ['Resultado', r.result],
          ['Certificado', r.certificate],
          ['Tipo de servicio', r.serviceType],
          ['Observaciones', r.observaciones],
        ]}
      />
    </div>
  );
}

function GravamenesBody({ section, onRetry }: { section: SectionResult; onRetry: () => void }) {
  if (section.status !== SectionStatus.AVAILABLE) return <Unavailable status={section.status} onRetry={onRetry} />;
  const g = section.payload as GravamenesPayload | undefined;
  if (!g) return <Unavailable status={SectionStatus.UNAVAILABLE} onRetry={onRetry} />;
  const vigentes = g.items.filter((it) => it.status !== 'LEVANTADO');
  const levantados = g.items.filter((it) => it.status === 'LEVANTADO');
  const list = vigentes.length > 0 ? vigentes : g.items;
  const enEjecucion = list.some((it) => /EJECUCI/i.test(it.status ?? ''));
  const MAX = 6;
  return (
    <div className="flex flex-col gap-3">
      {enEjecucion ? (
        <StatusLine tone="danger" icon="gavel">
          Garantía mobiliaria EN EJECUCIÓN — el acreedor inició la ejecución de la prenda por falta de pago (el vehículo está siendo recuperado). No concretes la compra sin cancelar y levantar la carga.
        </StatusLine>
      ) : g.hasLiens ? (
        <StatusLine tone="warning" icon="account_balance">
          Registra gravamen/carga — el vehículo podría estar en garantía de un crédito
        </StatusLine>
      ) : levantados.length > 0 ? (
        <StatusLine tone="success" icon="verified">
          Garantía mobiliaria cancelada — el vehículo quedó libre de esa carga
        </StatusLine>
      ) : (
        <StatusLine tone="success" icon="verified">Sin gravámenes ni cargas vigentes</StatusLine>
      )}
      {g.hasLiens && g.items.length === 0 && (
        <p className="font-body text-[13px] text-muted">
          Detalle (acreedor y monto) no disponible en esta consulta — se obtiene del historial registral (SPRL).
        </p>
      )}
      {list.slice(0, MAX).map((it, i) => (
        <div key={i} className="rounded-lg border border-border bg-surface p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-body text-[14px] font-semibold text-foreground">{it.type}</span>
            {/EJECUCI/i.test(it.status ?? '') ? (
              <Badge tone="danger" size="sm" icon={null}>En ejecución</Badge>
            ) : it.status === 'LEVANTADO' ? (
              <Badge tone="neutral" size="sm" icon={null}>Levantado</Badge>
            ) : null}
          </div>
          <DefGrid
            items={[
              ['Acreedor', it.creditor],
              ['Monto', it.amount != null ? `S/ ${it.amount.toFixed(2)}` : null],
              ['Fecha', it.date],
              ['Folio', it.folio ?? null],
            ]}
          />
          {it.detail && (
            <p className="mt-2 rounded-md border border-border bg-muted/5 p-2 font-body text-[13px] text-muted">
              <span className="font-semibold text-foreground">Motivo del incumplimiento: </span>
              {it.detail}
            </p>
          )}
        </div>
      ))}
      {list.length > MAX && (
        <p className="font-body text-xs text-muted">+{list.length - MAX} gravamen(es) más en el historial registral.</p>
      )}
    </div>
  );
}

function IdentidadEspecificaBody({ section, onRetry }: { section: SectionResult; onRetry: () => void }) {
  if (section.status !== SectionStatus.AVAILABLE) return <Unavailable status={section.status} onRetry={onRetry} />;
  const s = section.payload as VehicleSpecs | undefined;
  if (!s) return <Unavailable status={SectionStatus.UNAVAILABLE} onRetry={onRetry} />;
  return (
    <div className="flex flex-col gap-3">
      {s.version && (
        <StatusLine tone="neutral" icon="tune">
          Versión: <strong>{s.version}</strong>
        </StatusLine>
      )}
      <DefGrid
        items={[
          ['Categoría', s.category],
          ['Tipo de uso', s.usage],
          ['Carrocería', s.bodywork],
          ['Combustible', s.fuel],
          ['Cilindrada', s.displacement],
          ['Cilindros', s.cylinders],
          ['Potencia', s.power],
          ['Fórmula rodante', s.driveFormula],
          ['Ejes', s.axles],
          ['Ruedas', s.wheels],
          ['Asientos', s.seats],
          ['Pasajeros', s.passengers],
          ['Longitud', s.length],
          ['Ancho', s.width],
          ['Altura', s.height],
          ['Peso bruto', s.grossWeight],
          ['Peso neto', s.netWeight],
          ['Carga útil', s.payload],
        ]}
      />
      <p className="font-body text-[12px] text-muted">
        Ficha técnica del asiento registral{s.sourceTitle ? ` ${s.sourceTitle}` : ''} (SUNARP). Refleja el estado actual del vehículo (incluye cambios como conversión a GNV o color).
      </p>
    </div>
  );
}

function TransporteBody({ section, onRetry }: { section: SectionResult; onRetry: () => void }) {
  if (section.status !== SectionStatus.AVAILABLE) return <Unavailable status={section.status} onRetry={onRetry} />;
  const t = section.payload as TransporteInfo | undefined;
  if (!t) return <Unavailable status={SectionStatus.UNAVAILABLE} onRetry={onRetry} />;
  return (
    <div className="flex flex-col gap-3">
      {t.isPublicTransport ? (
        <StatusLine tone="warning" icon="local_taxi">
          Registrado para taxi/transporte — uso intensivo (mayor desgaste)
        </StatusLine>
      ) : (
        <StatusLine tone="success" icon="verified">No figura como taxi/transporte</StatusLine>
      )}
      <DefGrid
        items={[
          ['Modalidad', t.modality],
          ['Vigencia', t.validUntil],
          ['Titular', t.holder],
          ['Documento', t.holderDoc],
          ['Detalle', t.detail],
        ]}
      />
    </div>
  );
}

function HistorialBody({ section, onRetry }: { section: SectionResult; onRetry: () => void }) {
  if (section.status !== SectionStatus.AVAILABLE) return <Unavailable status={section.status} onRetry={onRetry} />;
  const h = section.payload as HistorialPayload | undefined;
  if (!h) return <Unavailable status={SectionStatus.UNAVAILABLE} onRetry={onRetry} />;
  // Banderas DURAS (siniestro/pérdida total): aseguradora o casa de remate → alerta.
  const hardTxt = [
    h.flags.aseguradora && 'aseguradora',
    h.flags.remate && 'remate',
  ]
    .filter(Boolean)
    .join(' · ');
  // El timeline viene cronológico ascendente; mostramos lo más reciente primero.
  const events = [...h.events].reverse();
  const MAX = 12;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Badge tone="info" size="sm" icon="swap_horiz">
          {h.transfers} transferencia(s)
        </Badge>
        <Badge tone="neutral" size="sm" icon="description">
          {h.totalAsientos} asiento(s)
        </Badge>
      </div>
      {hardTxt && (
        <StatusLine tone="warning" icon="flag">
          Banderas en el historial: {hardTxt}
        </StatusLine>
      )}
      {/* "Financiera" es señal BLANDA (una entidad financiera/banco aparece en el historial:
          compra financiada o leasing, muy común). Solo mandamos a «Gravámenes» si ahí HAY algo
          (carga vigente o levantada); si no, la nota lo aclara para no confundir. */}
      {h.flags.financiera && !hardTxt && (
        <StatusLine tone="neutral" icon="account_balance">
          {h.flags.gravamen
            ? 'Aparece una entidad financiera en su historial (compra financiada o leasing). Revisa «Gravámenes / prendas» para el estado vigente de la carga.'
            : 'Aparece una entidad financiera en su historial (compra financiada o leasing — muy común). No figura una prenda ni garantía registrada en los asientos disponibles.'}
        </StatusLine>
      )}
      {events.length > 0 ? (
        <ol className="flex flex-col gap-2.5">
          {events.slice(0, MAX).map((e, i) => {
            // Un asiento puede tener varias acciones (2 compra-ventas en tracto sucesivo, o
            // cancelación + compra-venta): se listan por separado, sin sumar montos. Si todas
            // comparten acto, se rotula una vez; si son distintas, cada bloque nombra el suyo.
            const acciones = e.acciones ?? [];
            const actos = [...new Set(acciones.map((a) => a.act).filter(Boolean))];
            const multi = acciones.length > 1;
            const header = actos.length === 1 ? actos[0] : actos.length > 1 ? `${acciones.length} actos en el asiento` : 'Asiento registral';
            return (
              <li key={i} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-body text-[14px] font-semibold text-foreground">{header}</span>
                  {e.date && <span className="font-mono text-[12px] text-muted">{e.date}</span>}
                </div>
                <div className="mt-1 flex flex-col gap-2">
                  {acciones.map((a, j) => (
                    <div key={j} className={multi ? 'border-l-2 border-border pl-2.5' : 'flex flex-col gap-0.5'}>
                      {multi && a.act && <span className="font-body text-[13px] font-semibold text-foreground">{a.act}</span>}
                      {a.price && (
                        <span className="font-body text-[13px] text-foreground">
                          Precio: <strong>{a.price}</strong>
                        </span>
                      )}
                      {a.parties && <span className="font-body text-[13px] text-muted">{a.parties}</span>}
                    </div>
                  ))}
                  {e.title && <span className="font-mono text-[11px] text-slate-400">{e.title}</span>}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="font-body text-sm text-muted">Sin asientos detallados disponibles.</p>
      )}
      {events.length > MAX && (
        <p className="font-body text-xs text-muted">+{events.length - MAX} asiento(s) más en el historial.</p>
      )}
    </div>
  );
}

function PropietariosBody({ owner }: { owner: OwnerInfo }) {
  return (
    <div>
      <p className="font-body text-[15px] font-medium text-foreground">{owner.name}</p>
      {owner.note && <p className="mt-1 font-body text-xs text-muted">{owner.note}</p>}
    </div>
  );
}

function SegurosBody({ section, onRetry }: { section: SectionResult; onRetry: () => void }) {
  if (section.status !== SectionStatus.AVAILABLE) return <Unavailable status={section.status} onRetry={onRetry} />;
  const p = section.payload as InsurancePolicy | undefined;
  if (!p) return <Unavailable status={SectionStatus.UNAVAILABLE} onRetry={onRetry} />;
  const tipo = p.insuranceType ?? 'SOAT';
  return (
    <div className="flex flex-col gap-3">
      {p.hasActiveSoat ? (
        <StatusLine tone="success" icon="verified">{tipo} vigente</StatusLine>
      ) : (
        <StatusLine tone="warning" icon="warning">{`No se encontró ${tipo} vigente a nombre de esta placa`}</StatusLine>
      )}
      <DefGrid
        items={[
          ['Compañía', p.insurer],
          ['Certificado', p.certificate],
          ['Vigencia', [p.validFrom, p.validTo].filter(Boolean).join(' – ') || null],
          ['Uso', p.use],
          ['Clase', p.vehicleClass],
          ['Tipo', p.policyType],
          ['N° de póliza', p.policyNumber],
        ]}
      />
      <p className="font-body text-xs text-muted">
        El <strong className="text-foreground">SOAT</strong> es obligatorio solo para vehículos particulares. Los de{' '}
        transporte público o taxi usan <strong className="text-foreground">CAT</strong> (Certificado contra Accidentes de
        Tránsito), que reemplaza al SOAT — para ellos, no tener SOAT no es una falta. El{' '}
        <strong className="text-foreground">seguro vehicular</strong> es una cobertura opcional; ningún vehículo está
        obligado a tenerlo.
      </p>
    </div>
  );
}

function SiniestroBody({ section, onRetry }: { section: SectionResult; onRetry: () => void }) {
  if (section.status !== SectionStatus.AVAILABLE) return <Unavailable status={section.status} onRetry={onRetry} />;
  const s = section.payload as SiniestroIndicator | undefined;
  if (!s) return <Unavailable status={SectionStatus.UNAVAILABLE} onRetry={onRetry} />;
  return (
    <div className="flex flex-col gap-3">
      {(() => {
        const periodo = s.periodYears === 1 ? 'el último año' : `los últimos ${s.periodYears} años`;
        return s.hasSiniestro ? (
          <StatusLine tone="warning" icon="build">
            Registra siniestralidad en {periodo} — se recomienda una inspección exhaustiva para verificar reparaciones.
          </StatusLine>
        ) : (
          <StatusLine tone="success" icon="verified">Sin siniestros registrados en {periodo}</StatusLine>
        );
      })()}
      {s.accidentes != null && s.accidentes > 0 && (
        <>
          <p className="font-body text-sm text-foreground">
            <strong>{s.accidentes}</strong> siniestro(s) reportado(s) a la SBS (SOAT · Seguro Vehicular · CAT).
          </p>
          {s.siniestros && s.siniestros.length > 0 && (
            <ol className="flex flex-col gap-2">
              {s.siniestros.map((sin, i) => (
                <li key={i} className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-body text-[14px] font-semibold text-foreground">
                      {sin.cantidad} siniestro(s) · {sin.tipo === 'VEHICULAR' ? 'Seguro Vehicular' : sin.tipo}
                    </span>
                    {(sin.desde || sin.hasta) && (
                      <span className="font-mono text-[12px] text-muted">
                        {sin.desde ?? '—'} – {sin.hasta ?? '—'}
                      </span>
                    )}
                  </div>
                  {sin.aseguradora && <p className="mt-0.5 font-body text-[13px] text-muted">{sin.aseguradora}</p>}
                </li>
              ))}
            </ol>
          )}
          <p className="font-body text-[12px] leading-snug text-muted">
            Un «siniestro» es un evento reportado a la aseguradora bajo esa póliza — puede ir desde un
            daño leve (un roce o abolladura) hasta una pérdida total. El número no indica la gravedad;
            se recomienda una inspección para verificar reparaciones.
          </p>
        </>
      )}
      {s.auction && (
        <div className="rounded-lg border border-warning/40 bg-warning-bg p-3">
          <p className="flex items-center gap-1.5 font-body text-[13px] font-bold text-warning-fg">
            <Icon name="gavel" className="text-[16px]" />
            Apareció en subasta{s.auction.fuente ? ` (${s.auction.fuente})` : ''}
            {s.auction.tipo ? ` · ${s.auction.tipo}` : ''}
          </p>
          {s.auction.subasta && (
            <p className="mt-0.5 font-body text-[13px] text-foreground">
              {s.auction.subasta}
              {s.auction.estado ? ` — ${s.auction.estado}` : ''}
            </p>
          )}
          {s.auction.boletaUrl && (
            <a
              href={s.auction.boletaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 font-body text-[13px] font-semibold text-primary hover:underline"
            >
              <Icon name="description" className="text-[16px]" /> Ver boleta del lote
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Estados de plan / carga ──────────────────────────────────────── */
function ProGate({ placa, mode }: { placa: string; mode: 'soon' | 'required' }) {
  return (
    <div className="mx-auto max-w-[560px] overflow-hidden rounded-2xl border border-border bg-surface text-center shadow-sm">
      <div className="px-6 py-12 sm:px-10">
        <div className="mx-auto mb-5 grid h-[84px] w-[84px] place-items-center rounded-full bg-azul-50">
          <Icon name="workspace_premium" className="text-[46px] text-primary" />
        </div>
        <h1 className="font-heading text-[26px] font-extrabold tracking-tight text-foreground">
          Reporte automático
        </h1>
        <p className="mx-auto mb-6 mt-3 max-w-md font-body text-base leading-relaxed text-muted">
          {mode === 'required'
            ? 'El reporte consolidado requiere una cuenta con plan activo. Mientras tanto puedes ver un reporte de ejemplo.'
            : 'El reporte consolidado automático estará disponible muy pronto. Mira cómo se verá con un reporte de ejemplo.'}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="accent" size="lg" href="/reporte/ejemplo" iconRight="arrow_forward">
            Ver reporte de ejemplo
          </Button>
          {mode === 'required' ? (
            <Button variant="secondary" size="lg" href="/cuenta" icon="person">
              Iniciar sesión
            </Button>
          ) : (
            <Button variant="secondary" size="lg" href="/planes" icon="sell">
              Ver planes
            </Button>
          )}
        </div>
        <p className="mt-5 font-mono text-[12.5px] text-slate-400">Placa {formatPlateDisplay(placa)}</p>
      </div>
    </div>
  );
}

const BUYING_TIPS = [
  'Verifica que el N° de serie (VIN) del vehículo coincida con el de la tarjeta de propiedad.',
  'Revisa que no tenga papeletas ni deudas pendientes antes de cerrar el trato.',
  'Muchos dueños en poco tiempo puede ser una señal de alerta.',
  'Desconfía de precios muy por debajo del mercado: suelen ocultar problemas.',
  'Confirma que no tenga orden de captura ni gravámenes vigentes.',
  'Hazlo revisar por un mecánico de confianza antes de comprar.',
  'Comprueba que el SOAT y la revisión técnica estén vigentes.',
  'Si estuvo como taxi o transporte, espera mayor desgaste por uso intensivo.',
  'Pide el DNI del vendedor y confirma que coincida con el titular registral (SUNARP).',
  'Nunca pagues por adelantado sin ver el vehículo y los documentos originales.',
  'Haz la transferencia de propiedad de inmediato para evitar papeletas ajenas.',
];

/** Progreso simulado: sube rápido y se acerca a ~96% (asíntota); salta a 100% al terminar (`finishing`).
 *  `tau` alto = sube más lento (reportes de pago que tardan minutos); `initial` = punto de partida. */
function useSimulatedProgress(tau: number, initial: number, finishing = false): number {
  const [pct, setPct] = useState(initial);
  useEffect(() => {
    if (finishing) { setPct(100); return; }
    const start = Date.now();
    const id = setInterval(() => {
      const s = (Date.now() - start) / 1000;
      setPct(Math.min(96, Math.max(initial, Math.round(96 * (1 - Math.exp(-s / tau))))));
    }, 350);
    return () => clearInterval(id);
  }, [finishing, tau, initial]);
  return pct;
}

/** Anillo de progreso circular reutilizable. */
function ProgressRing({ pct, label, size = 148 }: { pct: number; label: string; size?: number }) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const off = C * (1 - pct / 100);
  return (
    <div className="relative grid place-items-center">
      <svg width={size} height={size} viewBox="0 0 148 148">
        <circle cx="74" cy="74" r={R} fill="none" stroke="#E2E8F0" strokeWidth="11" />
        <circle
          cx="74" cy="74" r={R} fill="none" stroke="#16B5A3" strokeWidth="11" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={off} transform="rotate(-90 74 74)"
          style={{ transition: 'stroke-dashoffset 0.4s ease-out' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-heading text-[34px] font-extrabold leading-none text-foreground">{pct}%</span>
        <span className="mt-1 font-body text-xs text-muted">{label}</span>
      </div>
    </div>
  );
}

/** Consejos de compra que rotan cada 5 s. */
function useBuyingTip(): number {
  const [tip, setTip] = useState(() => Math.floor(Math.random() * BUYING_TIPS.length));
  useEffect(() => {
    const t = setInterval(() => setTip((i) => (i + 1) % BUYING_TIPS.length), 5000);
    return () => clearInterval(t);
  }, []);
  return tip;
}

function BuyingTip({ tip }: { tip: number }) {
  return (
    <div className="w-full rounded-xl border border-azul-200 bg-azul-50 p-4">
      <p className="mb-1.5 flex items-center gap-1.5 font-body text-xs font-bold uppercase tracking-wide text-azul-700">
        <Icon name="lightbulb" className="text-[16px]" /> Consejo al comprar
      </p>
      <p key={tip} className="font-body text-[15px] leading-snug text-foreground">{BUYING_TIPS[tip]}</p>
    </div>
  );
}

function LoadingView({ placa, finishing = false }: { placa: string; finishing?: boolean }) {
  const pct = useSimulatedProgress(20, 4, finishing);
  const tip = useBuyingTip();
  return (
    <div className="bg-background">
      <div className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1240px] items-center gap-2.5 px-4 py-3 sm:px-7">
          <Icon name="directions_car" className="text-xl text-muted" />
          <span className="font-mono text-[15px] font-bold tracking-wide text-foreground">{formatPlateDisplay(placa)}</span>
          <span className="font-body text-sm text-muted">· Consultando portales oficiales…</span>
        </div>
      </div>
      <div className="mx-auto grid max-w-[560px] place-items-center gap-7 px-4 py-14 sm:py-20" aria-busy="true" aria-live="polite">
        <ProgressRing pct={pct} label="Generando" />
        <div className="text-center">
          <h2 className="font-heading text-xl font-bold text-foreground">Generando tu reporte…</h2>
          <p className="mx-auto mt-1.5 max-w-sm font-body text-sm text-muted">
            Estamos consultando los portales oficiales (SUNARP, SOAT, revisión técnica y más). Toma unos segundos — no cierres esta pestaña.
          </p>
        </div>
        <BuyingTip tip={tip} />
      </div>
    </div>
  );
}

/** Carga scoped a la sección de pago: se muestra en lugar del panel PRO/ULTRA mientras el motor
 *  reúne las fuentes de pago. El resto del reporte (gratis) sigue visible; al terminar, se retira
 *  y aparecen las secciones completas. */
function PaidPanelLoading({ tier, finishing = false }: { tier: 'PRO' | 'ULTRA'; finishing?: boolean }) {
  const tierName = tier === 'ULTRA' ? 'Ultra' : 'Pro';
  const pct = useSimulatedProgress(240, 2, finishing);
  const tip = useBuyingTip();
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <div className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-teal-50 text-teal-700">
          <Icon name={tier === 'ULTRA' ? 'auto_awesome' : 'workspace_premium'} className="text-[24px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-lg font-extrabold tracking-tight text-foreground">Reporte {tierName}</h2>
          <p className="mt-0.5 font-body text-[13px] leading-snug text-muted">Reuniendo las fuentes oficiales…</p>
        </div>
        <Badge tone="info" size="sm" icon="hourglass_top">Procesando</Badge>
      </div>
      <div className="grid place-items-center gap-6 px-4 py-10 sm:py-12" aria-busy="true" aria-live="polite">
        <ProgressRing pct={pct} label="Procesando" size={128} />
        <div className="text-center">
          <h3 className="font-heading text-lg font-bold text-foreground">
            Nuestros especialistas están procesando tu reporte {tierName}
          </h3>
          <p className="mx-auto mt-1.5 max-w-md font-body text-sm text-muted">
            Estamos reuniendo el historial de dueños y precios, papeletas, gravámenes, siniestralidad
            {tier === 'ULTRA' ? ' y el análisis con IA' : ''} desde las fuentes oficiales. Toma de{' '}
            <strong className="text-foreground">3 a 10 minutos</strong>. Puedes dejar esta pestaña
            abierta — se completará aquí mismo apenas esté listo.
          </p>
        </div>
        <div className="w-full max-w-md">
          <BuyingTip tip={tip} />
        </div>
      </div>
    </section>
  );
}
