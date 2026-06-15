'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Icon } from '@/components/ui/Icon';

const CATS = [
  { icon: 'search', title: 'Consultas y reportes', count: 8 },
  { icon: 'credit_card', title: 'Pagos y planes', count: 6 },
  { icon: 'account_circle', title: 'Mi cuenta', count: 5 },
  { icon: 'verified_user', title: 'Fuentes y datos', count: 7 },
  { icon: 'storefront', title: 'Empresas', count: 4 },
  { icon: 'gpp_good', title: 'Seguridad', count: 3 },
];

const FAQS = [
  {
    q: '¿Qué información incluye un reporte?',
    a: 'Identidad del vehículo, propietarios, SOAT, papeletas, siniestralidad, órdenes de captura, revisión técnica y —en Ultra— gravámenes, odómetro, valorización y análisis con IA. Todo desde +10 fuentes nacionales.',
  },
  {
    q: '¿De dónde provienen los datos?',
    a: 'Consolidamos registros oficiales: SUNARP, SAT, SBS, MTC, SUTRAN, APESEG, ATU y ONPE, entre otros. Cada hallazgo del reporte indica su fuente.',
  },
  {
    q: '¿Cuánto demora la consulta?',
    a: 'El reporte se genera en unos segundos. Recibirás el resultado en pantalla y una copia en tu correo.',
  },
  {
    q: '¿Qué pasa si la placa no aparece?',
    a: 'Verifica el formato (3 letras y 3 números, p. ej. ABC-123). Si aún no aparece, no se te cobra y puedes reintentar o escribir a soporte.',
  },
  {
    q: '¿Puedo pagar con Yape?',
    a: 'Sí. Aceptaremos Yape y tarjetas Visa/Mastercard/Amex/Diners a través de IziPay. El pago será seguro y el acceso al reporte inmediato. (Pagos en integración durante la marcha blanca.)',
  },
  {
    q: '¿Los packs por volumen vencen?',
    a: 'Los packs (Pro y Ultra) tienen una vigencia de 12 meses desde la compra. Ideal para concesionarias que verifican varios vehículos.',
  },
];

function Faq({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-3.5 px-1 py-[18px] text-left"
        aria-expanded={open}
      >
        <span className="flex-1 font-body text-base font-semibold text-foreground">{q}</span>
        <Icon name={open ? 'remove' : 'add'} className="text-[22px] text-primary" />
      </button>
      {open && <p className="mb-[18px] max-w-3xl px-1 text-[15px] leading-relaxed text-muted">{a}</p>}
    </div>
  );
}

export default function AyudaPage() {
  const [q, setQ] = useState('');
  const faqs = FAQS.filter((f) => (f.q + f.a).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="bg-background">
      {/* hero */}
      <section
        className="px-4 pb-14 pt-12 text-white"
        style={{ background: 'linear-gradient(165deg, #103D52, #0A2E3D)' }}
      >
        <div className="mx-auto max-w-2xl text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-placape-light.svg" alt="PlacaPe" className="mx-auto mb-5 h-7" />
          <h1 className="font-heading text-[34px] font-extrabold tracking-tight">¿Cómo podemos ayudarte?</h1>
          <p className="mb-6 mt-2.5 text-base text-azul-200">Encuentra respuestas o escríbenos.</p>
          <div className="mx-auto max-w-lg text-left">
            <Input
              icon="search"
              placeholder="Busca: SOAT, Yape, papeletas…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1080px] px-5 pb-16 pt-10 sm:px-8">
        {/* categorías */}
        <h2 className="mb-4 font-heading text-[22px] font-bold text-foreground">Temas de ayuda</h2>
        <div className="mb-11 grid gap-4 md:grid-cols-3">
          {CATS.map((c) => (
            <Card key={c.title} elevation="sm" padded interactive>
              <div className="flex items-center gap-3.5">
                <div className="grid h-[46px] w-[46px] flex-none place-items-center rounded-md bg-azul-50">
                  <Icon name={c.icon} className="text-[24px] text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-body text-[15.5px] font-bold text-foreground">{c.title}</p>
                  <p className="mt-0.5 text-[13px] text-muted">{c.count} artículos</p>
                </div>
                <Icon name="chevron_right" className="text-[22px] text-slate-400" />
              </div>
            </Card>
          ))}
        </div>

        {/* FAQ + contacto */}
        <div className="grid items-start gap-7 lg:grid-cols-[1.7fr_1fr]">
          <div>
            <h2 className="mb-2 font-heading text-[22px] font-bold text-foreground">Preguntas frecuentes</h2>
            <div className="rounded-lg border border-border bg-surface px-5 py-1 shadow-sm">
              {faqs.map((f) => (
                <Faq key={f.q} q={f.q} a={f.a} />
              ))}
              {faqs.length === 0 && (
                <p className="px-1 py-6 text-sm text-muted">
                  Sin resultados para “{q}”. Prueba otra búsqueda o escríbenos.
                </p>
              )}
            </div>
          </div>

          <Card elevation="raised" padded className="lg:sticky lg:top-24">
            <div className="mb-3.5 grid h-12 w-12 place-items-center rounded-md bg-teal-50">
              <Icon name="support_agent" className="text-[26px] text-teal-700" />
            </div>
            <h3 className="mb-1.5 font-heading text-lg font-bold text-foreground">
              ¿No encuentras lo que buscas?
            </h3>
            <p className="mb-[18px] text-sm leading-relaxed text-muted">
              Nuestro equipo te responde en horario de oficina, de lunes a sábado.
            </p>
            <div className="flex flex-col gap-2.5">
              <Button variant="accent" block icon="mail" href="mailto:soporte@placape.pe">
                Escribir un correo
              </Button>
              <Button variant="secondary" block icon="call" href="tel:+5117000000">
                +51 1 700 0000
              </Button>
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-border pt-4">
              <Icon name="schedule" className="text-[18px] text-muted" />
              <span className="text-[13px] text-muted">Lun–Sáb · 9:00 a 18:00</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
