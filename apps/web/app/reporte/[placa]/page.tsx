'use client';

import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import type {
  Report,
  SectionResult,
  InsurancePolicy,
  SiniestroIndicator,
  SectionCatalogEntry,
  OwnerInfo,
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
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Tag } from '@/components/ui/Tag';
import { RiskGauge } from '@/components/RiskGauge';
import { StateScreen } from '@/components/StateScreen';

const PRO_ENABLED = process.env.NEXT_PUBLIC_PRO_ENABLED === 'true';

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
  const state = useConsulta(placa, refreshToken, PRO_ENABLED);
  const actualizar = () => setRefreshToken((n) => n + 1);

  // Sin pipeline PRO: invitación restyleada.
  if (!PRO_ENABLED) {
    return (
      <div className="bg-background px-4 py-12 sm:py-16">
        <ProGate placa={placa} mode="soon" />
      </div>
    );
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

  return <ReportView report={state.report} cached={state.cached} onRetry={actualizar} />;
}

/* ── Vista del reporte ────────────────────────────────────────────── */
function ReportView({ report, cached, onRetry }: { report: Report; cached: boolean; onRetry: () => void }) {
  const v = report.vehicle;
  const score = computeScore(report);
  const sectionByKind = (kind: string | null): SectionResult | undefined =>
    kind ? report.sections.find((s) => s.kind === kind) : undefined;
  // Sin pago aún: el reporte opera en BASIC; PRO/ULTRA se muestran bloqueados.
  const currentTier = ReportTier.BASIC;
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
            const locked = TIER_RANK[entry.tier] > TIER_RANK[currentTier];
            const section = sectionByKind(entry.dataKind);
            const wide = entry.key === 'identidad' || entry.key === 'ia';
            return (
              <CatalogCard key={entry.key} entry={entry} locked={locked} wide={wide}>
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
    </div>
  );
}

/* ── Tarjeta de sección (catálogo) con bloqueo por tier ───────────── */
function CatalogCard({
  entry,
  locked,
  wide,
  children,
}: {
  entry: SectionCatalogEntry;
  locked: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const neededName = entry.tier === ReportTier.ULTRA ? 'Ultra' : 'Pro';
  const action = locked ? (
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
              <Button variant="accent" size="sm" iconRight="arrow_forward" href="/planes">
                Mejorar a {neededName}
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

  return <ComingSoon blurb={entry.blurb} />;
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
  return s.hasSiniestro ? (
    <StatusLine tone="danger" icon="car_crash">Registra siniestralidad (últimos {s.periodYears} años)</StatusLine>
  ) : (
    <StatusLine tone="success" icon="verified">Sin siniestros registrados</StatusLine>
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
