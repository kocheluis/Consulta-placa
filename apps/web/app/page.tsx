import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { HeroSearch } from '@/components/HeroSearch';
import { PlanCards } from '@/components/PlanCards';
import { HeroWaves } from '@/components/HeroWaves';

const FAQ = [
  {
    q: '¿Cómo consultar una placa en Perú?',
    a: 'Ingresa el número de placa y verifica. Consolidamos datos de los portales oficiales (SUNARP, SAT, SBS, MTC) en un solo reporte.',
  },
  {
    q: '¿La consulta de placa es gratis?',
    a: 'El reporte Básico es gratuito. El reporte Completo (todas las fuentes, análisis con IA y valorización) cuesta S/ 9.90 por placa, y tu primer reporte Completo es gratis al crear tu cuenta. Si revisas varios autos, hay paquetes mensuales de 20 y 50 consultas.',
  },
  {
    q: '¿Cómo saber si un vehículo tiene papeletas?',
    a: 'Con la placa revisamos las papeletas de los SAT de Lima, Callao, Trujillo, Piura, Chiclayo, Cajamarca y Arequipa, y te mostramos el resultado de cada uno.',
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

const SOLUTIONS = [
  {
    icon: 'person',
    title: 'Si vas a comprar',
    desc: 'Revisa el auto antes de pagar: deudas, prendas, siniestros y cuántos dueños tuvo.',
    point: 'Score de 0 a 100 con lo que conviene revisar',
  },
  {
    icon: 'sell',
    title: 'Si vas a vender',
    desc: 'Comparte el reporte con quien esté interesado. Le ahorras la duda y a ti, tiempo.',
    point: 'Descárgalo en PDF o envíalo por correo',
  },
  {
    icon: 'storefront',
    title: 'Si revisas muchos autos',
    desc: 'Concesionarias, talleres y compraventas que consultan varias placas al mes.',
    point: 'Paquetes de 20 y 50 consultas',
  },
];

const CHECKS = [
  'Identidad del vehículo', 'Propietarios', 'SOAT', 'Papeletas y multas', 'Siniestralidad',
  'Orden de captura', 'Revisión técnica', 'Gravámenes', 'Ex-taxi / transporte', 'Análisis con IA',
];

const STEPS = [
  { icon: 'search', t: 'Escribe la placa', d: 'De cualquier auto, camioneta o moto.' },
  { icon: 'analytics', t: 'Consultamos por ti', d: 'SUNARP, los SAT, la SBS, el MTC y más.' },
  { icon: 'description', t: 'Lee el reporte', d: 'Con un score y lo que conviene revisar.' },
];

const FEATURES = [
  { icon: 'account_balance', title: 'Fuentes públicas', desc: 'Cada dato indica de qué portal salió, para que lo puedas comprobar.' },
  { icon: 'lock', title: 'Datos de terceros protegidos', desc: 'Ocultamos parte de los nombres y documentos de otras personas.' },
  { icon: 'mail', title: 'Te avisamos', desc: 'Si el reporte tarda unos minutos, te escribimos cuando esté listo.' },
  { icon: 'support_agent', title: 'Personas reales', desc: 'Si algo no cuadra en tu reporte, lo revisamos contigo.' },
];

// Solo fuentes que el motor REALMENTE consulta (SUTRAN/ONPE NO se scrapean; aparecen únicamente
// como enlaces sugeridos en /portales). SIGM/FISE/Infogas/Callao también son reales.
const SOURCES = ['SUNARP', 'SAT', 'SBS', 'MTC', 'APESEG', 'ATU', 'FISE'];


// Testimonios de personas reales que solicitaron su reporte durante la marcha blanca (corridas
// atendidas por nosotros a pedido). Feedback real: los reportes fueron útiles y revelaron papeletas
// o avisos de cambio de motor que el solicitante no conocía. Sin plataformas externas inventadas.
const TESTIMONIALS = [
  { name: 'Christopher V.', role: 'Solicitó su reporte', text: 'Pedí el reporte de una camioneta antes de comprarla. Tenía varias papeletas que el vendedor no mencionó. Renegocié con eso en la mano.' },
  { name: 'Laura B.', role: 'Solicitó su reporte', text: 'El reporte marcó un aviso de cambio de motor que no coincidía con SUNARP. Por mi cuenta jamás lo habría notado.' },
  { name: 'Jose S.', role: 'Solicitó su reporte', text: 'Muy útil: en minutos vi SOAT, revisión técnica y multas juntas. Me evitó ir portal por portal.' },
  { name: 'Gerardo C.', role: 'Solicitó su reporte', text: 'Le muestro el reporte limpio a los interesados en mi auto y genero confianza. Cierro la venta más rápido.' },
];

// Ejemplos ILUSTRATIVOS de hallazgos que el reporte revela (renderizados con nuestro diseño, no
// capturas de clientes). Casos que más impactan a un comprador: cambio de motor, prenda, papeletas, etc.
const SPECIAL_CASES: { icon: string; sev: 'alert' | 'warn'; tag: string; title: string; desc: string; source: string }[] = [
  { icon: 'car_crash', sev: 'alert', tag: 'Siniestro', title: 'Pérdida total por siniestro', desc: 'Una aseguradora (Rímac, Pacífico, Mapfre, La Positiva, Qualitas…) figura como parte en el historial: el vehículo fue declarado pérdida total.', source: 'SUNARP · SPRL' },
  { icon: 'build', sev: 'alert', tag: 'Motor', title: 'Cambio de motor no inscrito', desc: 'El N.º de motor no coincide con el registrado en SUNARP: posible cambio sin inscribir.', source: 'SUNARP' },
  { icon: 'gavel', sev: 'alert', tag: 'Gravamen', title: 'Vehículo prendado', desc: 'Tiene una garantía mobiliaria vigente a favor de un banco o financiera.', source: 'SUNARP · SIGM' },
  { icon: 'receipt_long', sev: 'alert', tag: 'Multas', title: 'Papeletas acumuladas', desc: 'Varias papeletas pendientes en los SAT de Lima, Callao y provincias.', source: 'SAT' },
  { icon: 'block', sev: 'alert', tag: 'Captura', title: 'Orden de captura activa', desc: 'El SAT reporta orden de captura o internamiento por deuda impaga.', source: 'SAT' },
  { icon: 'local_gas_station', sev: 'warn', tag: 'GNV', title: 'Crédito de conversión GNV pendiente', desc: 'Deuda del crédito de conversión a gas (FISE) que no ha sido cancelada.', source: 'FISE' },
];

// Cifras REALES del cierre de la marcha blanca (26-jun → 7-nov-2026), calculadas por `placape-ops stats`
// sobre los 158 reportes publicados (1 por vehículo, su última generación). Congeladas a esa fecha: si se
// actualizan, recalcular con el mismo comando y cambiar la fecha de corte.
const MARCHA_BLANCA = {
  corte: '7 de noviembre de 2026',
  stats: [
    { value: '158', label: 'vehículos analizados', icon: 'directions_car' },
    { value: '45%', label: 'registraban accidentes SOAT o un siniestro', icon: 'car_crash' },
    { value: '15%', label: 'tenían un gravamen o prenda vigente', icon: 'gavel' },
    { value: '10%', label: 'tenían papeletas pendientes', icon: 'receipt_long' },
  ],
};

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
              'radial-gradient(40% 44% at 50% 80%, rgba(12,111,100,.3), transparent 60%), radial-gradient(48% 60% at 4% 92%, rgba(10,90,82,.34), transparent 60%), radial-gradient(48% 60% at 96% 92%, rgba(10,90,82,.34), transparent 60%), radial-gradient(40% 48% at 84% 70%, rgba(13,120,108,.24), transparent 60%), radial-gradient(40% 48% at 16% 70%, rgba(13,120,108,.24), transparent 60%)',
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
        <HeroWaves />
        <div className="relative mx-auto max-w-[880px] px-6 pb-32 pt-16 text-center sm:px-8 sm:pt-24">
          <h1 className="text-balance font-heading text-[clamp(2.4rem,10.4vw,2.75rem)] font-extrabold leading-[1.02] tracking-[-0.045em] text-foreground sm:text-[60px]">
            Conoce el historial{" "}
            <br className="hidden sm:block" />
            antes de comprar
          </h1>
          <p className="mx-auto mt-5 max-w-[520px] font-body text-lg leading-relaxed text-slate-700">
            Escribe la placa y revisa papeletas, SOAT, siniestros, prendas y órdenes de captura en un solo reporte.
          </p>
          <div className="mt-8">
            <HeroSearch />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-body text-[15px]">
            <span className="text-slate-600">El reporte básico es gratis.</span>
            <Link href="/reporte/ejemplo" className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline">
              Ver un ejemplo <Icon name="chevron_right" className="text-[18px]" />
            </Link>
          </div>
        </div>
      </section>

      {/* ---------- Resultados de la marcha blanca (cifras reales) ---------- */}
      <section className="border-b border-border bg-surface">
        <div className="mx-auto max-w-[1180px] px-6 py-8 sm:px-8">
          <p className="mb-5 text-center font-body text-[12.5px] font-bold uppercase tracking-widest text-teal-700">
            Lo que encontramos en nuestra marcha blanca
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
            {MARCHA_BLANCA.stats.map((s) => (
              <div key={s.label} className="flex items-start gap-3">
                <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-azul-50">
                  <Icon name={s.icon} className="text-[22px] text-primary" />
                </div>
                <div>
                  <p className="font-heading text-[28px] font-extrabold leading-none tracking-tight text-foreground tabular-nums">
                    {s.value}
                  </p>
                  <p className="mt-1 font-body text-[13.5px] leading-snug text-muted">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-5 text-center font-body text-[12px] text-slate-500">
            Sobre los reportes generados del 26 de junio al {MARCHA_BLANCA.corte}. Cada vehículo se cuenta una vez.
          </p>
        </div>
      </section>

      {/* ---------- Soluciones ---------- */}
      <section id="empresas" className="mx-auto max-w-[1180px] px-6 pb-6 pt-20 sm:px-8">
        <div className="mb-11 text-center">
          <h2 className="font-heading text-[32px] font-bold tracking-tight text-foreground sm:text-[38px]">
            ¿Compras, vendes o revisas flotas?
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
                Lo que hoy te tomaría una tarde entrando portal por portal.
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
            Cómo trabajamos
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

      {/* ---------- Casos especiales (ejemplos ilustrativos) ---------- */}
      <section className="mx-auto max-w-[1180px] px-6 pt-16 sm:px-8">
        <div className="mb-9 text-center">
          <h2 className="font-heading text-[28px] font-bold tracking-tight text-foreground sm:text-[34px]">
            Lo que hemos encontrado
          </h2>
          <p className="mx-auto mt-2 max-w-[560px] font-body text-[15px] leading-relaxed text-muted">
            Situaciones que aparecieron en reportes reales. Ninguna se ve a simple vista.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SPECIAL_CASES.map((c) => {
            const alert = c.sev === 'alert';
            return (
              <div
                key={c.title}
                className={`flex gap-3.5 rounded-lg border bg-surface p-5 shadow-sm ${alert ? 'border-danger/30' : 'border-warning/40'}`}
              >
                <div
                  className={`grid h-11 w-11 flex-none place-items-center rounded-xl ${alert ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning-fg'}`}
                >
                  <Icon name={c.icon} className="text-2xl" />
                </div>
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-wide ${alert ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning-fg'}`}
                    >
                      {c.tag}
                    </span>
                    <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {c.source}
                    </span>
                  </div>
                  <h3 className="font-heading text-[16px] font-bold text-foreground">{c.title}</h3>
                  <p className="mt-1 font-body text-[13.5px] leading-normal text-muted">{c.desc}</p>
                </div>
              </div>
            );
          })}
          <div className="flex flex-col justify-center rounded-lg border border-dashed border-border bg-background p-5">
            <p className="font-heading text-[16px] font-bold text-foreground">Revisa una placa</p>
            <p className="mt-1 mb-3 font-body text-[13.5px] leading-normal text-muted">
              El reporte básico es gratis.
            </p>
            <Button variant="accent" size="sm" iconRight="arrow_forward" href="/">
              Verificar placa
            </Button>
          </div>
        </div>
      </section>

      {/* ---------- Planes ---------- */}
      <section id="planes" className="mx-auto max-w-[1180px] px-6 pt-16 sm:px-8">
        <div className="mb-10 text-center">
          <h2 className="font-heading text-[32px] font-bold tracking-tight text-foreground sm:text-[38px]">
            Cuánto cuesta
          </h2>
          <p className="mx-auto mt-2 max-w-[520px] font-body text-[15px] leading-relaxed text-muted">
            Por placa o con un paquete mensual.
          </p>
        </div>
        <PlanCards />
      </section>

      {/* ---------- Testimonios ---------- */}
      <section className="mx-auto max-w-[1180px] px-6 pt-16 sm:px-8">
        <div className="mb-11 text-center">
          <h2 className="font-heading text-[28px] font-bold tracking-tight text-foreground sm:text-[34px]">
            Lo que nos contaron
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TESTIMONIALS.map((t) => (
            <div key={t.name} className="rounded-lg border border-border bg-surface p-6 shadow-sm">
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
            <details key={f.q} className="pp-acc group rounded-lg border border-border bg-surface p-4 shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-body font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                {f.q}
                <Icon name="expand_more" className="text-[22px] text-muted transition-transform duration-[380ms] ease-[cubic-bezier(0.32,0.72,0,1)] group-open:rotate-180" />
              </summary>
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
              Antes de pagar, revisa la placa
            </h2>
            <p className="mx-auto mb-7 mt-3.5 max-w-[520px] font-body text-lg text-azul-200">
              El reporte básico es gratis y sale en segundos.
            </p>
            <Button variant="accent" size="lg" iconRight="arrow_forward" href="/">
              Revisar una placa
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
