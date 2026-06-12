import { FileText, ShieldAlert, Car } from 'lucide-react';
import { PlateInput } from '@/components/PlateInput';

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-4">
      <section className="py-12 sm:py-20 text-center">
        <h1 className="text-3xl sm:text-4xl font-semibold text-foreground">
          Conoce el historial de un vehículo antes de comprarlo
        </h1>
        <p className="mt-4 text-lg text-muted max-w-2xl mx-auto">
          Consulta por placa los datos registrales, el seguro SOAT y la siniestralidad de un
          vehículo peruano.
        </p>

        <div className="mt-8 max-w-xl mx-auto">
          <PlateInput />
          <p className="mt-3 text-sm text-muted">Datos de SUNARP · SBS · SOAT</p>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3 pb-16">
        <Feature
          icon={<Car className="h-6 w-6 text-accent" aria-hidden="true" />}
          title="Datos registrales"
          desc="Titular, marca, modelo, año, color y números de serie/VIN/motor (SUNARP)."
        />
        <Feature
          icon={<FileText className="h-6 w-6 text-accent" aria-hidden="true" />}
          title="Seguro y SOAT"
          desc="Si cuenta con SOAT vigente y su historial de siniestralidad (SBS)."
        />
        <Feature
          icon={<ShieldAlert className="h-6 w-6 text-danger" aria-hidden="true" />}
          title="Alerta de robo"
          desc="Te avisamos si el vehículo figura reportado como robado."
        />
      </section>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-3">{icon}</div>
      <h2 className="font-heading font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-muted">{desc}</p>
    </div>
  );
}
