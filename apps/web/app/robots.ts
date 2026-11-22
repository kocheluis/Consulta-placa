import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://placape.pe';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      // El reporte de ejemplo SÍ se indexa (muestra el producto); la regla más específica gana.
      allow: ['/', '/reporte/ejemplo'],
      // Resultados por placa, áreas privadas y API: no aportan contenido indexable.
      disallow: ['/guiada/', '/reporte/', '/cuenta', '/consultas', '/onboarding', '/admin', '/auth/', '/api/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
