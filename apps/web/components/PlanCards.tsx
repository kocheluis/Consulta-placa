import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PAQUETES, PACK_DIAS, PRECIO_INDIVIDUAL, mensajePaquete, pedirPorWhatsApp, soles, solesPorConsulta } from '@/lib/planes';

interface Card {
  key: string;
  name: string;
  price: string;
  per?: string;
  desc: string;
  note?: string;
  tag?: string;
  featured?: boolean;
  cta: string;
  href: string;
  external?: boolean;
  variant: 'primary' | 'accent' | 'secondary';
}

/** Tarjetas de planes (portada y /planes). Precios desde lib/planes.ts (fuente única). */
export function PlanCards() {
  const cards: Card[] = [
    {
      key: 'basico', name: 'Básico', price: 'Gratis', variant: 'secondary',
      desc: 'Identidad del vehículo, propietario, SOAT y revisión técnica.',
      cta: 'Consultar gratis', href: '/',
    },
    {
      key: 'completo', name: 'Completo', price: soles(PRECIO_INDIVIDUAL), per: 'por placa', variant: 'accent',
      featured: true, tag: 'Recomendado',
      desc: 'Todas las fuentes: historial de dueños y precios, papeletas, gravámenes, orden de captura y siniestralidad, más el análisis con IA y la valorización de mercado.',
      note: 'Tu primer reporte Completo es gratis al crear tu cuenta.',
      cta: 'Consultar una placa', href: '/',
    },
    ...PAQUETES.map((p, i): Card => ({
      key: p.id, name: `${p.consultas} consultas`, price: soles(p.precio), per: 'al mes', variant: 'primary',
      tag: i === PAQUETES.length - 1 ? 'Mejor precio' : undefined,
      desc: `${p.consultas} reportes Completo a ${solesPorConsulta(p)} cada uno. Para concesionarias, financieras y quienes revisan varios autos.`,
      note: `Vence a los ${PACK_DIAS} días. No acumulable.`,
      cta: 'Pedir por WhatsApp', href: pedirPorWhatsApp(mensajePaquete(p)), external: true,
    })),
  ];

  return (
    <div className="grid items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.key}
          className={`relative flex flex-col rounded-xl p-6 ${
            c.featured ? 'border-2 border-teal-500 bg-azul-950 text-white shadow-lg' : 'border border-border bg-surface text-foreground shadow-sm'
          }`}
        >
          {c.tag && (
            <span
              className={`absolute -top-3 left-6 whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold tracking-wide ${
                c.featured ? 'bg-teal-500 text-[#042D29]' : 'bg-primary text-white'
              }`}
            >
              {c.tag}
            </span>
          )}
          <h3 className={`font-heading text-[21px] font-extrabold ${c.featured ? 'text-white' : 'text-foreground'}`}>{c.name}</h3>
          <p className={`mt-2.5 font-heading text-[34px] font-extrabold tracking-tight tabular-nums ${c.featured ? 'text-white' : 'text-foreground'}`}>
            {c.price}
            {c.per && <span className={`ml-1.5 font-body text-sm font-semibold ${c.featured ? 'text-azul-200' : 'text-muted'}`}>{c.per}</span>}
          </p>
          <p className={`mt-2 flex-1 font-body text-sm leading-normal ${c.featured ? 'text-azul-200' : 'text-muted'}`}>{c.desc}</p>
          {c.note && (
            <p className={`mt-3 flex items-start gap-1.5 font-body text-[12.5px] font-semibold leading-snug ${c.featured ? 'text-teal-300' : 'text-teal-700'}`}>
              <Icon name={c.featured ? 'redeem' : 'event'} className="mt-px text-[15px]" /> {c.note}
            </p>
          )}
          <div className="mt-5">
            {c.external ? (
              <a
                href={c.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-body text-[15px] font-semibold text-white transition-colors hover:bg-azul-800"
              >
                <Icon name="chat" className="text-[18px]" /> {c.cta}
              </a>
            ) : (
              <Button variant={c.variant} block size="md" iconRight="arrow_forward" href={c.href}>
                {c.cta}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
