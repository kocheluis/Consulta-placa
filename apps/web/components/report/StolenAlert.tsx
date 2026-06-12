import { ShieldAlert } from 'lucide-react';
import { SourceBadge } from './SourceBadge';

/** Banner de máxima jerarquía cuando el vehículo figura como robado. */
export function StolenAlert({ fetchedAt }: { fetchedAt: string | null }) {
  return (
    <div
      role="alert"
      className="rounded-xl border-2 border-danger bg-danger-bg px-4 py-3 flex items-start gap-3"
    >
      <ShieldAlert className="h-6 w-6 text-danger shrink-0 mt-0.5" aria-hidden="true" />
      <div>
        <p className="font-heading font-bold text-danger-fg">Vehículo reportado como robado</p>
        <p className="text-sm text-danger-fg/90">
          Este vehículo registra una anotación de robo. Verifica antes de cualquier transacción.
        </p>
        <div className="mt-1">
          <SourceBadge source="SUNARP" fetchedAt={fetchedAt} />
        </div>
      </div>
    </div>
  );
}
