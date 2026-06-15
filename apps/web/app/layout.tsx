import type { Metadata } from 'next';
import Link from 'next/link';
import { Analytics } from '@vercel/analytics/react';
import { Button } from '@/components/ui/Button';
import './globals.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://consultavehicular.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'PlacaPe — Consulta de placa y historial vehicular en Perú',
    template: '%s | PlacaPe',
  },
  description:
    'Consulta gratis por placa el historial de un vehículo en Perú: datos de SUNARP, papeletas (SAT), SOAT, siniestros, GNV, impuesto vehicular y orden de captura. Enlaces oficiales en un solo lugar.',
  keywords: [
    'consultar placa',
    'consulta vehicular',
    'consulta de placa Perú',
    'SUNARP consulta vehicular',
    'papeletas por placa',
    'consultar SOAT',
    'historial vehicular Perú',
    'impuesto vehicular',
    'orden de captura vehicular',
    'consulta GNV',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'es_PE',
    url: SITE_URL,
    siteName: 'PlacaPe',
    title: 'PlacaPe — Consulta de placa y historial vehicular en Perú',
    description:
      'Consulta gratis por placa: SUNARP, papeletas, SOAT, siniestros, GNV, impuesto vehicular y orden de captura. Enlaces oficiales en un solo lugar.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PlacaPe — Historial vehicular del Perú por placa',
    description:
      'Consulta gratis por placa: SUNARP, papeletas, SOAT, siniestros, GNV e impuesto vehicular.',
  },
  robots: { index: true, follow: true },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: 'PlacaPe',
      inLanguage: 'es-PE',
      description:
        'Consulta de placa e historial vehicular en Perú con enlaces oficiales (SUNARP, SAT, SBS, MTC).',
    },
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#org`,
      name: 'PlacaPe',
      url: SITE_URL,
      areaServed: 'PE',
    },
  ],
};

const NAV_LINKS = [
  { label: 'Consultar', href: '/' },
  { label: 'Planes', href: '/planes' },
  { label: 'Empresas', href: '/empresas' },
  { label: 'Ayuda', href: '/ayuda' },
];

const FOOTER_COLS: { h: string; links: { label: string; href: string }[] }[] = [
  {
    h: 'Producto',
    links: [
      { label: 'Consultar placa', href: '/' },
      { label: 'Planes', href: '/planes' },
      { label: 'Empresas', href: '/empresas' },
    ],
  },
  {
    h: 'Recursos',
    links: [
      { label: 'Cómo funciona', href: '/#como-funciona' },
      { label: 'Fuentes oficiales', href: '/#fuentes' },
      { label: 'Centro de ayuda', href: '/ayuda' },
    ],
  },
  {
    h: 'Legal',
    links: [
      { label: 'Términos', href: '/legal/terminos' },
      { label: 'Privacidad', href: '/legal/privacidad' },
      { label: 'Solicitar datos', href: '/legal/solicitar-datos' },
    ],
  },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="flex min-h-screen flex-col bg-background">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />

        {/* Nav (frosted, claro) */}
        <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1180px] items-center gap-8 px-6 py-3.5 sm:px-8">
            <Link href="/" aria-label="PlacaPe — inicio" className="flex items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/logo-placape.svg" alt="PlacaPe" className="h-8 w-auto" />
            </Link>
            <nav className="hidden flex-1 items-center gap-7 sm:flex">
              {NAV_LINKS.map((l) => (
                <Link
                  key={l.label}
                  href={l.href}
                  className="font-body text-[14.5px] font-medium text-slate-700 hover:text-foreground"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-3 sm:ml-0">
              <Link
                href="/cuenta"
                className="hidden font-body text-[14.5px] font-semibold text-foreground hover:text-primary sm:inline"
              >
                Iniciar sesión
              </Link>
              <Button variant="accent" size="sm" iconRight="arrow_forward" href="/">
                Verificar placa
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        {/* Footer (oscuro) */}
        <footer className="mt-16 bg-azul-950 text-azul-200">
          <div className="mx-auto grid max-w-[1180px] gap-8 px-6 py-14 sm:px-8 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/logo-placape-light.svg" alt="PlacaPe" className="h-8 w-auto" />
              <p className="mt-3.5 max-w-[280px] font-body text-sm leading-relaxed">
                Conoce el historial del vehículo antes de comprar o vender. Datos de portales
                públicos oficiales del Perú.
              </p>
            </div>
            {FOOTER_COLS.map((col) => (
              <div key={col.h}>
                <p className="mb-3.5 font-body text-[13px] font-bold uppercase tracking-wide text-white">
                  {col.h}
                </p>
                <div className="flex flex-col gap-2.5">
                  {col.links.map((l) => (
                    <Link key={l.label} href={l.href} className="font-body text-sm hover:text-white">
                      {l.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-white/10">
            <div className="mx-auto flex max-w-[1180px] flex-wrap justify-between gap-3 px-6 py-5 font-body text-[13px] text-azul-300 sm:px-8">
              <span>
                Información referencial de portales públicos oficiales. No constituye un certificado
                oficial.
              </span>
              <span>Hecho en Perú</span>
            </div>
          </div>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
