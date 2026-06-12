import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import './globals.css';

export const metadata: Metadata = {
  title: 'ConsultaPlaca — Historial vehicular del Perú',
  description:
    'Consulta el historial de un vehículo peruano por placa: datos registrales (SUNARP), seguro SOAT y siniestralidad (SBS). Información referencial de portales públicos oficiales.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen flex flex-col">
        <header className="sticky top-0 z-10 bg-primary text-white">
          <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 font-heading font-semibold">
              <ShieldCheck className="h-6 w-6" aria-hidden="true" />
              <span>ConsultaPlaca</span>
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
          <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-muted">
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
      </body>
    </html>
  );
}
