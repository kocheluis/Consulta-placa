import { Clock } from 'lucide-react';

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

/** Sello de fuente + fecha, obligatorio en cada sección disponible (FR-031). */
export function SourceBadge({ source, fetchedAt }: { source: string | null; fetchedAt: string | null }) {
  if (!source) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
      {source}
      {fetchedAt && (
        <>
          <span aria-hidden="true">·</span>
          <Clock className="h-3 w-3" aria-hidden="true" />
          {relativeTime(fetchedAt)}
        </>
      )}
    </span>
  );
}
