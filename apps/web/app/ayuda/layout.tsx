import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Ayuda y preguntas frecuentes',
  description: 'Cómo consultar una placa, qué trae cada reporte, cuánto demora, cómo pagar y qué hacer si un dato no cuadra.',
  alternates: { canonical: '/ayuda' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
