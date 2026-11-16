import type { Metadata } from 'next';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { PlanCards } from '@/components/PlanCards';
import { PACK_DIAS, PAQUETES, PRECIO_INDIVIDUAL, soles } from '@/lib/planes';

export const metadata: Metadata = {
  title: 'Planes y precios — PlacaPe',
  description: `Reporte Básico gratis, reporte Completo a ${soles(PRECIO_INDIVIDUAL)} por placa y paquetes mensuales de ${PAQUETES.map((p) => p.consultas).join(' y ')} consultas.`,
};

/**
 * Planes (nov-2026): Básico gratis · Completo por placa · paquetes mensuales por WhatsApp. Reemplaza la
 * maqueta de checkout anterior (Pro/Ultra/packs de 12 meses). La compra del Completo suelto ocurre en el
 * propio reporte (/reporte/[placa]); los paquetes se piden por WhatsApp y se activan en la cuenta.
 */
const PASOS_PAQUETE = [
  { icon: 'chat', t: 'Pídelo por WhatsApp', d: 'Escríbenos con el correo de tu cuenta PlacaPe y el paquete que quieres.' },
  { icon: 'verified', t: 'Lo activamos en tu cuenta', d: 'Al confirmar el pago, tu cuenta queda con sus consultas disponibles.' },
  { icon: 'event', t: `Úsalo durante ${PACK_DIAS} días`, d: 'Cada placa que consultes genera un reporte Completo. Las consultas que no uses no se acumulan al mes siguiente.' },
];

const DUDAS = [
  {
    q: '¿Qué trae el reporte Completo?',
    a: 'Todas las fuentes que consultamos: identidad y propietario, historial de dueños y precios (SUNARP), papeletas de los SAT, orden de captura, gravámenes y garantías, siniestralidad, SOAT y revisión técnica, más la recomendación de compra con IA y la valorización de mercado.',
  },
  {
    q: '¿Cómo funciona la prueba gratis?',
    a: 'Al crear tu cuenta, tu primer reporte Completo es gratis. Es una prueba por cuenta y por dispositivo: crear otra cuenta en el mismo equipo no habilita una segunda prueba.',
  },
  {
    q: '¿Qué pasa si no uso todas las consultas del paquete?',
    a: `El paquete vence a los ${PACK_DIAS} días de activado y las consultas restantes no pasan al mes siguiente. Si activas un paquete nuevo, reemplaza al anterior.`,
  },
  {
    q: '¿Puedo volver a ver un reporte que ya consulté?',
    a: 'Sí. En "Mis reportes" guardamos cada consulta tal como salió durante 30 días. También puedes descargarla en PDF o enviártela por correo.',
  },
];

export default function PlanesPage() {
  return (
    <div className="bg-background">
      <section className="mx-auto max-w-[1180px] px-6 pb-4 pt-14 text-center sm:px-8">
        <p className="mb-2 font-body text-[12.5px] font-bold uppercase tracking-widest text-teal-700">Planes y precios</p>
        <h1 className="font-heading text-[34px] font-extrabold tracking-tight text-foreground sm:text-[44px]" style={{ textWrap: 'balance' }}>
          Paga por placa o ahorra con un paquete mensual
        </h1>
        <p className="mx-auto mt-3 max-w-[600px] font-body text-base leading-relaxed text-muted">
          El reporte Básico es gratis. El Completo cuesta {soles(PRECIO_INDIVIDUAL)} por placa, y el primero va por nuestra cuenta.
        </p>
      </section>

      <section className="mx-auto max-w-[1180px] px-6 pt-8 sm:px-8">
        <PlanCards />
      </section>

      <section className="mx-auto max-w-[1180px] px-6 pt-16 sm:px-8">
        <h2 className="mb-6 font-heading text-[24px] font-bold tracking-tight text-foreground">Cómo funcionan los paquetes</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {PASOS_PAQUETE.map((p) => (
            <div key={p.t} className="rounded-xl border border-border bg-surface p-5 shadow-sm">
              <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-teal-50">
                <Icon name={p.icon} className="text-[24px] text-teal-700" />
              </div>
              <p className="font-heading text-[16px] font-bold text-foreground">{p.t}</p>
              <p className="mt-1 font-body text-[14px] leading-relaxed text-muted">{p.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[860px] px-6 pt-16 sm:px-8">
        <h2 className="mb-5 font-heading text-[24px] font-bold tracking-tight text-foreground">Preguntas frecuentes</h2>
        <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
          {DUDAS.map((d) => (
            <details key={d.q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-body text-[15px] font-semibold text-foreground">
                {d.q}
                <Icon name="expand_more" className="text-[22px] text-muted transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-2 font-body text-[14px] leading-relaxed text-muted">{d.a}</p>
            </details>
          ))}
        </div>
        <div className="mt-8 flex justify-center">
          <Button variant="accent" size="lg" href="/" iconRight="arrow_forward">
            Consultar una placa
          </Button>
        </div>
      </section>
    </div>
  );
}
