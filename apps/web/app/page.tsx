import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { HeroSearch } from '@/components/HeroSearch';

const FAQ = [
  {
    q: '¿Cómo consultar una placa en Perú?',
    a: 'Ingresa el número de placa y verifica. Consolidamos datos de los portales oficiales (SUNARP, SAT, SBS, MTC) en un solo reporte.',
  },
  {
    q: '¿La consulta de placa es gratis?',
    a: 'El nivel básico es gratuito y muestra la información común del vehículo. Los reportes Pro y Ultra, con más fuentes y análisis, son de pago por reporte.',
  },
  {
    q: '¿Cómo saber si un vehículo tiene papeletas?',
    a: 'Con la placa revisamos papeletas a nivel nacional (MTC) y de los SAT por jurisdicción (Lima, Callao, Piura, Ica, Huancayo, Chiclayo, Cajamarca, Arequipa, entre otros).',
  },
  {
    q: '¿Cómo saber si un auto tiene orden de captura?',
    a: 'Verificamos en el SAT correspondiente si el vehículo tiene orden de captura o internamiento por deudas impagas (papeletas o impuesto vehicular).',
  },
  {
    q: '¿Qué datos muestra la consulta vehicular de SUNARP?',
    a: 'Titular, marca, modelo, año, color, número de serie, VIN, motor y la anotación de robo si existe. El historial completo de transferencias está en la Publicidad Registral (SPRL).',
  },
];

const TRUST_CHIPS: [string, string][] = [
  ['bolt', 'Resultado en 30 seg'],
  ['lock', 'Pago y datos cifrados'],
  ['sell', 'Reporte básico gratis'],
];

const SOLUTIONS = [
  {
    icon: 'person',
    title: 'Para compradores',
    desc: 'Verifica el historial completo antes de pagar. Cero sorpresas, decisión tranquila.',
    point: 'Reporte de confianza con semáforo de riesgo',
  },
  {
    icon: 'sell',
    title: 'Para vendedores',
    desc: 'Muestra un reporte limpio y cierra la venta más rápido, generando confianza.',
    point: 'Certificado de transparencia para tu anuncio',
  },
  {
    icon: 'storefront',
    title: 'Para empresas',
    desc: 'Concesionarias y talleres verifican su flota por lote y por volumen.',
    point: 'Packs de volumen y panel de flota',
  },
];

const CHECKS = [
  'Identidad del vehículo', 'Propietarios', 'SOAT', 'Papeletas y multas', 'Siniestralidad',
  'Orden de captura', 'Revisión técnica', 'Gravámenes', 'Ex-taxi / transporte', 'Análisis con IA',
];

const STEPS = [
  { icon: 'search', t: 'Ingresa la placa', d: 'Solo los dígitos. Sin registros largos.' },
  { icon: 'analytics', t: 'Analizamos las fuentes', d: 'SUNARP, SAT, SBS, MTC y más, en segundos.' },
  { icon: 'description', t: 'Recibe tu reporte', d: 'Semáforo de riesgo y veredicto claro.' },
];

const FEATURES = [
  { icon: 'account_balance', title: 'Fuentes oficiales', desc: 'Datos directos de los registros públicos nacionales.' },
  { icon: 'lock', title: 'Seguridad de datos', desc: 'Cifrado de extremo a extremo y pago protegido.' },
  { icon: 'bolt', title: 'Resultado en 30 seg', desc: 'Consolidación automática, sin esperas ni trámites.' },
  { icon: 'support_agent', title: 'Soporte dedicado', desc: 'Te acompañamos antes y después de tu compra.' },
];

const SOURCES = ['SUNARP', 'SAT', 'SBS', 'MTC', 'SUTRAN', 'ATU', 'APESEG'];

const PLANS = [
  { name: 'Basic', price: 'Gratis', desc: 'Vista general del vehículo por placa.', variant: 'secondary' as const, featured: false, tag: null },
  { name: 'Pro', price: 'S/ 15.90', desc: 'Reporte completo de las fuentes + score de riesgo.', variant: 'primary' as const, featured: false, tag: 'Más popular' },
  { name: 'Ultra', price: 'S/ 19.90', desc: 'Todo + análisis con IA y valor de compra de referencia.', variant: 'accent' as const, featured: true, tag: 'Recomendado' },
];

const RATINGS = [
  ['Google', '4.9'], ['Trustpilot', '4.8'], ['App Store', '4.9'], ['Facebook', '4.7'],
];

