import Link from 'next/link';
import {
  ArrowLeft,
  ExternalLink,
  Info,
  KeyRound,
  Car,
  ShieldCheck,
  Wrench,
  Flame,
  Receipt,
  Coins,
  Lock,
  Gavel,
} from 'lucide-react';
import {
  OFFICIAL_LINKS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  formatPlateDisplay,
  type LinkCategory,
} from '@app/shared';
import { CopyButton } from '@/components/CopyButton';

const CATEGORY_ICON: Record<LinkCategory, React.ReactNode> = {
  REGISTRAL: <Car className="h-5 w-5" aria-hidden="true" />,
  SEGUROS: <ShieldCheck className="h-5 w-5" aria-hidden="true" />,
  REVISION_TECNICA: <Wrench className="h-5 w-5" aria-hidden="true" />,
  GNV: <Flame className="h-5 w-5" aria-hidden="true" />,
  PAPELETAS: <Receipt className="h-5 w-5" aria-hidden="true" />,
  IMPUESTO_VEHICULAR: <Coins className="h-5 w-5" aria-hidden="true" />,
  CAPTURA: <Lock className="h-5 w-5" aria-hidden="true" />,
  INFRACCIONES: <Gavel className="h-5 w-5" aria-hidden="true" />,
};

export default async function GuiadaPage({ params }: { params: Promise<{ placa: string }> }) {
  const { placa } = await params;
  const display = formatPlateDisplay(placa);

  const categories = CATEGORY_ORDER.map((cat) => ({
    cat,
    links: OFFICIAL_LINKS.filter((l) => l.category === cat),
  })).filter((g) => g.links.length > 0);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-accent hover:underline mb-4">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Nueva consulta
      </Link>

      {/* Encabezado */}
      <div className="rounded-xl border border-border bg-surface shadow-sm p-5 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Consulta guiada · Gratis</h1>
          <p className="text-muted">
            Placa <span className="font-mono font-semibold text-foreground">{display}</span> · abre
            cada portal oficial y consulta tú mismo.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <CopyButton text={display} />
          <Link
            href={`/reporte/${placa}`}
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-primary-600 cursor-pointer"
          >
            Reporte automático · PRO
          </Link>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-3 flex gap-3">
        <Info className="h-5 w-5 text-accent shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm text-muted">
          Cada enlace abre el portal oficial en una pestaña nueva. Pega tu placa (botón «Copiar») y
          resuelve allí el CAPTCHA. Es gratis y 100% oficial.
        </p>
      </div>

      {/* Categorías */}
      <div className="mt-8 space-y-8">
        {categories.map(({ cat, links }) => (
          <section key={cat}>
            <h2 className="flex items-center gap-2 font-heading font-semibold text-foreground mb-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {CATEGORY_ICON[cat]}
              </span>
              {CATEGORY_LABELS[cat]}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {links.map((link) => (
                <a
                  key={link.id}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex h-full flex-col rounded-xl border border-border bg-surface p-4 shadow-sm transition-all duration-200 hover:border-primary hover:shadow-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-foreground leading-snug">{link.name}</p>
                    <ExternalLink
                      className="h-4 w-4 text-muted group-hover:text-primary shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                  </div>
                  <p className="mt-0.5 text-xs font-medium text-accent">{link.entity}</p>
                  <p className="mt-2 text-sm text-muted flex-1">{link.description}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {link.scope !== 'Nacional' && (
                      <span className="inline-block rounded-full bg-warning-bg px-2 py-0.5 text-xs text-warning-fg">
                        {link.scope}
                      </span>
                    )}
                    {link.note && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted">
                        <KeyRound className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {link.note}
                      </span>
                    )}
                  </div>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-10 text-xs text-muted border-t border-border pt-4">
        Los enlaces dirigen a portales públicos oficiales (.gob.pe y APESEG). ConsultaPlaca no
        almacena ni intermedia estas consultas en el modo gratuito.
      </p>
    </div>
  );
}
