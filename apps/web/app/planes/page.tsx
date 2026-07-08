'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Icon } from '@/components/ui/Icon';

/* ───────────────────────── Datos ───────────────────────── */
type PlanId = 'basic' | 'pro' | 'ultra';

const PLANS: Record<
  PlanId,
  { name: string; priceLabel: string; price: number; blurb: string; tag?: string; save?: string }
> = {
  basic: { name: 'Basic', price: 0, priceLabel: 'Gratis', blurb: 'Lo esencial para una primera mirada.' },
  pro: {
    name: 'Pro',
    price: 15.9,
    priceLabel: 'S/ 15.90',
    blurb: 'El reporte completo de 10 fuentes nacionales.',
    tag: 'Más popular',
  },
  ultra: {
    name: 'Ultra',
    price: 19.9,
    priceLabel: 'S/ 19.90',
    blurb: 'La decisión completa: análisis con IA y valorización de mercado. Solo S/ 4 más que Pro.',
    tag: 'Recomendado',
    save: 'Reemplaza un peritaje de S/ 150+',
  },
};

const FEATURES: { label: string; plans: PlanId[] }[] = [
  { label: 'Identidad del vehículo', plans: ['basic', 'pro', 'ultra'] },
  { label: 'Semáforo de riesgo', plans: ['basic', 'pro', 'ultra'] },
  { label: 'N° de propietarios', plans: ['basic', 'pro', 'ultra'] },
  { label: 'Historial de propietarios', plans: ['pro', 'ultra'] },
  { label: 'SOAT (APESEG)', plans: ['pro', 'ultra'] },
  { label: 'Papeletas y multas (SAT)', plans: ['pro', 'ultra'] },
  { label: 'Revisión técnica (MTC)', plans: ['pro', 'ultra'] },
  { label: 'Siniestralidad (SBS)', plans: ['pro', 'ultra'] },
  { label: 'Orden de captura (SAT)', plans: ['pro', 'ultra'] },
  { label: 'Descarga en PDF', plans: ['pro', 'ultra'] },
  { label: 'Gravámenes (SBS)', plans: ['ultra'] },
  { label: 'Multas electorales (ONPE)', plans: ['ultra'] },
  { label: 'Valorización de mercado', plans: ['ultra'] },
  { label: 'Análisis con IA', plans: ['ultra'] },
  { label: 'Alertas de vencimiento', plans: ['ultra'] },
];

const money = (n: number) =>
  'S/ ' + n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ───────────────────────── Plan cards ───────────────────────── */
function PlanCard({ id, onChoose }: { id: PlanId; onChoose: (p: PlanId) => void }) {
  const p = PLANS[id];
  const featured = id === 'ultra';
  const top = FEATURES.filter((f) => f.plans.includes(id)).slice(0, id === 'basic' ? 3 : 6);

  const border = featured
    ? 'border-2 border-azul-700 shadow-xl md:-mt-3.5'
    : id === 'pro'
      ? 'border-[1.5px] border-teal-300 shadow-sm'
      : 'border border-border shadow-sm';

  return (
    <div
      className={`relative flex flex-col rounded-xl bg-surface ${border} ${featured ? 'p-8' : 'p-6'}`}
      style={featured ? { background: 'linear-gradient(180deg, #EFF6F9, #FFFFFF 130px)' } : undefined}
    >
      {p.tag && (
        <span
          className={`absolute -top-3 left-6 whitespace-nowrap rounded-full px-3 py-[5px] font-body text-xs font-bold tracking-wide ${
            featured ? 'bg-azul-700 text-white' : 'bg-teal-500 text-[#042D29]'
          }`}
        >
          {p.tag}
        </span>
      )}
      <div className="flex items-center gap-2">
        <h3 className="font-heading text-[22px] font-extrabold text-foreground">{p.name}</h3>
        {featured && <Icon name="bolt" fill className="text-[20px] text-teal-600" />}
      </div>
      <div className="mb-1 mt-3 flex items-baseline gap-1.5">
        <span className="font-heading text-[38px] font-extrabold tracking-tight text-foreground">
          {p.priceLabel}
        </span>
        {p.price > 0 && <span className="text-sm text-muted">/ reporte</span>}
      </div>
      <p className="mb-4 min-h-[60px] text-sm leading-normal text-muted">{p.blurb}</p>
      {p.save && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2.5">
          <Icon name="savings" className="text-[18px] text-teal-700" />
          <span className="text-[12.5px] font-semibold leading-snug text-azul-800">{p.save}</span>
        </div>
      )}
      <Button
        variant={featured ? 'accent' : id === 'pro' ? 'primary' : 'secondary'}
        size={featured ? 'lg' : 'md'}
        block
        iconRight={id === 'basic' ? undefined : 'arrow_forward'}
        onClick={() => onChoose(id)}
      >
        {id === 'basic' ? 'Empezar gratis' : `Elegir ${p.name}`}
      </Button>
      <div className="mt-4 flex flex-col gap-2.5">
        {top.map((f) => (
          <div key={f.label} className="flex items-center gap-2 text-sm text-foreground">
            <Icon name="check_circle" fill className="text-[18px] text-success" />
            {f.label}
          </div>
        ))}
        {id !== 'basic' && <span className="pl-[26px] text-[13px] text-slate-400">y más…</span>}
      </div>
    </div>
  );
}

