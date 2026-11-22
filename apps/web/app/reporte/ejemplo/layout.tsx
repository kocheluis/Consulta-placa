import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Reporte de ejemplo',
  description: 'Así se ve un reporte de PlacaPe: score de riesgo, SOAT, papeletas, revisión técnica, siniestros, prendas, historial de dueños y análisis.',
  alternates: { canonical: '/reporte/ejemplo' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
