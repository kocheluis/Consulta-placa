'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { Car, FileText, Activity, ArrowLeft, RefreshCw } from 'lucide-react';
import type { Report, SectionResult, InsurancePolicy, SiniestroIndicator } from '@app/shared';
import { formatPlateDisplay } from '@app/shared';
import { useConsulta } from '@/lib/use-consulta';
import { StolenAlert } from '@/components/report/StolenAlert';
import { StatusPill } from '@/components/report/StatusPill';
import { SectionCard, DataRow } from '@/components/report/SectionCard';
import { ComingSoonSection } from '@/components/report/ComingSoonSection';

export default function ReportePage() {
  const params = useParams<{ placa: string }>();
  const placa = (params.placa ?? '').toUpperCase();
  const [refreshToken, setRefreshToken] = useState(0);
  const state = useConsulta(placa, refreshToken);
  const actualizar = () => setRefreshToken((n) => n + 1);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between mb-4">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Nueva consulta
        </Link>
        {state.phase === 'done' && (
          <button
            onClick={actualizar}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground transition-colors duration-200 hover:bg-background cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Actualizar
          </button>
        )}
      </div>

      {state.phase === 'loading' && <LoadingSkeleton placa={placa} />}
      {state.phase === 'error' && (
        <div className="rounded-xl border border-warning bg-warning-bg p-5 text-warning-fg" role="alert">
          {state.error}
        </div>
      )}
      {state.phase === 'done' &&
        (state.report ? (
          <ReportView report={state.report} cached={state.cached} onRetry={actualizar} />
        ) : (
          <EmptyState placa={placa} />
        ))}
    </div>
  );
}

