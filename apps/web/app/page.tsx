import { Search, Sparkles, ShieldCheck } from 'lucide-react';
import { PlateSearch } from '@/components/PlateSearch';

const FAQ = [
  {
    q: '¿Cómo consultar una placa en Perú?',
    a: 'Ingresa el número de placa y elige "Consulta guiada". Te damos los enlaces oficiales (SUNARP, SAT, SBS, MTC) para que consultes cada dato directamente en la fuente, gratis.',
  },
  {
    q: '¿La consulta de placa es gratis?',
    a: 'Sí. La consulta guiada con los enlaces oficiales es totalmente gratuita y no requiere registro. Cada portal oficial es público y sin costo.',
  },
  {
    q: '¿Cómo saber si un vehículo tiene papeletas?',
    a: 'Con la placa puedes consultar papeletas en el portal nacional del MTC y en el SAT de tu jurisdicción (Lima, Callao, Piura, Ica, Huancayo, Chiclayo, Cajamarca, Arequipa, entre otros).',
  },
  {
    q: '¿Cómo saber si un auto tiene orden de captura?',
    a: 'En el SAT correspondiente puedes verificar si el vehículo tiene orden de captura o internamiento por deudas impagas (papeletas o impuesto vehicular).',
  },
  {
    q: '¿Qué datos muestra la consulta vehicular de SUNARP?',
    a: 'SUNARP muestra el titular, marca, modelo, año, color, número de serie, VIN, motor y la anotación de robo si existe. Para el historial completo de transferencias se usa la Publicidad Registral (SPRL).',
  },
];

export default function HomePage() {
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  return (
    <div className="mx-auto max-w-7xl px-4">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <section className="py-12 sm:py-16 text-center">
        <h1 className="text-3xl sm:text-4xl font-semibold text-foreground">
          Consulta de placa e historial vehicular en Perú
        </h1>
        <p className="mt-4 text-lg text-muted max-w-2xl mx-auto">
          Revisa por placa los datos registrales (SUNARP), papeletas, SOAT, siniestros, GNV,
          impuesto vehicular y orden de captura. Gratis y con enlaces oficiales.
        </p>

        <div className="mt-8 max-w-xl mx-auto text-left">
          <PlateSearch />
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 pb-8">
        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Search className="h-6 w-6 text-primary" aria-hidden="true" />
            <h2 className="font-heading font-semibold text-foreground">Consulta guiada · Gratis</h2>
          </div>
          <p className="text-sm text-muted">
            Te damos los enlaces oficiales: SUNARP (titular y transferencias), SOAT/siniestros,
            revisión técnica, GNV, papeletas (Lima, Callao y regiones), impuesto vehicular y orden
            de captura. Abres cada uno y consultas tú mismo. Sin costo, 100% oficial.
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

      {/* Qué puedes consultar (contenido SEO) */}
      <section className="pb-8">
        <h2 className="text-2xl font-semibold text-foreground text-center mb-6">
          ¿Qué puedes consultar por placa?
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['Datos registrales (SUNARP)', 'Titular, marca, modelo, año, serie, VIN, motor y alerta de robo.'],
            ['Transferencias (SPRL)', 'Historial completo de dueños y traspasos en la partida registral.'],
            ['Seguro SOAT y siniestros', 'Vigencia del SOAT e historial de accidentes (SBS, APESEG).'],
            ['Papeletas por región', 'Multas de tránsito en Lima, Callao y SATs provinciales.'],
            ['Impuesto vehicular', 'Deuda del impuesto al patrimonio vehicular (municipal).'],
            ['Orden de captura', 'Si el vehículo tiene captura o internamiento por deuda.'],
          ].map(([t, d]) => (
            <div key={t} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
              <h3 className="font-medium text-foreground">{t}</h3>
              <p className="mt-1 text-sm text-muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Preguntas frecuentes (SEO + rich results) */}
      <section className="pb-12 max-w-3xl mx-auto">
        <h2 className="text-2xl font-semibold text-foreground text-center mb-6">
          Preguntas frecuentes
        </h2>
        <div className="space-y-3">
          {FAQ.map((f) => (
            <details key={f.q} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
              <summary className="font-medium text-foreground cursor-pointer">{f.q}</summary>
              <p className="mt-2 text-sm text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="pb-16 flex items-center justify-center gap-2 text-sm text-muted">
        <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
        Información referencial de portales públicos oficiales.
      </section>
    </div>
  );
}
