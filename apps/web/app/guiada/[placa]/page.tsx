import type { Metadata } from 'next';
import Link from 'next/link';
import {
  OFFICIAL_LINKS,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  formatPlateDisplay,
  type LinkCategory,
  type OfficialLink,
} from '@app/shared';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/CopyButton';

/**
 * Consulta guiada: lista pública de los portales oficiales para que el usuario
 * mismo haga las consultas (gratis). Quien no quiera hacer 15+ pasos pulsa el CTA
 * para pedir el reporte completo asistido (lo arma un agente y lo envía por
 * WhatsApp/correo). Los enlaces viven en packages/shared/links.ts.
 */

const CATEGORY_ICON: Record<LinkCategory, string> = {
  REGISTRAL: 'account_balance',
  SEGUROS: 'verified_user',
  REVISION_TECNICA: 'build',
  TRANSPORTE: 'local_taxi',
  GNV: 'local_gas_station',
  PAPELETAS: 'receipt_long',
  IMPUESTO_VEHICULAR: 'payments',
  CAPTURA: 'gavel',
  INFRACCIONES: 'warning',
};

function normalize(raw: string): string {
  return decodeURIComponent(raw).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ placa: string }>;
}): Promise<Metadata> {
  const { placa } = await params;
  const display = formatPlateDisplay(normalize(placa));
  return {
    title: `Consulta guiada de la placa ${display} — portales oficiales | PlacaPe`,
    description: `Enlaces oficiales (SUNARP, SAT, SBS, MTC, SUTRAN, ATU, APESEG) para consultar tú mismo la placa ${display}, o pide tu reporte completo.`,
  };
}

function LinkCard({ link, plate }: { link: OfficialLink; plate: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-md bg-azul-50 px-2 py-0.5 font-mono text-[11.5px] font-bold tracking-wide text-primary">
          {link.entity}
        </span>
        <span className="inline-flex items-center gap-1 font-body text-[12px] text-muted">
          <Icon name="location_on" className="text-[14px] text-teal-700" />
          {link.scope}
        </span>
      </div>
      <h3 className="mb-1 font-heading text-[16px] font-bold text-foreground">{link.name}</h3>
      <p className="mb-3 flex-1 font-body text-[13.5px] leading-relaxed text-muted">{link.description}</p>
      {link.note && (
        <p className="mb-3 flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning-bg px-2.5 py-1.5 font-body text-[12px] leading-snug text-warning-fg">
          <Icon name="info" className="mt-px text-[14px]" />
          <span>{link.note}</span>
        </p>
      )}
      <div className="mt-auto flex items-center gap-2">
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-transparent bg-primary px-3.5 py-2 font-body text-sm font-semibold text-white transition-colors hover:bg-primary-600 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          Abrir portal <Icon name="open_in_new" className="text-[16px]" />
        </a>
        <CopyButton text={plate} label="Copiar placa" />
      </div>
    </div>
  );
}

export default async function GuiadaPage({ params }: { params: Promise<{ placa: string }> }) {
  const { placa } = await params;
  const plate = normalize(placa);
  const display = formatPlateDisplay(plate);

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    links: OFFICIAL_LINKS.filter((l) => l.category === cat),
  })).filter((g) => g.links.length > 0);

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-10 sm:px-8">
      {/* Breadcrumb / volver */}
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1.5 font-body text-sm font-semibold text-primary hover:underline"
      >
        <Icon name="arrow_back" className="text-[16px]" /> Inicio
      </Link>

      {/* Encabezado */}
      <div className="mb-8">
        <p className="mb-2 font-body text-[12.5px] font-bold uppercase tracking-widest text-teal-700">
          Consulta guiada · gratis
        </p>
        <h1 className="font-heading text-[30px] font-extrabold tracking-tight text-foreground sm:text-[38px]">
          Consulta tú mismo la placa
        </h1>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-stretch overflow-hidden rounded-xl border-2 border-azul-700">
            <span className="flex flex-col items-center justify-center bg-azul-700 px-2.5 py-1 font-body text-[10px] font-bold leading-tight text-white">
              PE<span className="text-[8px] opacity-80">PERÚ</span>
            </span>
            <span className="px-4 py-2 font-mono text-2xl font-bold tracking-[0.08em] text-foreground">
              {display}
            </span>
          </span>
          <CopyButton text={plate} />
        </div>
        <p className="mt-4 max-w-[640px] font-body text-[15px] leading-relaxed text-muted">
          Abre cada portal oficial y consulta la placa tú mismo, sin costo. En los formularios que no
          permiten prellenar la placa, pégala con el botón <strong>“Copiar placa”</strong>.
        </p>
      </div>

      {/* CTA: reporte asistido */}
      <div className="mb-10 overflow-hidden rounded-2xl bg-azul-950 p-6 sm:p-8">
        <div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
          <div className="max-w-[640px]">
            <h2 className="font-heading text-[22px] font-bold tracking-tight text-white sm:text-[26px]">
              ¿Demasiados pasos? Te armamos el reporte completo
            </h2>
            <p className="mt-2 font-body text-[15px] leading-relaxed text-azul-200">
              Consolidamos todas las fuentes —incluido el historial de propietarios— en un solo
              reporte y te lo enviamos por <strong className="text-white">WhatsApp</strong> y{' '}
              <strong className="text-white">correo</strong>. Tú solo pones la placa.
            </p>
          </div>
          <Button variant="accent" size="lg" iconRight="arrow_forward" href={`/reporte/${plate}`}>
            Quiero mi reporte
          </Button>
        </div>
      </div>

      {/* Links por categoría */}
      <div className="space-y-10">
        {grouped.map(({ cat, links }) => (
          <section key={cat}>
            <div className="mb-4 flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-teal-50">
                <Icon name={CATEGORY_ICON[cat]} className="text-xl text-teal-700" />
              </div>
              <h2 className="font-heading text-[20px] font-bold tracking-tight text-foreground">
                {CATEGORY_LABELS[cat]}
              </h2>
              <span className="font-mono text-[12px] text-muted">({links.length})</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {links.map((l) => (
                <LinkCard key={l.id} link={l} plate={plate} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Nota legal corta */}
      <p className="mt-10 font-body text-[12.5px] leading-relaxed text-muted">
        PlacaPe no es un portal oficial; enlazamos a las fuentes públicas para tu comodidad. La
        información mostrada en cada portal pertenece a su entidad. El historial de propietarios
        proviene de la Publicidad Registral de SUNARP.
      </p>
    </div>
  );
}
