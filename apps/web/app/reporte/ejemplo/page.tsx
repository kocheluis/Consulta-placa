'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Tag } from '@/components/ui/Tag';
import { RiskGauge } from '@/components/RiskGauge';

const PLAN_LEVEL = { basic: 1, pro: 2, ultra: 3 } as const;
type Plan = keyof typeof PLAN_LEVEL;

const PLANS: { id: Plan; name: string; price: string; blurb: string }[] = [
  { id: 'basic', name: 'Basic', price: 'Gratis', blurb: 'Vista general del vehículo' },
  { id: 'pro', name: 'Pro', price: 'S/ 15.90', blurb: 'Reporte completo de las fuentes + score' },
  { id: 'ultra', name: 'Ultra', price: 'S/ 19.90', blurb: 'Todo + IA, odómetro y valorización' },
];
const neededName = (level: number) => (level === 3 ? 'Ultra' : 'Pro');

function DefGrid({ items }: { items: [string, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3">
      {items.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5">
          <span className="font-body text-xs font-semibold uppercase tracking-wide text-slate-400">{k}</span>
          <span className="font-body text-[15px] font-medium text-foreground">{v}</span>
        </div>
      ))}
    </div>
  );
}

const ITEM_TONE: Record<'success' | 'warning' | 'danger', string> = {
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning-fg',
  danger: 'bg-danger-bg text-danger',
};

function ReportItem({
  status,
  label,
  value,
  icon,
}: {
  status: 'success' | 'warning' | 'danger';
  label: string;
  value?: string;
  icon: string;
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-border bg-surface p-3.5">
      <div className={`grid h-10 w-10 flex-none place-items-center rounded-lg ${ITEM_TONE[status]}`}>
        <Icon name={icon} className="text-[22px]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-body text-[15px] font-semibold text-foreground">{label}</p>
        {value && <p className="mt-0.5 font-body text-[13px] text-muted">{value}</p>}
      </div>
    </div>
  );
}

function PapeletaRow({ label, place, amount }: { label: string; place: string; amount: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2">
      <div>
        <p className="font-body text-sm font-semibold text-foreground">{label}</p>
        <p className="mt-px font-body text-xs text-muted">{place}</p>
      </div>
      <span className="font-mono text-sm font-bold text-warning-fg">{amount}</span>
    </div>
  );
}

