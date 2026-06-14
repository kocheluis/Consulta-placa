'use client';

import { useEffect } from 'react';
import { StateScreen } from '@/components/StateScreen';
import { Button } from '@/components/ui/Button';

/** Error boundary global (App Router). Debe ser client component. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // En producción esto puede enviarse a un servicio de monitoreo.
    console.error(error);
  }, [error]);

  return (
    <section className="bg-background px-4 py-16 sm:py-24">
      <StateScreen
        tone="danger"
        icon="error"
        title="Algo salió mal"
        description="No pudimos completar tu solicitud en este momento. No se te cobró nada. Vuelve a intentarlo en unos segundos."
        footer={error.digest ? `Error ${error.digest}` : undefined}
      >
        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="accent" size="lg" icon="refresh" onClick={reset}>
            Reintentar
          </Button>
          <Button variant="secondary" size="lg" icon="support_agent" href="mailto:soporte@placape.pe">
            Contactar soporte
          </Button>
        </div>
      </StateScreen>
    </section>
  );
}
