import { SourceBadge } from './SourceBadge';

/** Tarjeta contenedora de una sección con su sello de fuente. */
export function SectionCard({
  title,
  icon,
  source,
  fetchedAt,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  source: string | null;
  fetchedAt: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <header className="flex items-center justify-between gap-3 mb-3">
        <h3 className="flex items-center gap-2 font-heading font-semibold text-foreground">
          {icon}
          {title}
        </h3>
        <SourceBadge source={source} fetchedAt={fetchedAt} />
      </header>
      {children}
    </section>
  );
}

/** Fila etiqueta/valor; los identificadores van en monoespaciado. */
export function DataRow({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-border/60 last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`text-sm text-foreground text-right ${mono ? 'font-mono' : ''}`}>
        {value ?? '—'}
      </dd>
    </div>
  );
}