const TESTIMONIALS = [
  { name: 'Carlos M.', role: 'Comprador, Lima', text: 'El vendedor juró que el auto estaba limpio. PlacaPe detectó una orden de captura y papeletas pendientes. Me ahorré miles de soles.' },
  { name: 'Ana R.', role: 'Compradora, Lima', text: 'El reporte mostró varios cambios de dueño en pocos meses. Algo no cuadraba. Pasé de largo y encontré algo mejor.' },
  { name: 'Luis P.', role: 'Vendedor, Trujillo', text: 'Ahora muestro el reporte PlacaPe a mis clientes. Genera confianza y cierro ventas más rápido.' },
];

function TrialTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning-bg px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wide text-warning-fg">
      <Icon name="science" className="text-[14px]" /> Trial · marcha blanca
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('');
  return (
    <div className="grid h-10 w-10 flex-none place-items-center rounded-full bg-azul-100 font-heading text-sm font-bold text-primary">
      {initials}
    </div>
  );
}

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
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden bg-background">
        <div
          className="hero-mesh pointer-events-none absolute"
          style={{
            inset: '-12%',
            background:
              'radial-gradient(40% 44% at 50% 80%, rgba(12,111,100,.5), transparent 60%), radial-gradient(48% 60% at 4% 92%, rgba(10,90,82,.55), transparent 60%), radial-gradient(48% 60% at 96% 92%, rgba(10,90,82,.55), transparent 60%), radial-gradient(40% 48% at 84% 70%, rgba(13,120,108,.4), transparent 60%), radial-gradient(40% 48% at 16% 70%, rgba(13,120,108,.4), transparent 60%)',
          }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(rgba(14,27,34,.07) 1px, transparent 1px)',
            backgroundSize: '17px 17px',
            WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,.5), transparent 55%)',
            maskImage: 'linear-gradient(to bottom, rgba(0,0,0,.5), transparent 55%)',
          }}
        />
        <div className="relative mx-auto max-w-[880px] px-6 pb-32 pt-20 text-center sm:px-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-azul-200 bg-white/70 px-3.5 py-1.5 font-mono text-[12.5px] font-semibold uppercase tracking-wide text-primary backdrop-blur">
            <Icon name="verified_user" className="text-[16px] text-teal-600" /> Inspección vehicular oficial
          </span>
          <h1 className="mt-6 font-heading text-[44px] font-extrabold leading-[1.02] tracking-[-0.045em] text-foreground sm:text-[60px]">
            Conoce el historial
            <br />
            antes de comprar
          </h1>
          <p className="mx-auto mt-5 max-w-[560px] font-body text-lg leading-relaxed text-slate-700">
            Consolidamos las fuentes nacionales en un solo reporte de confianza. Papeletas, SOAT,
            siniestros y órdenes de captura en segundos.
          </p>
          <div className="mt-8">
            <HeroSearch />
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-5">
            {TRUST_CHIPS.map(([ic, t]) => (
              <span key={t} className="inline-flex items-center gap-1.5 font-body text-[13.5px] text-slate-600">
                <Icon name={ic} className="text-[16px] text-teal-700" /> {t}
              </span>
            ))}
          </div>
          <div className="mt-6">
            <Link
              href="/reporte/ejemplo"
              className="inline-flex items-center gap-1.5 font-body text-sm font-semibold text-primary hover:underline"
            >
              Ver un reporte de ejemplo <Icon name="arrow_forward" className="text-[16px]" />
            </Link>
          </div>
        </div>
        {/* Placa gigante difuminada */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-12 left-1/2 hidden -translate-x-1/2 select-none opacity-30 sm:block"
        >
          <div className="inline-flex items-stretch overflow-hidden rounded-[30px] border-[6px] border-white/50 bg-white/30">
            <div className="flex flex-col items-center justify-center gap-1.5 bg-azul-700/30 px-6 font-body font-bold text-white/80">
              <span className="text-3xl tracking-wide">PE</span>
              <span className="text-[13px] tracking-[0.14em] opacity-80">PERÚ</span>
            </div>
            <div className="px-8 py-1 font-mono text-[128px] font-bold leading-[1.18] tracking-[0.06em] text-azul-800/40">
              PLACAPE
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Ratings (trial) ---------- */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-center gap-x-7 gap-y-3 px-6 py-6 sm:px-8">
          <TrialTag />
          {RATINGS.map(([name, score]) => (
            <div key={name} className="flex items-center gap-2">
              <Icon name="star" fill className="text-[18px] text-[#F0A91C]" />
              <span className="font-body text-sm text-foreground">
                <strong>{score}</strong> <span className="text-muted">{name}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Soluciones ---------- */}
      <section id="empresas" className="mx-auto max-w-[1180px] px-6 pb-6 pt-20 sm:px-8">
        <div className="mb-11 text-center">
          <p className="mb-2 font-body text-[12.5px] font-bold uppercase tracking-widest text-teal-700">
            Una solución para cada caso
          </p>
          <h2 className="font-heading text-[32px] font-bold tracking-tight text-foreground sm:text-[38px]">
            Pensado para tu decisión
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {SOLUTIONS.map((s) => (
            <div
              key={s.title}
              className="rounded-lg border border-border bg-surface p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-teal-50">
                <Icon name={s.icon} className="text-2xl text-teal-700" />
              </div>
              <h3 className="mb-2 font-heading text-xl font-bold text-foreground">{s.title}</h3>
              <p className="mb-4 font-body text-[15px] leading-relaxed text-muted">{s.desc}</p>
              <div className="flex items-center gap-2 border-t border-border pt-3.5">
                <Icon name="check_circle" fill className="text-[18px] text-success" />
                <span className="font-body text-[13.5px] font-medium text-slate-700">{s.point}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Qué revisamos / cómo funciona ---------- */}
      <section id="como-funciona" className="mx-auto max-w-[1180px] px-6 pt-14 sm:px-8">
        <div className="relative overflow-hidden rounded-2xl bg-azul-950 p-8 sm:p-11">
          <div
            className="pointer-events-none absolute -right-32 -top-52 h-[460px] w-[460px] rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(22,181,163,.22), transparent 64%)' }}
          />
          <div className="relative grid gap-11 md:grid-cols-2 md:items-center">
            <div>
              <p className="mb-2 font-body text-[12.5px] font-bold uppercase tracking-widest text-teal-300">
                Qué revisamos
              </p>
              <h2 className="mb-3.5 font-heading text-[28px] font-bold tracking-tight text-white sm:text-[34px]">
                Todo el historial, en un reporte
              </h2>
              <p className="mb-6 max-w-[420px] font-body text-base leading-relaxed text-azul-200">
                Cruzamos las fuentes nacionales para darte una imagen completa y un veredicto claro
                del vehículo.
              </p>
              <div className="flex flex-wrap gap-2">
                {CHECKS.map((c) => (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-body text-[13px] text-white"
                  >
                    <Icon name="check" className="text-[15px] text-teal-300" /> {c}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {STEPS.map((s) => (
                <div
                  key={s.t}
                  className="flex items-center gap-3.5 rounded-lg border border-white/10 bg-white/5 px-[18px] py-4"
                >
                  <div className="grid h-11 w-11 flex-none place-items-center rounded-xl border border-teal-400/40 bg-teal-400/15">
                    <Icon name={s.icon} className="text-2xl text-teal-300" />
                  </div>
                  <div>
                    <p className="font-heading text-base font-bold text-white">{s.t}</p>
                    <p className="mt-0.5 font-body text-[13.5px] text-azul-200">{s.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Confianza + fuentes ---------- */}
      <section id="fuentes" className="mx-auto max-w-[1180px] px-6 pt-14 sm:px-8">
        <div className="mb-9 text-center">
          <h2 className="font-heading text-[28px] font-bold tracking-tight text-foreground sm:text-[34px]">
            Confianza de nivel institucional
          </h2>
        </div>
        <div className="mb-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-lg border border-border bg-surface p-6 shadow-sm">
              <div className="mb-3.5 grid h-11 w-11 place-items-center rounded-xl bg-azul-50">
                <Icon name={f.icon} className="text-2xl text-primary" />
              </div>
              <h3 className="mb-1.5 font-heading text-[16.5px] font-bold text-foreground">{f.title}</h3>
              <p className="font-body text-[13.5px] leading-normal text-muted">{f.desc}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 rounded-lg border border-border bg-surface px-6 py-5">
          <span className="font-body text-[13px] font-bold uppercase tracking-wide text-slate-400">
            Datos de
          </span>
          {SOURCES.map((s) => (
            <span
              key={s}
              className="rounded-md bg-azul-50 px-2.5 py-1 font-mono text-[12.5px] font-bold tracking-wide text-primary"
            >
              {s}
            </span>
          ))}
        </div>
      </section>

      {/* ---------- Planes ---------- */}
      <section id="planes" className="mx-auto max-w-[1180px] px-6 pt-16 sm:px-8">
        <div className="mb-10 text-center">
          <p className="mb-2 font-body text-[12.5px] font-bold uppercase tracking-widest text-teal-700">
            Sin suscripción · pago por reporte
          </p>
          <h2 className="font-heading text-[32px] font-bold tracking-tight text-foreground sm:text-[38px]">
            Precios claros
          </h2>
        </div>
        <div className="grid items-stretch gap-5 md:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={`relative flex flex-col rounded-xl p-7 ${
                p.featured
                  ? 'border-2 border-teal-500 bg-azul-950 text-white shadow-lg'
                  : 'border border-border bg-surface text-foreground shadow-sm'
              }`}
            >
              {p.tag && (
                <span
                  className={`absolute -top-3 left-7 whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold tracking-wide ${
                    p.featured ? 'bg-teal-500 text-[#042D29]' : 'bg-primary text-white'
                  }`}
                >
                  {p.tag}
                </span>
              )}
              <h3 className={`font-heading text-[22px] font-extrabold ${p.featured ? 'text-white' : 'text-foreground'}`}>
                {p.name}
              </h3>
              <p className={`mb-1 mt-2.5 font-heading text-4xl font-extrabold tracking-tight ${p.featured ? 'text-white' : 'text-foreground'}`}>
                {p.price}
              </p>
              <p className={`mb-5 flex-1 font-body text-sm leading-normal ${p.featured ? 'text-azul-200' : 'text-muted'}`}>
                {p.desc}
              </p>
              <Button variant={p.variant} block size="md" iconRight="arrow_forward" href="/cuenta">
                Elegir {p.name}
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Testimonios (trial) ---------- */}
      <section className="mx-auto max-w-[1180px] px-6 pt-16 sm:px-8">
        <div className="mb-4 flex justify-center">
          <TrialTag />
        </div>
        <div className="mb-11 text-center">
          <h2 className="font-heading text-[28px] font-bold tracking-tight text-foreground sm:text-[34px]">
            Compras protegidas, de verdad
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <div key={t.name} className="rounded-lg border border-border bg-surface p-6 shadow-sm">
              <div className="mb-3 flex gap-0.5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Icon key={i} name="star" fill className="text-[17px] text-[#F0A91C]" />
                ))}
              </div>
              <p className="mb-[18px] font-body text-[15px] leading-relaxed text-slate-700">“{t.text}”</p>
              <div className="flex items-center gap-3">
                <Avatar name={t.name} />
                <div>
                  <p className="font-body text-sm font-bold text-foreground">{t.name}</p>
                  <p className="mt-px font-body text-[13px] text-muted">{t.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- FAQ (SEO) ---------- */}
      <section id="faq" className="mx-auto max-w-3xl px-6 pt-16 sm:px-8">
        <div className="mb-9 text-center">
          <h2 className="font-heading text-[28px] font-bold tracking-tight text-foreground sm:text-[34px]">
            Preguntas frecuentes
          </h2>
        </div>
        <div className="space-y-3">
          {FAQ.map((f) => (
            <details key={f.q} className="rounded-lg border border-border bg-surface p-4 shadow-sm">
              <summary className="cursor-pointer font-body font-semibold text-foreground">{f.q}</summary>
              <p className="mt-2 font-body text-sm text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ---------- CTA final ---------- */}
      <section className="mx-auto mt-16 max-w-[1180px] px-6 sm:px-8">
        <div className="relative overflow-hidden rounded-2xl bg-azul-950 px-6 py-16 text-center">
          <div
            className="pointer-events-none absolute -top-64 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(22,181,163,.26), transparent 62%)' }}
          />
          <div className="relative">
            <h2 className="font-heading text-[34px] font-extrabold tracking-tight text-white sm:text-[42px]">
              Protege tu próxima compra
            </h2>
            <p className="mx-auto mb-7 mt-3.5 max-w-[520px] font-body text-lg text-azul-200">
              Verifica el historial completo de cualquier vehículo antes de cerrar el trato.
            </p>
            <Button variant="accent" size="lg" iconRight="arrow_forward" href="/">
              Verificar un vehículo
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
