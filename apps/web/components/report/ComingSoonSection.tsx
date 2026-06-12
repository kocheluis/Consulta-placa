import { Clock4 } from 'lucide-react';

const LABELS: Record<string, string> = {
  PAPELETAS: 'Papeletas e infracciones',
  GNV: 'Deuda de GNV',
  DEUDA_BANCARIA: 'Deuda bancaria / prendas',
  PNP: 'Investigación PNP',
};

/** Tarjeta atenuada para capacidades aún no disponibles (FR-032). */
export function ComingSoonSection({ kind }: { kind: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface/60 p-4 opacity-75">
      <div className="flex items-center gap-2 text-neutral">
        <Clock4 className="h-5 w-5" aria-hidden="true" />
        <span className="font-medium">{LABELS[kind] ?? kind}</span>
      </div>
      <p className="mt-1 text-xs text-neutral">Próximamente</p>
    </div>
  );
}
