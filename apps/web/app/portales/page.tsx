import type { Metadata } from 'next';
import {
  OFFICIAL_LINKS,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  type LinkCategory,
  type OfficialLink,
} from '@app/shared';
import { Icon } from '@/components/ui/Icon';
import { HeroSearch } from '@/components/HeroSearch';

/**
 * Directorio público de portales oficiales sugeridos (gratis). Lista todas las fuentes
 * de `links.ts` agrupadas por categoría; quien ingrese su placa va a la consulta guiada
 * (`/guiada/[placa]`) con los enlaces listos. Es el gancho gratuito enlazado desde el menú.
 */
export const metadata: Metadata = {
  title: 'Portales oficiales sugeridos — consulta tu placa gratis | PlacaPe',
  description:
    'Directorio de portales oficiales (SUNARP, SAT, SBS, MTC, SUTRAN, ATU, APESEG) para consultar tu vehículo por placa, gratis. Ingresa tu placa para la guía completa.',
};

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

function PortalCard({ link }: { link: OfficialLink }) {
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
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-auto inline-flex w-fit items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 font-body text-sm font-semibold text-white transition-colors hover:bg-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        Abrir portal <Icon name="open_in_new" className="text-[16px]" />
      </a>
    </div>
  );
}

export default function PortalesPage() {
  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    links: OFFICIAL_LINKS.filter((l) => l.category === cat),
  })).filter((g) => g.links.length > 0);

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-12 sm:px-8">
      {/* Encabezado + buscador */}
      <div className="mb-10 text-center">
        <p className="mb-2 font-body text-[12.5px] font-bold uppercase tracking-widest text-teal-700">
          Portales oficiales · gratis
        </p>
        <h1 className="mx-auto max-w-[760px] font-heading text-[30px] font-extrabold tracking-tight text-foreground sm:text-[38px]">
          Portales sugeridos para consultar tu placa
        </h1>
        <p className="mx-auto mt-4 max-w-[640px] font-body text-[15px] leading-relaxed text-muted">
          Directorio de las fuentes oficiales (SUNARP, SAT, SBS, MTC, SUTRAN, ATU, APESEG). Abre
          cualquiera directamente, o ingresa tu placa para la guía con los enlaces listos.
        </p>
        <div className="mt-7">
          <HeroSearch to="/guiada" cta="Ver portales de mi placa" />
        </div>
      </div>

      {/* Portales por categoría */}
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
                <PortalCard key={l.id} link={l} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-10 font-body text-[12.5px] leading-relaxed text-muted">
        PlacaPe no es un portal oficial; enlazamos a las fuentes públicas para tu comodidad. La
        información mostrada en cada portal pertenece a su entidad.
      </p>
    </div>
  );
}
