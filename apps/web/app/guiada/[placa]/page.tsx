import Link from 'next/link';
import { ArrowLeft, ExternalLink, Info } from 'lucide-react';
import {
  OFFICIAL_LINKS,
  CATEGORY_LABELS,
  formatPlateDisplay,
  type LinkCategory,
} from '@app/shared';
import { CopyButton } from '@/components/CopyButton';

export default async function GuiadaPage({ params }: { params: Promise<{ placa: string }> }) {
  const { placa } = await params;
  const display = formatPlateDisplay(placa);

  // Agrupar por categoría.
  const byCategory = OFFICIAL_LINKS.reduce<Record<string, typeof OFFICIAL_LINKS>>((acc, link) => {
    (acc[link.category] ??= []).push(link);
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-accent hover:underline mb-4">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Nueva consulta
      </Link>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Consulta guiada</h1>
          <p className="text-muted">
            Placa <span className="font-mono font-semibold">{display}</span>
          </p>
        </div>
        <CopyButton text={display} />
      </div>

      <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-4 flex gap-3">
        <Info className="h-5 w-5 text-accent shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm text-muted">
          Abre cada portal oficial y pega tu placa para consultar directamente en la fuente. Es
          gratis y oficial. ¿Quieres todo en un solo reporte automático?{' '}
          <Link href={`/reporte/${placa}`} className="text-accent font-medium hover:underline">
            Prueba el reporte PRO
          </Link>
          .
        </p>
      </div>

      <div className="mt-6 space-y-6">
        {Object.entries(byCategory).map(([cat, links]) => (
          <section key={cat}>
            <h2 className="font-heading font-semibold text-foreground mb-2">
              {CATEGORY_LABELS[cat as LinkCategory]}
            </h2>
            <div className="grid gap-3">
              {links.map((link) => (
                <a
                  key={link.id}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group rounded-xl border border-border bg-surface p-4 shadow-sm transition-colors duration-200 hover:border-primary cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">
                        {link.name}{' '}
                        <span className="text-xs font-normal text-muted">· {link.entity}</span>
                      </p>
                      <p className="mt-0.5 text-sm text-muted">{link.description}</p>
                      {link.scope === 'Lima' && (
                        <span className="mt-1 inline-block rounded-full bg-warning-bg px-2 py-0.5 text-xs text-warning-fg">
                          Solo Lima
                        </span>
                      )}
                    </div>
                    <ExternalLink
                      className="h-5 w-5 text-muted group-hover:text-primary shrink-0"
                      aria-hidden="true"
                    />
                  </div>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-8 text-xs text-muted border-t border-border pt-4">
        Los enlaces dirigen a portales públicos oficiales (.gob.pe / APESEG). ConsultaPlaca no
        almacena ni intermedia estas consultas en el modo gratuito.
      </p>
    </div>
  );
}
