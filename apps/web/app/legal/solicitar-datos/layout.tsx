import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Solicitar o eliminar mis datos',
  description: 'Ejerce tus derechos de acceso, rectificación, cancelación y oposición sobre tus datos personales (Ley 29733).',
  alternates: { canonical: '/legal/solicitar-datos' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
