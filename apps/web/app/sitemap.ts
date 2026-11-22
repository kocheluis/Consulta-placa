import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://placape.pe';

const PAGES: Array<[path: string, freq: MetadataRoute.Sitemap[number]['changeFrequency'], priority: number]> = [
  ['/', 'weekly', 1],
  ['/planes', 'monthly', 0.9],
  ['/reporte/ejemplo', 'monthly', 0.8],
  ['/portales', 'monthly', 0.7],
  ['/ayuda', 'monthly', 0.6],
  ['/empresas', 'monthly', 0.6],
  ['/legal/terminos', 'yearly', 0.2],
  ['/legal/privacidad', 'yearly', 0.2],
  ['/legal/solicitar-datos', 'yearly', 0.2],
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PAGES.map(([path, changeFrequency, priority]) => ({ url: `${SITE_URL}${path}`, lastModified: now, changeFrequency, priority }));
}
