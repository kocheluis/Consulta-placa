import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { Analytics } from '@vercel/analytics/react';
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen flex flex-col">
        {/* Datos estructurados estáticos (SEO) — sin datos de usuario. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <header className="sticky top-0 z-10 bg-primary text-white">
          <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
            <Link href="/" className="flex items-center" aria-label="PlacaPe — inicio">
              <Logo className="h-8 w-auto" />
            </Link>
            <nav className="text-sm flex items-center gap-4">
              <Link href="/cuenta" className="hover:underline">
                Cuenta
              </Link>
              <Link href="/legal/privacidad" className="hover:underline">
                Legal
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-border bg-surface">
          <div className="mx-auto max-w-7xl px-4 py-6 text-sm text-muted">
            <p>
              Información referencial obtenida de portales públicos oficiales (SUNARP, SBS, APESEG).
              No constituye un certificado oficial.
            </p>
            <p className="mt-2">
              <Link href="/legal/terminos" className="text-accent hover:underline">
                Términos de uso
              </Link>{' '}
              ·{' '}
              <Link href="/legal/privacidad" className="text-accent hover:underline">
                Política de privacidad
              </Link>
            </p>
          </div>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
