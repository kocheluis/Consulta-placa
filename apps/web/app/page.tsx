import { Search, Sparkles, ShieldCheck } from 'lucide-react';
import { PlateSearch } from '@/components/PlateSearch';

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-4">
      <section className="py-12 sm:py-16 text-center">
        <h1 className="text-3xl sm:text-4xl font-semibold text-foreground">
          Conoce el historial de un vehículo antes de comprarlo
        </h1>
        <p className="mt-4 text-lg text-muted max-w-2xl mx-auto">
          Consulta por placa los datos registrales, el seguro SOAT y la siniestralidad de un
          vehículo peruano.
        </p>

        <div className="mt-8 max-w-xl mx-auto text-left">
          <PlateSearch />
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 pb-16">
        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Search className="h-6 w-6 text-primary" aria-hidden="true" />
            <h2 className="font-heading font-semibold text-foreground">Consulta guiada · Gratis</h2>
          </div>
          <p className="text-sm text-muted">
            Te damos los enlaces oficiales: SUNARP (titular y transferencias), SOAT/siniestros,
            revisión técnica, GNV, papeletas (Lima, Callao y regiones) e infracciones. Abres cada uno
            y consultas tú mismo. Sin costo, 100% oficial.
          </p>
        </div>
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-6 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" aria-hidden="true" />
            <h2 className="font-heading font-semibold text-foreground">
              Reporte automático · PRO
            </h2>
          </div>
          <p className="text-sm text-muted">
            Un solo reporte consolidado con todos los datos resueltos automáticamente. Requiere una
            cuenta PRO activa.
          </p>
        </div>
      </section>

      <section className="pb-16 flex items-center justify-center gap-2 text-sm text-muted">
        <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
        Información referencial de portales públicos oficiales.
      </section>
    </div>
  );
}
