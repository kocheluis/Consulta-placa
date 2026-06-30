'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
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
const TIER_NAME: Record<string, string> = {
  [ReportTier.BASIC]: 'Gratis',
  [ReportTier.PRO]: 'Pro',
  [ReportTier.ULTRA]: 'Ultra',
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

  if (state.phase === 'loading') {
    return <LoadingView placa={placa} />;
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

  return <ReportView report={state.report} cached={state.cached} onRetry={actualizar} preview={preview} />;
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
      const d = (await r.json()) as { ok?: boolean };
      if (d.ok) {
        onStarted(); // hay pedido en cola → empieza el polling del reporte
        return;
      }
      setErr('No pudimos iniciar la consulta. Verifica el formato de la placa (ej. ABC-123).');
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
function ReportView({ report, cached, onRetry, preview }: { report: Report; cached: boolean; onRetry: () => void; preview?: string }) {
  const router = useRouter();
  const v = report.vehicle;
  const score = computeScore(report);
  const sectionByKind = (kind: string | null): SectionResult | undefined =>
    kind ? report.sections.find((s) => s.kind === kind) : undefined;

  // Nivel desbloqueado por el usuario para esta placa (pago por reporte).
  // En preview de operador se fuerza ULTRA para mostrar todas las secciones.
  const [currentTier, setCurrentTier] = useState<Tier>(preview ? 'ULTRA' : 'BASIC');
  const [buying, setBuying] = useState<'PRO' | 'ULTRA' | null>(null);
  const [pendingYape, setPendingYape] = useState<{ tier: 'PRO' | 'ULTRA'; orderId?: string } | null>(null);
  useEffect(() => {
    if (preview) { setCurrentTier('ULTRA'); return; }
    getPaidTier(report.placa)
      .then(setCurrentTier)
      .catch(() => {});
  }, [report.placa, preview]);

  const comprar = async (tier: 'PRO' | 'ULTRA') => {
    setBuying(tier);
    try {
      const res = await buyReport(report.placa, tier);
      if (res.status === 'paid') {
        setCurrentTier(await getPaidTier(report.placa)); // mock / aprobado al instante
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

  // Reconsulta el nivel pagado (tras yapear, el usuario pulsa "Verificar").
  const verificarPago = async (): Promise<Tier> => {
    const t = await getPaidTier(report.placa);
    setCurrentTier(t);
    if (t !== 'BASIC') setPendingYape(null);
    return t;
  };

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

        {/* Secciones — desde el catálogo: BASIC con datos, PRO/ULTRA bloqueados */}
        <main className="grid items-start gap-4 sm:grid-cols-2">
          {SECTION_CATALOG.map((entry) => {
            // Las fuentes aún no conectadas (comingSoon) NO se bloquean ni se cobran:
            // se muestran como "Próximamente" (integridad, ver fuentes-inventario.md).
            const locked = !entry.comingSoon && TIER_RANK[entry.tier] > TIER_RANK[currentTier as ReportTier];
            const section = sectionByKind(entry.dataKind);
            const wide = entry.key === 'identidad' || entry.key === 'ia' || entry.key === 'historial';
            const needed: 'PRO' | 'ULTRA' = entry.tier === ReportTier.ULTRA ? 'ULTRA' : 'PRO';
            return (
              <CatalogCard
                key={entry.key}
                entry={entry}
                locked={locked}
                wide={wide}
                busy={buying === needed}
                onBuy={() => comprar(needed)}
              >
                <SectionBody entry={entry} section={section} vehicle={v} onRetry={onRetry} />
              </CatalogCard>
            );
          })}
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

/* ── Tarjeta de sección (catálogo) con bloqueo por tier ───────────── */
function CatalogCard({
  entry,
  locked,
  wide,
  onBuy,
  busy,
  children,
}: {
  entry: SectionCatalogEntry;
  locked: boolean;
  wide?: boolean;
  onBuy: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  const neededName = entry.tier === ReportTier.ULTRA ? 'Ultra' : 'Pro';
  const action = entry.comingSoon ? (
    <Badge tone="neutral" size="sm" icon="schedule">
      Próximamente
    </Badge>
  ) : locked ? (
    <Badge tone="neutral" size="sm" icon="lock">
      {neededName}
    </Badge>
  ) : entry.tier === ReportTier.BASIC ? (
    <Badge tone="neutral" size="sm" icon={null}>
      Gratis
    </Badge>
  ) : null;
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <Card title={entry.label} icon={entry.icon} action={action}>
        {locked ? (
          <div className="relative">
            <div className="pointer-events-none select-none opacity-50 blur-[5px]">
              <p className="font-body text-sm text-muted">{entry.blurb}</p>
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-3 text-center">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-surface shadow-md">
                <Icon name="lock" className="text-[22px] text-primary" />
              </div>
              <span className="font-body text-[13px] font-semibold text-slate-700">Disponible en {neededName}</span>
              <Button variant="accent" size="sm" iconRight="arrow_forward" onClick={onBuy} disabled={busy}>
                {busy ? 'Procesando…' : `Mejorar a ${neededName}`}
              </Button>
            </div>
          </div>
        ) : (
          children
        )}
      </Card>
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

  return <ComingSoon blurb={entry.blurb} />;
}

function PapeletasBody({ section, onRetry }: { section: SectionResult; onRetry: () => void }) {
  if (section.status !== SectionStatus.AVAILABLE) return <Unavailable status={section.status} onRetry={onRetry} />;
  const p = section.payload as PapeletasPayload | undefined;
  if (!p) return <Unavailable status={SectionStatus.UNAVAILABLE} onRetry={onRetry} />;
  const dondeTxt = p.checkedScopes && p.checkedScopes.length ? p.checkedScopes.join(' ni ') : 'las jurisdicciones consultadas';
  if (p.total === 0) {
    return <StatusLine tone="success" icon="verified">{`Sin papeletas pendientes en ${dondeTxt}`}</StatusLine>;
  }
  return (
    <div className="flex flex-col gap-3">
      <StatusLine tone="warning" icon="receipt_long">
        {`${p.total} concepto(s) con papeletas${p.pendingAmount > 0 ? ` · S/ ${p.pendingAmount.toFixed(2)} pendiente` : ''}`}
      </StatusLine>
      <DefGrid items={p.items.map((it) => [it.entity, it.amount > 0 ? `S/ ${it.amount.toFixed(2)}` : 'Pendiente (revisar en el portal)'] as [string, string])} />
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

function RevisionBody({ section, vehicle, onRetry }: { section: SectionResult; vehicle: Report['vehicle']; onRetry: () => void }) {
  if (section.status !== SectionStatus.AVAILABLE) return <Unavailable status={section.status} onRetry={onRetry} />;
  const r = section.payload as RevisionTecnica | undefined;
  if (!r) return <Unavailable status={SectionStatus.UNAVAILABLE} onRetry={onRetry} />;
  // Los autos particulares NO requieren CITV hasta el 4º año de antigüedad. Si no hay
  // certificado y el vehículo es nuevo, NO es "vencida": aún no le corresponde.
  const year = vehicle?.year ?? null;
  const currentYear = new Date().getFullYear();
  const noCert = !r.lastInspection && !r.validUntil;
  const exempt = !r.hasValid && noCert && year != null && currentYear < year + 3;
  return (
    <div className="flex flex-col gap-3">
      {r.hasValid ? (
        <StatusLine tone="success" icon="fact_check">Revisión técnica vigente</StatusLine>
      ) : exempt ? (
        <StatusLine tone="success" icon="schedule">
          {`Aún no requiere revisión técnica (obligatoria desde el 4º año de antigüedad; le correspondería desde ${year! + 3}).`}
        </StatusLine>
      ) : (
        <StatusLine tone="warning" icon="warning">Revisión técnica vencida o sin registro vigente</StatusLine>
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
  const list = vigentes.length > 0 ? vigentes : g.items;
  const MAX = 6;
  return (
    <div className="flex flex-col gap-3">
      {g.hasLiens ? (
        <StatusLine tone="warning" icon="account_balance">
          Registra gravamen/carga — el vehículo podría estar en garantía de un crédito
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
            {it.status === 'LEVANTADO' && (
              <Badge tone="neutral" size="sm" icon={null}>
                Levantado
              </Badge>
            )}
          </div>
          <DefGrid
            items={[
              ['Acreedor', it.creditor],
              ['Monto', it.amount != null ? `S/ ${it.amount.toFixed(2)}` : null],
              ['Fecha', it.date],
            ]}
          />
        </div>
      ))}
      {list.length > MAX && (
        <p className="font-body text-xs text-muted">+{list.length - MAX} gravamen(es) más en el historial registral.</p>
      )}
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
      <DefGrid items={[['Modalidad', t.modality], ['Detalle', t.detail]]} />
    </div>
  );
}

function HistorialBody({ section, onRetry }: { section: SectionResult; onRetry: () => void }) {
  if (section.status !== SectionStatus.AVAILABLE) return <Unavailable status={section.status} onRetry={onRetry} />;
  const h = section.payload as HistorialPayload | undefined;
  if (!h) return <Unavailable status={SectionStatus.UNAVAILABLE} onRetry={onRetry} />;
  const flagTxt = [
    h.flags.aseguradora && 'aseguradora',
    h.flags.remate && 'remate',
    h.flags.financiera && 'financiera',
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
      {flagTxt && (
        <StatusLine tone="warning" icon="flag">
          Banderas en el historial: {flagTxt}
        </StatusLine>
      )}
      {events.length > 0 ? (
        <ol className="flex flex-col gap-2.5">
          {events.slice(0, MAX).map((e, i) => (
            <li key={i} className="rounded-lg border border-border bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-body text-[14px] font-semibold text-foreground">{e.act || 'Asiento registral'}</span>
                {e.date && <span className="font-mono text-[12px] text-muted">{e.date}</span>}
              </div>
              {(e.price || e.parties || e.title) && (
                <div className="mt-1 flex flex-col gap-0.5">
                  {e.price && (
                    <span className="font-body text-[13px] text-foreground">
                      Precio: <strong>{e.price}</strong>
                    </span>
                  )}
                  {e.parties && <span className="font-body text-[13px] text-muted">{e.parties}</span>}
                  {e.title && <span className="font-mono text-[11px] text-slate-400">{e.title}</span>}
                </div>
              )}
            </li>
          ))}
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
  return (
    <div className="flex flex-col gap-3">
      {p.hasActiveSoat ? (
        <StatusLine tone="success" icon="verified">SOAT vigente</StatusLine>
      ) : (
        <StatusLine tone="warning" icon="warning">Sin SOAT vigente registrado</StatusLine>
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
        <p className="font-body text-sm text-muted">{s.accidentes} accidente(s) reportado(s) al SOAT (SBS).</p>
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

function LoadingView({ placa }: { placa: string }) {
  return (
    <div className="bg-background">
      <div className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1240px] items-center gap-2.5 px-4 py-3 sm:px-7">
          <Icon name="directions_car" className="text-xl text-muted" />
          <span className="font-mono text-[15px] font-bold tracking-wide text-foreground">{formatPlateDisplay(placa)}</span>
          <span className="font-body text-sm text-muted">· Consultando portales oficiales…</span>
        </div>
      </div>
      <div
        className="mx-auto grid max-w-[1240px] items-start gap-6 px-4 py-7 sm:px-7 lg:grid-cols-[300px_1fr]"
        aria-busy="true"
        aria-live="polite"
      >
        <div className="h-44 animate-pulse rounded-xl border border-border bg-surface" />
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-surface p-5 shadow-sm">
              <div className="mb-4 h-5 w-40 animate-pulse rounded bg-slate-200" />
              <div className="space-y-2">
                {[0, 1, 2].map((j) => (
                  <div key={j} className="h-4 w-full animate-pulse rounded bg-slate-100" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