function SectionCard({
  title,
  icon,
  level,
  plan,
  badge,
  wide,
  children,
  onUpgrade,
}: {
  title: string;
  icon: string;
  level: number;
  plan: Plan;
  badge?: ReactNode;
  wide?: boolean;
  children: ReactNode;
  onUpgrade: (p: Plan) => void;
}) {
  const locked = PLAN_LEVEL[plan] < level;
  const needed = neededName(level);
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <Card
        title={title}
        icon={icon}
        action={locked ? <Badge tone="neutral" size="sm" icon="lock">{needed}</Badge> : badge}
      >
        <div className="relative">
          <div className={locked ? 'pointer-events-none select-none opacity-50 blur-[5px]' : ''}>{children}</div>
          {locked && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-3 text-center">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-surface shadow-md">
                <Icon name="lock" className="text-[22px] text-primary" />
              </div>
              <span className="font-body text-[13px] font-semibold text-slate-700">Disponible en {needed}</span>
              <Button
                variant="accent"
                size="sm"
                iconRight="arrow_forward"
                onClick={() => onUpgrade(level === 3 ? 'ultra' : 'pro')}
              >
                Mejorar a {needed}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

export default function ReporteEjemploPage() {
  const [plan, setPlan] = useState<Plan>('pro');
  const lvl = PLAN_LEVEL[plan];
  const cur = PLANS.find((p) => p.id === plan)!;

  return (
    <div className="bg-background">
      {/* Aviso de ejemplo */}
      <div className="border-b border-warning/30 bg-warning-bg px-4 py-2 text-center font-body text-[13px] font-semibold text-warning-fg">
        <Icon name="science" className="mr-1 align-[-3px] text-[15px]" />
        Reporte de ejemplo · datos de demostración (marcha blanca)
      </div>

      {/* Barra del reporte: placa + control de plan + PDF */}
      <div className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-3 px-4 py-3 sm:px-7">
          <div className="flex items-center gap-2.5">
            <Icon name="directions_car" className="text-xl text-muted" />
            <span className="font-mono text-[15px] font-bold tracking-wide text-foreground">ABC-123</span>
            <span className="font-body text-sm text-muted">· Toyota Yaris 2021</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex gap-0.5 rounded-full bg-slate-100 p-1">
              {PLANS.map((p) => {
                const on = p.id === plan;
                return (
                  <button
                    key={p.id}
                    onClick={() => setPlan(p.id)}
                    className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 font-body text-[13px] font-bold transition-colors ${
                      on ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-foreground'
                    }`}
                  >
                    {p.id === 'ultra' && <Icon name="bolt" fill={on} className="text-[15px]" />}
                    {p.name}
                  </button>
                );
              })}
            </div>
            <Button variant={lvl >= 2 ? 'primary' : 'secondary'} size="sm" icon={lvl >= 2 ? 'download' : 'lock'} disabled={lvl < 2}>
              PDF
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1240px] items-start gap-6 px-4 py-7 sm:px-7 lg:grid-cols-[300px_1fr]">
        {/* Sidebar */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
          <Card padded>
            <div className="mb-3.5 flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-azul-50">
                <Icon name="directions_car" className="text-[26px] text-primary" />
              </div>
              <div>
                <p className="font-mono text-base font-bold tracking-wide text-foreground">ABC-123</p>
                <p className="mt-0.5 font-body text-[13px] text-muted">Toyota Yaris · 2021</p>
              </div>
            </div>
            <RiskGauge score={62} size={76} title="Revisar" />
          </Card>

          <Card padded>
            <div className="flex items-center justify-between">
              <span className="font-body text-xs font-bold uppercase tracking-wider text-slate-400">Tu plan</span>
              <Badge tone={plan === 'ultra' ? 'brand' : plan === 'pro' ? 'info' : 'neutral'} size="sm" icon={plan === 'ultra' ? 'bolt' : null}>
                {cur.name}
              </Badge>
            </div>
            <p className="mb-0.5 mt-2.5 font-heading text-[26px] font-extrabold text-foreground">{cur.price}</p>
            <p className="font-body text-[13px] leading-normal text-muted">{cur.blurb}</p>
            {plan !== 'ultra' && (
              <Button
                variant="accent"
                size="sm"
                block
                iconRight="arrow_forward"
                className="mt-3.5"
                onClick={() => setPlan(plan === 'basic' ? 'pro' : 'ultra')}
              >
                Mejorar a {plan === 'basic' ? 'Pro' : 'Ultra'}
              </Button>
            )}
          </Card>

          <Card padded className="border-azul-200 bg-azul-50">
            <p className="mb-2 font-body text-xs font-bold uppercase tracking-wide text-azul-700">Fuentes nacionales</p>
            <div className="flex flex-wrap gap-1.5">
              {['SUNARP', 'SAT', 'SBS', 'MTC', 'SUTRAN', 'ATU', 'APESEG', 'ONPE'].map((s) => (
                <Tag key={s} variant="source">
                  {s}
                </Tag>
              ))}
            </div>
          </Card>
        </aside>

        {/* Secciones */}
        <main className="grid items-start gap-4 sm:grid-cols-2">
          <SectionCard title="Identidad del vehículo" icon="directions_car" level={1} plan={plan} wide badge={<Badge tone="success" size="sm">Verificado</Badge>} onUpgrade={setPlan}>
            <DefGrid
              items={[
                ['Marca', 'Toyota'], ['Modelo', 'Yaris'], ['Año', '2021'], ['Color', 'Plata metálico'],
                ['Categoría', 'M1 · Sedán'], ['Uso', 'Particular'], ['Combustible', 'Gasolina'], ['VIN', '8AJBA3FS4N1234567'],
              ]}
            />
          </SectionCard>

          <SectionCard title="Propietarios" icon="people" level={1} plan={plan} badge={<Badge tone="info" size="sm" icon={null}>2 dueños</Badge>} onUpgrade={setPlan}>
            <div className="flex items-baseline gap-2">
              <span className="font-heading text-[40px] font-extrabold text-foreground">2</span>
              <span className="font-body text-sm text-muted">propietarios registrados</span>
            </div>
            <p className="mt-1.5 font-body text-[13px] text-muted">Último cambio: feb 2023 · Lima</p>
          </SectionCard>

          <SectionCard title="SOAT" icon="health_and_safety" level={2} plan={plan} badge={<Badge tone="success" size="sm">Vigente</Badge>} onUpgrade={setPlan}>
            <DefGrid items={[['Estado', 'Vigente'], ['Aseguradora', 'La Positiva'], ['Póliza', 'N° 4471882'], ['Vence', '12 ago 2026']]} />
          </SectionCard>

          <SectionCard title="Papeletas y multas" icon="receipt_long" level={2} plan={plan} badge={<Badge tone="warning" size="sm">2 · S/ 480</Badge>} onUpgrade={setPlan}>
            <PapeletaRow label="Exceso de velocidad" place="SAT Lima · 2024" amount="S/ 336" />
            <PapeletaRow label="Estacionamiento prohibido" place="SAT Lima · 2023" amount="S/ 144" />
            <div className="flex justify-between pt-2.5 font-bold">
              <span className="text-sm text-foreground">Total pendiente</span>
              <span className="font-mono text-[15px] text-warning-fg">S/ 480</span>
            </div>
          </SectionCard>

          <SectionCard title="Revisión técnica (MTC)" icon="fact_check" level={2} plan={plan} badge={<Badge tone="warning" size="sm">Vencida</Badge>} onUpgrade={setPlan}>
            <DefGrid items={[['Estado', 'Vencida'], ['Última', 'mar 2025'], ['Vigencia', 'mar 2026'], ['Resultado', 'Aprobado']]} />
          </SectionCard>

          <SectionCard title="Siniestralidad (SBS)" icon="car_crash" level={2} plan={plan} badge={<Badge tone="danger" size="sm">1 siniestro</Badge>} onUpgrade={setPlan}>
            <ReportItem status="danger" label="Choque con daños" value="Reportado a la SBS · jun 2022" icon="car_crash" />
          </SectionCard>

          <SectionCard title="Orden de captura (SAT)" icon="gavel" level={2} plan={plan} badge={<Badge tone="success" size="sm">Sin órdenes</Badge>} onUpgrade={setPlan}>
            <ReportItem status="success" label="Sin órdenes de captura vigentes" icon="verified" />
          </SectionCard>

          <SectionCard title="Gravámenes (SUNARP)" icon="account_balance" level={3} plan={plan} badge={<Badge tone="success" size="sm">Libre</Badge>} onUpgrade={setPlan}>
            <ReportItem status="success" label="Sin gravámenes ni prendas" value="No registra deuda garantizada" icon="lock_open" />
          </SectionCard>

          <SectionCard title="Multas electorales (ONPE)" icon="how_to_vote" level={3} plan={plan} badge={<Badge tone="success" size="sm">Al día</Badge>} onUpgrade={setPlan}>
            <ReportItem status="success" label="Sin multas electorales del propietario" icon="check_circle" />
          </SectionCard>

          <SectionCard title="Odómetro / kilometraje" icon="speed" level={3} plan={plan} badge={<Badge tone="info" size="sm" icon={null}>Coherente</Badge>} onUpgrade={setPlan}>
            <div className="flex flex-col gap-1.5">
              {[['2025', '78,400 km'], ['2024', '61,200 km'], ['2023', '42,900 km'], ['2022', '19,500 km']].map(([y, km]) => (
                <div key={y} className="flex justify-between text-sm">
                  <span className="text-muted">{y}</span>
                  <span className="font-mono font-semibold text-foreground">{km}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Valorización de mercado" icon="payments" level={3} plan={plan} onUpgrade={setPlan}>
            <p className="font-heading text-[30px] font-extrabold text-foreground">S/ 42,500</p>
            <p className="mt-1 font-body text-[13px] text-muted">Rango estimado: S/ 39,800 – 45,100</p>
          </SectionCard>

          <SectionCard title="Análisis con IA" icon="auto_awesome" level={3} plan={plan} wide badge={<Badge tone="brand" size="sm" icon="bolt">Ultra</Badge>} onUpgrade={setPlan}>
            <div className="flex items-start gap-3.5">
              <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-teal-50">
                <Icon name="auto_awesome" fill className="text-[22px] text-teal-700" />
              </div>
              <div>
                <p className="font-body text-[15px] leading-relaxed text-slate-700">
                  El vehículo tiene <strong>riesgo medio</strong>. Lo positivo: SOAT vigente, sin gravámenes ni orden
                  de captura y kilometraje coherente con el año. <strong>Antes de comprar</strong>, exige el pago de
                  las 2 papeletas (S/ 480), renueva la revisión técnica vencida e inspecciona los daños del siniestro
                  de 2022.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge tone="success" size="sm">Negociar S/ 480</Badge>
                  <Badge tone="warning" size="sm">Revisar carrocería</Badge>
                  <Badge tone="info" size="sm" icon={null}>Precio justo: S/ 41k</Badge>
                </div>
              </div>
            </div>
          </SectionCard>
        </main>
      </div>

      <div className="mx-auto max-w-[1240px] px-4 pb-12 sm:px-7">
        <Link href="/" className="inline-flex items-center gap-1.5 font-body text-sm font-semibold text-primary hover:underline">
          <Icon name="arrow_back" className="text-[18px]" /> Volver al inicio
        </Link>
      </div>
    </div>
  );
}