function SectionHead({ kicker, title, sub }: { kicker?: string; title: string; sub?: string }) {
  return (
    <div className="mb-7 text-center">
      {kicker && (
        <p className="mb-1.5 font-body text-xs font-bold uppercase tracking-[0.1em] text-teal-700">
          {kicker}
        </p>
      )}
      <h2 className="font-heading text-[28px] font-bold tracking-tight text-foreground">{title}</h2>
      {sub && <p className="mx-auto mt-2.5 max-w-xl text-base leading-relaxed text-muted">{sub}</p>}
    </div>
  );
}

/* ───────────────────────── Referencia de mercado ───────────────────────── */
function MarketCompare({ onChoose }: { onChoose: (p: PlanId) => void }) {
  const items: [string, string][] = [
    ['Búsqueda vehicular SUNARP', 'S/ 23'],
    ['Récord de papeletas (SAT)', 'S/ 15'],
    ['Peritaje mecánico presencial', 'S/ 150'],
    ['Tasación comercial', 'S/ 80'],
  ];
  return (
    <section className="mb-16">
      <SectionHead
        kicker="Referencia de mercado"
        title="Lo mismo, por una fracción del precio"
        sub="Reunir esta información por tu cuenta cuesta tiempo y dinero. Ultra lo consolida en un reporte, en segundos."
      />
      <div className="grid items-center gap-4 md:grid-cols-[1fr_56px_1fr]">
        <Card elevation="sm" padded>
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">
            Haciéndolo por separado
          </p>
          {items.map(([k, v]) => (
            <div
              key={k}
              className="flex items-center justify-between border-b border-border py-2.5"
            >
              <span className="text-sm text-foreground">{k}</span>
              <span className="font-mono text-sm font-semibold text-muted">{v}</span>
            </div>
          ))}
          <div className="flex items-baseline justify-between pt-3">
            <span className="text-[15px] font-bold text-foreground">Total aprox.</span>
            <span className="font-heading text-2xl font-extrabold text-muted line-through">S/ 268</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">+ varios días de trámites</p>
        </Card>
        <div className="grid place-items-center">
          <div className="grid h-11 w-11 place-items-center rounded-full border border-border bg-surface font-heading text-[13px] font-extrabold text-muted shadow-sm">
            VS
          </div>
        </div>
        <div
          className="rounded-xl p-6 text-white shadow-lg"
          style={{ background: 'linear-gradient(160deg, #103D52, #0C6F64)' }}
        >
          <Badge tone="brand" size="sm" icon="bolt">
            Ultra
          </Badge>
          <p className="mb-0.5 mt-3 font-heading text-[17px] font-extrabold">PlacaPe Ultra</p>
          <div className="flex items-baseline gap-2">
            <span className="font-heading text-[40px] font-extrabold tracking-tight">S/ 19.90</span>
            <span className="text-sm text-teal-100">todo incluido</span>
          </div>
          <p className="mb-4 mt-1.5 text-sm leading-normal text-teal-100">
            Un solo reporte, 10 fuentes + IA y valorización. En segundos.
          </p>
          <span className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-bold">
            <Icon name="trending_down" className="text-[16px] text-teal-300" /> Ahorras más del 90%
          </span>
          <Button variant="accent" block iconRight="arrow_forward" onClick={() => onChoose('ultra')}>
            Obtener Ultra
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Casos de uso ───────────────────────── */
function UseCases({ onChoose, scrollToPacks }: { onChoose: (p: PlanId) => void; scrollToPacks: () => void }) {
  const cases: {
    icon: string;
    title: string;
    who: string;
    plan: PlanId | 'pack';
    rec: string;
  }[] = [
    {
      icon: 'person',
      title: 'Para uso personal',
      who: 'Compras tu próximo auto y quieres cerrar el trato tranquilo, sin sorpresas.',
      plan: 'pro',
      rec: 'Pro',
    },
    {
      icon: 'verified_user',
      title: 'Primera compra o auto importado',
      who: 'Necesitas la máxima certeza: análisis con IA, valorización e historial completo.',
      plan: 'ultra',
      rec: 'Ultra',
    },
    {
      icon: 'storefront',
      title: 'Negocio o concesionaria',
      who: 'Verificas muchos vehículos al mes y quieres precio por volumen y alertas de flota.',
      plan: 'pack',
      rec: 'Plan Negocio',
    },
  ];
  return (
    <section className="mb-16">
      <SectionHead kicker="Recomendación de compra" title="¿Cuál plan te conviene?" sub="Elige según para qué vas a usar el reporte." />
      <div className="grid gap-[18px] md:grid-cols-3">
        {cases.map((c) => {
          const isUltra = c.plan === 'ultra';
          return (
            <Card key={c.title} elevation="sm" padded>
              <div
                className={`mb-3.5 grid h-12 w-12 place-items-center rounded-md ${
                  isUltra ? 'bg-azul-50' : 'bg-teal-50'
                }`}
              >
                <Icon name={c.icon} className={`text-[26px] ${isUltra ? 'text-primary' : 'text-teal-700'}`} />
              </div>
              <h3 className="mb-1.5 font-heading text-lg font-bold text-foreground">{c.title}</h3>
              <p className="mb-4 min-h-[66px] text-sm leading-relaxed text-muted">{c.who}</p>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[13px] text-muted">
                  Recomendado:
                  <Badge
                    tone={c.plan === 'ultra' ? 'brand' : c.plan === 'pro' ? 'info' : 'neutral'}
                    size="sm"
                    icon={c.plan === 'ultra' ? 'bolt' : null}
                  >
                    {c.rec}
                  </Badge>
                </span>
                {c.plan === 'pack' ? (
                  <Button variant="ghost" size="sm" iconRight="south" onClick={scrollToPacks}>
                    Packs
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" iconRight="arrow_forward" onClick={() => onChoose(c.plan as PlanId)}>
                    Elegir
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

/* ───────────────────────── Packs por volumen ───────────────────────── */
const VOLUME_BY_PLAN: Record<'pro' | 'ultra', { qty: number; unit: number; total: number; label: string; tag: string; feat: boolean }[]> = {
  pro: [
    { qty: 10, unit: 11.9, total: 119, label: 'Pack Inicial', tag: 'Mínimo', feat: false },
    { qty: 25, unit: 10.9, total: 273, label: 'Pack Negocio', tag: 'Más elegido', feat: true },
    { qty: 50, unit: 9.9, total: 495, label: 'Pack Flota', tag: 'Mejor precio', feat: false },
  ],
  ultra: [
    { qty: 10, unit: 14.9, total: 149, label: 'Pack Inicial', tag: 'Mínimo', feat: false },
    { qty: 25, unit: 13.9, total: 347, label: 'Pack Negocio', tag: 'Más elegido', feat: true },
    { qty: 50, unit: 12.9, total: 645, label: 'Pack Flota', tag: 'Mejor precio', feat: false },
  ],
};

function Packs({ onChoose, packsRef }: { onChoose: (p: PlanId) => void; packsRef: React.Ref<HTMLElement> }) {
  const [packPlan, setPackPlan] = useState<'pro' | 'ultra'>('ultra');
  const tiers = VOLUME_BY_PLAN[packPlan];
  const buyer = [
    { name: 'Reporte único', price: 'Desde Gratis', desc: 'Una consulta cuando la necesitas — Basic, Pro o Ultra.', cta: 'Elegir plan', feat: false },
    { name: 'Pack Comprador', price: 'S/ 49', old: 'S/ 59.70', desc: '3 reportes Ultra para comparar varios autos antes de decidir.', cta: 'Comprar pack', tag: 'Ahorra 18%', feat: true },
  ];
  return (
    <section ref={packsRef} className="mb-16 scroll-mt-24">
      <SectionHead
        kicker="Sugerencias de compra"
        title="Paquetes para cada necesidad"
        sub="Compra suelta para tu auto, o por volumen si verificas varios. Precios referenciales de lanzamiento."
      />

      <div className="mb-4 grid gap-[18px] sm:grid-cols-2">
        {buyer.map((b) => (
          <div
            key={b.name}
            className={`relative flex flex-col rounded-xl bg-surface p-6 ${
              b.feat ? 'border-2 border-teal-500 shadow-md' : 'border border-border shadow-sm'
            }`}
          >
            {b.tag && (
              <span className="absolute -top-2.5 right-5 whitespace-nowrap rounded-full bg-teal-500 px-2.5 py-1 text-[11px] font-bold tracking-wide text-[#042D29]">
                {b.tag}
              </span>
            )}
            <h3 className="mb-2 font-heading text-lg font-bold text-foreground">{b.name}</h3>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="font-heading text-3xl font-extrabold tracking-tight text-foreground">{b.price}</span>
              {b.old && <span className="text-[15px] text-slate-400 line-through">{b.old}</span>}
            </div>
            <p className="mb-4 flex-1 text-sm leading-relaxed text-muted">{b.desc}</p>
            <Button variant={b.feat ? 'accent' : 'secondary'} block iconRight="arrow_forward" onClick={() => onChoose('ultra')}>
              {b.cta}
            </Button>
          </div>
        ))}
      </div>

      {/* Plan Negocio por volumen */}
      <div
        className="rounded-2xl p-7 text-white"
        style={{ background: 'linear-gradient(165deg, #0A2E3D, #06222E)' }}
      >
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <Icon name="storefront" className="text-[22px] text-teal-300" />
              <h3 className="font-heading text-[22px] font-extrabold tracking-tight">Plan Negocio · packs por volumen</h3>
            </div>
            <p className="mt-2 max-w-xl text-[14.5px] leading-relaxed text-azul-200">
              Para concesionarias y talleres. Compra <strong className="text-white">desde 10 reportes</strong> y el
              precio por consulta baja mientras más adquieres — hasta{' '}
              <strong className="text-teal-300">{money(tiers[2].unit)} c/u</strong>. Reportes{' '}
              <strong className="text-white">{packPlan === 'ultra' ? 'Ultra' : 'Pro'}</strong>, válidos por 12 meses.
            </p>
            <div className="mt-4 inline-flex gap-0.5 rounded-full bg-white/10 p-1">
              {(['pro', 'ultra'] as const).map((pl) => {
                const on = pl === packPlan;
                return (
                  <button
                    key={pl}
                    onClick={() => setPackPlan(pl)}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full px-5 py-2 font-body text-[13.5px] font-bold transition-colors ${
                      on ? 'bg-white text-primary' : 'text-azul-200 hover:text-white'
                    }`}
                  >
                    {pl === 'ultra' && <Icon name="bolt" fill={on} className={`text-[15px] ${on ? 'text-teal-600' : 'text-azul-200'}`} />}
                    Packs {pl === 'ultra' ? 'Ultra' : 'Pro'}
                  </button>
                );
              })}
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-400/40 bg-teal-400/15 px-3 py-1.5 text-[13px] font-bold text-teal-300">
            <Icon name="savings" className="text-[16px]" /> Hasta −35% por reporte
          </span>
        </div>

        <div className="grid gap-3.5 md:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.qty}
              className={`relative rounded-xl p-5 ${
                t.feat ? 'border-2 border-teal-400 bg-surface text-foreground' : 'border border-white/10 bg-white/5 text-white'
              }`}
            >
              <span
                className={`absolute -top-2.5 left-5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${
                  t.feat ? 'bg-teal-400 text-[#042D29]' : 'bg-white/15 text-white'
                }`}
              >
                {t.tag}
              </span>
              <p className={`mt-1 font-heading text-base font-bold ${t.feat ? 'text-foreground' : 'text-white'}`}>{t.label}</p>
              <div className="mb-0.5 mt-2.5 flex items-baseline gap-1.5">
                <span className="font-heading text-[32px] font-extrabold tracking-tight">{money(t.unit)}</span>
                <span className={`text-[13px] ${t.feat ? 'text-muted' : 'text-azul-200'}`}>/ reporte</span>
              </div>
              <p className={`mb-4 text-[13.5px] ${t.feat ? 'text-muted' : 'text-azul-200'}`}>
                {t.qty} reportes · total{' '}
                <strong className={t.feat ? 'text-foreground' : 'text-white'}>{money(t.total)}</strong>
              </p>
              <Button variant={t.feat ? 'accent' : 'secondary'} block iconRight="arrow_forward" onClick={() => onChoose(packPlan)}>
                Comprar {t.qty}
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-4 flex items-center gap-1.5 text-[13px] text-azul-300">
          <Icon name="info" className="text-[16px]" /> ¿Necesitas más de 50 al mes?
          <a href="mailto:ventas@placape.pe" className="ml-0.5 font-semibold text-teal-300 hover:underline">
            Habla con ventas
          </a>{' '}
          para un precio a medida.
        </p>
      </div>
    </section>
  );
}

/* ───────────────────────── Tabla comparativa ───────────────────────── */
function CompareTable({ onChoose }: { onChoose: (p: PlanId) => void }) {
  const ids: PlanId[] = ['basic', 'pro', 'ultra'];
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
      <table className="w-full border-collapse font-body">
        <thead>
          <tr className="bg-background">
            <th className="px-5 py-4 text-left text-[13px] font-bold uppercase tracking-wide text-muted">Incluye</th>
            {ids.map((id) => (
              <th key={id} className="min-w-[110px] px-2 py-3.5">
                <div className="font-heading text-[17px] font-extrabold text-foreground">{PLANS[id].name}</div>
                <div className="text-[13px] font-semibold text-muted">{PLANS[id].priceLabel}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {FEATURES.map((f) => (
            <tr key={f.label}>
              <td className="border-b border-border px-5 py-2.5 text-left text-sm text-foreground">{f.label}</td>
              {ids.map((id) => (
                <td key={id} className="border-b border-border px-2 py-2.5 text-center">
                  {f.plans.includes(id) ? (
                    <Icon name="check" className="text-[20px] text-success" />
                  ) : (
                    <Icon name="remove" className="text-[18px] text-slate-300" />
                  )}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td className="px-5 py-4" />
            {ids.map((id) => (
              <td key={id} className="px-2 py-4 text-center">
                <Button
                  variant={id === 'pro' ? 'accent' : id === 'ultra' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => onChoose(id)}
                >
                  {id === 'basic' ? 'Gratis' : 'Elegir'}
                </Button>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function PlanesView({ onChoose }: { onChoose: (p: PlanId) => void }) {
  const packsRef = useRef<HTMLElement>(null);
  const scrollToPacks = () => packsRef.current?.scrollIntoView({ behavior: 'smooth' });
  return (
    <div className="mx-auto max-w-[1080px] px-5 py-14 sm:px-8">
      <div className="mb-11 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-azul-200 bg-azul-50 px-3.5 py-1.5 text-[13px] font-semibold text-azul-700">
          <Icon name="sell" className="text-[16px] text-teal-600" /> Paga solo por el reporte que necesitas
        </span>
        <h1 className="mt-4 font-heading text-[42px] font-extrabold tracking-tight text-foreground">Elige tu plan</h1>
        <p className="mt-3 text-[17px] text-muted">Sin suscripción. Un pago por consulta. Acceso inmediato.</p>
      </div>

      <div className="mb-16 grid items-start gap-5 pt-4 md:grid-cols-3">
        <PlanCard id="basic" onChoose={onChoose} />
        <PlanCard id="pro" onChoose={onChoose} />
        <PlanCard id="ultra" onChoose={onChoose} />
      </div>

      <MarketCompare onChoose={onChoose} />
      <UseCases onChoose={onChoose} scrollToPacks={scrollToPacks} />
      <Packs onChoose={onChoose} packsRef={packsRef} />

      <h2 className="mb-6 text-center font-heading text-2xl font-bold tracking-tight text-foreground">
        Compara los 3 modelos
      </h2>
      <CompareTable onChoose={onChoose} />
    </div>
  );
}

/* ───────────────────────── Checkout ───────────────────────── */
function MethodTab({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 cursor-pointer flex-col items-center gap-1.5 rounded-md px-3 py-3.5 font-body text-sm font-semibold transition-colors ${
        active ? 'border-2 border-accent bg-teal-50 text-primary' : 'border-[1.5px] border-border bg-surface text-foreground'
      }`}
    >
      <Icon name={icon} className={`text-[24px] ${active ? 'text-teal-700' : 'text-muted'}`} />
      {label}
    </button>
  );
}

function CheckoutView({ planId, onBack, onPay }: { planId: PlanId; onBack: () => void; onPay: (p: PlanId) => void }) {
  const p = PLANS[planId];
  const [method, setMethod] = useState<'yape' | 'card'>('yape');
  return (
    <div className="mx-auto max-w-[980px] px-5 py-10 sm:px-8">
      <button
        onClick={onBack}
        className="mb-4 inline-flex cursor-pointer items-center gap-1.5 font-body text-sm font-semibold text-muted hover:text-foreground"
      >
        <Icon name="arrow_back" className="text-[18px]" /> Volver a planes
      </button>

      {/* Aviso de integridad: pasarela aún no operativa */}
      <div className="mb-6 flex items-start gap-2.5 rounded-md border border-warning/30 bg-warning-bg px-4 py-3" role="status">
        <Icon name="info" className="mt-0.5 text-[18px] text-warning-fg" />
        <p className="text-[13.5px] leading-snug text-warning-fg">
          <strong>Vista previa.</strong> La pasarela de pago (IziPay / Yape) está en integración; todavía{' '}
          <strong>no se procesan cobros reales</strong>. Esta pantalla muestra cómo funcionará el flujo.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* método de pago */}
        <div>
          <h2 className="mb-4 font-heading text-2xl font-bold text-foreground">Método de pago</h2>
          <div className="mb-5 flex gap-2.5">
            <MethodTab active={method === 'yape'} icon="smartphone" label="Yape" onClick={() => setMethod('yape')} />
            <MethodTab active={method === 'card'} icon="credit_card" label="Tarjeta" onClick={() => setMethod('card')} />
          </div>

          {method === 'yape' ? (
            <Card elevation="sm" padded>
              <div className="flex items-center gap-5">
                <div className="grid h-[132px] w-[132px] flex-none place-items-center rounded-md border-[1.5px] border-border bg-white">
                  <Icon name="qr_code_2" className="text-[104px] text-azul-900 opacity-40" />
                </div>
                <div>
                  <p className="font-bold text-foreground">Pago con Yape / Plin</p>
                  <p className="my-1.5 text-sm leading-normal text-muted">
                    Al activar la pasarela verás aquí el código QR para pagar <strong>{p.priceLabel}</strong> y
                    confirmar al instante.
                  </p>
                  <p className="text-[13px] text-slate-400">Disponible al activar pagos (en integración).</p>
                </div>
              </div>
            </Card>
          ) : (
            <Card elevation="sm" padded>
              <div className="flex flex-col gap-3.5">
                <Input label="Número de tarjeta" icon="credit_card" placeholder="4242 4242 4242 4242" inputMode="numeric" disabled />
                <div className="flex gap-3">
                  <Input label="Vencimiento" placeholder="MM / AA" className="flex-1" disabled />
                  <Input label="CVV" placeholder="123" className="flex-1" disabled />
                </div>
                <Input label="Titular de la tarjeta" placeholder="Como aparece en la tarjeta" disabled />
              </div>
            </Card>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
              <Icon name="lock" className="text-[16px] text-success" /> Pago seguro con IziPay
            </span>
            <div className="flex gap-1.5">
              {['Visa', 'Mastercard', 'Amex', 'Diners', 'Yape'].map((b) => (
                <span key={b} className="rounded border border-border bg-surface px-1.5 py-[3px] text-[11px] font-bold text-muted">
                  {b}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* resumen */}
        <Card elevation="raised" padded className="lg:sticky lg:top-24">
          <p className="mb-3.5 text-xs font-bold uppercase tracking-wider text-slate-400">Resumen</p>
          <div className="mb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-heading text-lg font-extrabold text-foreground">Reporte {p.name}</span>
              {planId === 'ultra' && (
                <Badge tone="brand" size="sm" icon="bolt">
                  IA
                </Badge>
              )}
            </div>
            <span className="font-mono text-[15px] font-bold text-foreground">{p.priceLabel}</span>
          </div>
          <p className="text-[13px] text-muted">Placa ABC-123 · Toyota Yaris 2021 (ejemplo)</p>

          <div className="my-4 border-t border-dashed border-border pt-4">
            <Input placeholder="Código promocional" icon="sell" />
          </div>

          <div className="flex items-baseline justify-between pt-1">
            <span className="text-base font-bold text-foreground">Total</span>
            <span className="font-heading text-[26px] font-extrabold text-foreground">{p.priceLabel}</span>
          </div>
          <div className="mt-4">
            <Button variant="accent" size="lg" block icon="lock" onClick={() => onPay(planId)}>
              Simular pago {p.priceLabel}
            </Button>
          </div>
          <p className="mt-3 text-center text-xs leading-normal text-slate-400">
            Acceso inmediato al reporte tras el pago. Sin suscripción.
          </p>
        </Card>
      </div>
    </div>
  );
}

/* ───────────────────────── Confirmación ───────────────────────── */
function SuccessView({ planId, onRestart }: { planId: PlanId; onRestart: () => void }) {
  const p = PLANS[planId];
  return (
    <div className="mx-auto max-w-[560px] px-8 py-20 text-center">
      <div className="mx-auto mb-5 grid h-[88px] w-[88px] place-items-center rounded-full bg-success-bg">
        <Icon name="check_circle" fill className="text-[56px] text-success" />
      </div>
      <Badge tone="neutral" icon="visibility">
        Vista de ejemplo · marcha blanca
      </Badge>
      <h1 className="mt-4 font-heading text-[32px] font-extrabold tracking-tight text-foreground">
        Así confirmamos tu pago
      </h1>
      <p className="mx-auto mb-7 mt-3 max-w-md text-[17px] leading-relaxed text-muted">
        Cuando los pagos estén activos, tu <strong>Reporte {p.name}</strong> de la placa{' '}
        <strong className="font-mono">ABC-123</strong> quedará disponible al instante y te llegará una copia a tu
        correo.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button variant="accent" size="lg" iconRight="arrow_forward" href="/reporte/ejemplo">
          Ver reporte de ejemplo
        </Button>
        <Button variant="secondary" size="lg" icon="download" disabled>
          Descargar PDF
        </Button>
      </div>
      <button
        onClick={onRestart}
        className="mt-6 cursor-pointer font-body text-sm font-semibold text-accent hover:underline"
      >
        Ver los planes otra vez
      </button>
    </div>
  );
}

/* ───────────────────────── Shell ───────────────────────── */
type Route = { name: 'planes' | 'checkout' | 'success'; plan: PlanId };

export default function PlanesPage() {
  const [route, setRoute] = useState<Route>({ name: 'planes', plan: 'pro' });

  const goCheckout = (plan: PlanId) => {
    if (plan === 'basic') {
      setRoute({ name: 'success', plan: 'basic' });
      return;
    }
    setRoute({ name: 'checkout', plan });
  };

  return (
    <div className="bg-background">
      {route.name === 'planes' && <PlanesView onChoose={goCheckout} />}
      {route.name === 'checkout' && (
        <CheckoutView
          planId={route.plan}
          onBack={() => setRoute({ name: 'planes', plan: route.plan })}
          onPay={(plan) => setRoute({ name: 'success', plan })}
        />
      )}
      {route.name === 'success' && (
        <SuccessView planId={route.plan} onRestart={() => setRoute({ name: 'planes', plan: 'pro' })} />
      )}
    </div>
  );
}
