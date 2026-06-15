import type { Metadata } from 'next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Tag } from '@/components/ui/Tag';
import { Icon } from '@/components/ui/Icon';

export const metadata: Metadata = {
  title: 'PlacaPe Empresas — verifica tu flota completa',
  description:
    'Panel para concesionarias y talleres: consulta por lote, salud de flota, roles de equipo y precio por volumen desde S/ 12.90 por reporte.',
};

const VERDICT = {
  limpio: { tone: 'success' as const, label: 'Limpio', color: 'text-success' },
  revisar: { tone: 'warning' as const, label: 'Revisar', color: 'text-warning-fg' },
  alerta: { tone: 'danger' as const, label: 'Alerta', color: 'text-danger-fg' },
};

const FLEET = [
  { plate: 'V2K-481', car: 'Hyundai Tucson 2019', score: 86, verdict: 'limpio', soat: 'Vigente', papeletas: 0 },
  { plate: 'ABC-123', car: 'Toyota Yaris 2021', score: 62, verdict: 'revisar', soat: 'Vigente', papeletas: 2 },
  { plate: 'BQR-770', car: 'Kia Rio 2017', score: 44, verdict: 'alerta', soat: 'Vencido', papeletas: 5 },
  { plate: 'D4M-209', car: 'Nissan Sentra 2020', score: 91, verdict: 'limpio', soat: 'Vigente', papeletas: 0 },
] as const;

const KPIS = [
  { icon: 'directions_car', tone: 'brand', label: 'Vehículos en flota', value: '42' },
  { icon: 'verified', tone: 'success', label: 'Limpios', value: '28' },
  { icon: 'warning', tone: 'warning', label: 'Por revisar', value: '9' },
  { icon: 'gpp_bad', tone: 'danger', label: 'Con alertas', value: '5' },
] as const;

const KPI_BG: Record<string, string> = {
  brand: 'bg-azul-50 text-primary',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning-fg',
  danger: 'bg-danger-bg text-danger-fg',
};

const FEATURES = [
  {
    icon: 'upload_file',
    title: 'Consulta por lote',
    desc: 'Sube un CSV o pega decenas de placas y verifica toda tu flota de una sola vez (hasta 500 por lote).',
  },
  {
    icon: 'monitoring',
    title: 'Panel de salud de flota',
    desc: 'Semáforo por vehículo, SOAT por vencer y alertas de captura. Sabes qué autos mover y cuáles frenar.',
  },
  {
    icon: 'group',
    title: 'Equipo y roles',
    desc: 'Invita a tus vendedores, asigna permisos y mira cuántos reportes genera cada quien.',
  },
  {
    icon: 'receipt_long',
    title: 'Facturación con packs',
    desc: 'Compra por volumen, factura con RUC y baja el costo por reporte mientras más verificas.',
  },
];

