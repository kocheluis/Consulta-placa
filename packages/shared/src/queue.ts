/** Nombre de la cola BullMQ compartida entre API (productor) y worker (consumidor). */
export const CONSULTA_QUEUE = 'consultas';

/** Payload del job encolado. */
export interface ConsultaJobData {
  jobId: string;
  plateNormalized: string;
  plateDisplay: string;
  forceRefresh: boolean;
  origin: string;
}

/** Claves de caché Redis. */
export const cacheKeys = {
  report: (plate: string) => `report:${plate}`,
  section: (plate: string, kind: string) => `section:${plate}:${kind}`,
  rateLimit: (origin: string) => `ratelimit:${origin}`,
  scraperHealth: (source: string) => `scraper:health:${source}`,
};

/** Estado de salud de un scraper, registrado por el worker y leído por la API. */
export interface ScraperHealth {
  source: string;
  status: 'up' | 'down' | 'unknown';
  at: string;
}

/** TTL (segundos) por tipo de sección, configurable por entorno. */
export interface CacheTtlConfig {
  registralSeconds: number;
  segurosSeconds: number;
  siniestralidadSeconds: number;
}

export function ttlForSection(kind: string, cfg: CacheTtlConfig): number {
  switch (kind) {
    case 'REGISTRAL':
      return cfg.registralSeconds;
    case 'SEGUROS':
      return cfg.segurosSeconds;
    case 'SINIESTRALIDAD':
      return cfg.siniestralidadSeconds;
    default:
      return 0;
  }
}