function ReportView({
  report,
  cached,
  onRetry,
}: {
  report: Report;
  cached: boolean;
  onRetry: () => void;
}) {
  const v = report.vehicle;
  const registral = report.sections.find((s) => s.kind === 'REGISTRAL');
  const seguros = report.sections.find((s) => s.kind === 'SEGUROS');
  const siniestro = report.sections.find((s) => s.kind === 'SINIESTRALIDAD');
  const comingSoon = report.sections.filter((s) => s.status === 'COMING_SOON');

  return (
    <div className="space-y-4">
      {v?.stolenAlert && <StolenAlert fetchedAt={registral?.fetchedAt ?? null} />}

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-2xl font-semibold tracking-wider text-foreground">{report.placa}</p>
          {v && (
            <p className="text-muted">
              {[v.brand, v.model, v.year, v.color].filter(Boolean).join(' · ') || 'Vehículo'}
            </p>
          )}
          {cached && (
            <p className="mt-1 text-xs text-muted">
              Datos de una consulta previa. Pulsa «Actualizar» para volver a consultar las fuentes.
            </p>
          )}
        </div>
        {report.status === 'PARTIAL' && <StatusPill tone="warning">Reporte parcial</StatusPill>}
      </div>

      {/* Registral */}
      {registral && (
        <SectionCard
          title="Datos registrales"
          icon={<Car className="h-5 w-5 text-accent" aria-hidden="true" />}
          source={registral.source}
          fetchedAt={registral.fetchedAt}
        >
          {registral.status === 'AVAILABLE' && v ? (
            <dl>
              <DataRow label="Marca" value={v.brand} />
              <DataRow label="Modelo" value={v.model} />
              <DataRow label="Año" value={v.year ? String(v.year) : null} />
              <DataRow label="Color" value={v.color} />
              <DataRow label="Serie" value={v.serie} mono />
              <DataRow label="VIN" value={v.vin} mono />
              <DataRow label="Motor" value={v.engineNumber} mono />
              <DataRow label="Placa anterior" value={v.platePrevious} mono />
              {v.owner && <DataRow label="Titular" value={v.owner.name} />}
            </dl>
          ) : (
            <Unavailable status={registral.status} onRetry={onRetry} />
          )}
          {v?.owner && (
            <p className="mt-2 text-xs text-muted">{v.owner.note}</p>
          )}
        </SectionCard>
      )}

      {/* Seguros */}
      {seguros && (
        <SectionCard
          title="Seguro y SOAT"
          icon={<FileText className="h-5 w-5 text-accent" aria-hidden="true" />}
          source={seguros.source}
          fetchedAt={seguros.fetchedAt}
        >
          <SegurosBody section={seguros} onRetry={onRetry} />
        </SectionCard>
      )}

      {/* Siniestralidad */}
      {siniestro && (
        <SectionCard
          title="Siniestralidad"
          icon={<Activity className="h-5 w-5 text-accent" aria-hidden="true" />}
          source={siniestro.source}
          fetchedAt={siniestro.fetchedAt}
        >
          <SiniestroBody section={siniestro} onRetry={onRetry} />
        </SectionCard>
      )}

      {/* Próximamente */}
      {comingSoon.length > 0 && (
        <div>
          <h2 className="font-heading font-semibold text-foreground mb-2">Próximamente</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {comingSoon.map((s) => (
              <ComingSoonSection key={s.kind} kind={s.kind} />
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted border-t border-border pt-4">{report.disclaimer}</p>
    </div>
  );
}

function SegurosBody({ section, onRetry }: { section: SectionResult; onRetry: () => void }) {
  if (section.status !== 'AVAILABLE') return <Unavailable status={section.status} onRetry={onRetry} />;
  const p = section.payload as InsurancePolicy | undefined;
  if (!p) return <Unavailable status="UNAVAILABLE" onRetry={onRetry} />;
  return (
    <div className="space-y-2">
      {p.hasActiveSoat ? (
        <StatusPill tone="success">SOAT vigente</StatusPill>
      ) : (
        <StatusPill tone="warning">Sin seguro registrado en los últimos 5 años</StatusPill>
      )}
      <dl>
        <DataRow label="Aseguradora" value={p.insurer} />
        <DataRow label="N° de póliza" value={p.policyNumber} mono />
        <DataRow label="Vigencia" value={[p.validFrom, p.validTo].filter(Boolean).join(' – ') || null} />
      </dl>
    </div>
  );
}

function SiniestroBody({ section, onRetry }: { section: SectionResult; onRetry: () => void }) {
  if (section.status !== 'AVAILABLE') return <Unavailable status={section.status} onRetry={onRetry} />;
  const s = section.payload as SiniestroIndicator | undefined;
  if (!s) return <Unavailable status="UNAVAILABLE" onRetry={onRetry} />;
  return s.hasSiniestro ? (
    <StatusPill tone="danger">Registra siniestralidad (últimos {s.periodYears} años)</StatusPill>
  ) : (
    <StatusPill tone="success">Sin siniestros registrados</StatusPill>
  );
}

function Unavailable({ status, onRetry }: { status: string; onRetry?: () => void }) {
  if (status === 'NOT_FOUND') {
    return <p className="text-sm text-muted">Sin resultados en la fuente.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-warning-fg">Información no disponible en este momento.</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground transition-colors duration-200 hover:bg-background cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Reintentar
        </button>
      )}
    </div>
  );
}

function EmptyState({ placa }: { placa: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-6 text-center">
      <p className="text-foreground font-medium">Sin resultados para {formatPlateDisplay(placa)}</p>
      <p className="mt-1 text-sm text-muted">
        No se encontró información registral para esta placa. Verifica que esté bien escrita.
      </p>
    </div>
  );
}

function LoadingSkeleton({ placa }: { placa: string }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <p className="font-mono text-2xl font-semibold tracking-wider text-foreground">
        {formatPlateDisplay(placa)}
      </p>
      <p className="text-sm text-muted">Consultando portales oficiales…</p>
      {[0, 1].map((i) => (
        <div key={i} className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <div className="h-5 w-40 bg-slate-200 rounded animate-pulse mb-4" />
          <div className="space-y-2">
            {[0, 1, 2, 3].map((j) => (
              <div key={j} className="h-4 w-full bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