export default function EmpresasPage() {
  return (
    <div className="bg-background">
      {/* Hero */}
      <section
        className="px-4 py-16 text-white sm:py-20"
        style={{ background: 'linear-gradient(165deg, #103D52 0%, #0A2E3D 60%, #06222E 100%)' }}
      >
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-400/40 bg-teal-400/15 px-3.5 py-1.5 text-[13px] font-bold text-teal-300">
            <Icon name="storefront" className="text-[16px]" /> PlacaPe Empresas
          </span>
          <h1 className="mt-5 font-heading text-[40px] font-extrabold leading-[1.08] tracking-tight sm:text-[48px]">
            Verifica toda tu flota
            <br />
            en un solo panel
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed text-azul-200">
            Para concesionarias y talleres. Consulta por lote, controla la salud de tu stock y paga por volumen
            desde <strong className="text-white">S/ 12.90</strong> por reporte.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Button variant="accent" size="lg" iconRight="arrow_forward" href="mailto:ventas@placape.pe">
              Habla con ventas
            </Button>
            <Button variant="secondary" size="lg" icon="sell" href="/planes">
              Ver planes por volumen
            </Button>
          </div>
        </div>
      </section>

      {/* Vista previa del panel */}
      <section className="mx-auto -mt-10 max-w-[1080px] px-5 sm:px-8">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xl">
          {/* barra de ventana */}
          <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-slate-300" />
            <span className="h-3 w-3 rounded-full bg-slate-300" />
            <span className="h-3 w-3 rounded-full bg-slate-300" />
            <span className="ml-3 flex items-center gap-1.5 rounded-md bg-surface px-3 py-1 font-mono text-[12px] text-muted">
              <Icon name="lock" className="text-[13px] text-success" /> panel.placape.pe/empresas
            </span>
            <span className="ml-auto">
              <Badge tone="neutral" icon="visibility">
                Vista previa · datos de demostración
              </Badge>
            </span>
          </div>

          {/* contenido del panel */}
          <div className="p-5 sm:p-7">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <h2 className="font-heading text-xl font-extrabold text-foreground">Resumen de flota</h2>
                <p className="text-sm text-muted">Concesionaria AutoPlaza · plan Negocio</p>
              </div>
              <span className="hidden sm:block">
                <Button variant="accent" size="sm" icon="add">
                  Verificar placa
                </Button>
              </span>
            </div>

            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              {KPIS.map((k) => (
                <Card key={k.label} elevation="sm" padded>
                  <div className={`mb-3 grid h-10 w-10 place-items-center rounded-md ${KPI_BG[k.tone]}`}>
                    <Icon name={k.icon} className="text-[22px]" />
                  </div>
                  <p className="font-heading text-[28px] font-extrabold text-foreground">{k.value}</p>
                  <p className="text-[13px] text-muted">{k.label}</p>
                </Card>
              ))}
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse font-body">
                <thead>
                  <tr className="bg-background">
                    {['Placa', 'Vehículo', 'Riesgo', 'SOAT', 'Papeletas'].map((h, i) => (
                      <th
                        key={h}
                        className={`px-4 py-3 text-[12px] font-bold uppercase tracking-wide text-muted ${
                          i < 2 ? 'text-left' : 'text-center'
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FLEET.map((r) => {
                    const v = VERDICT[r.verdict];
                    return (
                      <tr key={r.plate} className="border-t border-border">
                        <td className="px-4 py-3">
                          <span className="font-mono text-sm font-bold tracking-wide text-foreground">{r.plate}</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">{r.car}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`font-mono text-sm font-bold ${v.color}`}>{r.score}</span>
                            <Badge tone={v.tone} size="sm" icon={null}>
                              {v.label}
                            </Badge>
                          </span>
                        </td>
                        <td
                          className={`px-4 py-3 text-center text-[13.5px] font-semibold ${
                            r.soat === 'Vigente' ? 'text-success' : 'text-danger-fg'
                          }`}
                        >
                          {r.soat}
                        </td>
                        <td
                          className={`px-4 py-3 text-center font-mono text-sm font-semibold ${
                            r.papeletas ? 'text-warning-fg' : 'text-muted'
                          }`}
                        >
                          {r.papeletas}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-[1080px] px-5 py-16 sm:px-8">
        <div className="mb-10 text-center">
          <h2 className="font-heading text-[28px] font-bold tracking-tight text-foreground">
            Todo lo que tu negocio necesita
          </h2>
          <p className="mx-auto mt-2.5 max-w-xl text-base text-muted">
            Pensado para quien verifica muchos vehículos al mes.
          </p>
        </div>
        <div className="grid gap-[18px] sm:grid-cols-2">
          {FEATURES.map((f) => (
            <Card key={f.title} elevation="sm" padded>
              <div className="flex items-start gap-4">
                <div className="grid h-12 w-12 flex-none place-items-center rounded-md bg-teal-50">
                  <Icon name={f.icon} className="text-[26px] text-teal-700" />
                </div>
                <div>
                  <h3 className="font-heading text-lg font-bold text-foreground">{f.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{f.desc}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Precio por volumen */}
      <section className="mx-auto max-w-[1080px] px-5 pb-16 sm:px-8">
        <div
          className="overflow-hidden rounded-2xl p-8 text-white sm:p-10"
          style={{ background: 'linear-gradient(165deg, #0A2E3D, #06222E)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="max-w-xl">
              <div className="flex items-center gap-2.5">
                <Icon name="savings" className="text-[24px] text-teal-300" />
                <h2 className="font-heading text-[26px] font-extrabold tracking-tight">Precio por volumen</h2>
              </div>
              <p className="mt-2 text-[15px] leading-relaxed text-azul-200">
                Desde <strong className="text-white">10 reportes</strong>, el costo por consulta baja hasta{' '}
                <strong className="text-teal-300">S/ 9.90 (Pro)</strong> o{' '}
                <strong className="text-teal-300">S/ 12.90 (Ultra)</strong>. Factura con RUC y vigencia de 12 meses.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {['10 / 25 / 50 reportes', 'Hasta −35%', 'Factura electrónica', 'Vigencia 12 meses'].map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Button variant="accent" size="lg" iconRight="arrow_forward" href="/planes">
                Ver packs por volumen
              </Button>
              <Button variant="secondary" size="lg" icon="mail" href="mailto:ventas@placape.pe">
                Habla con ventas
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
