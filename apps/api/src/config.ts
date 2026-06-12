import type { CacheTtlConfig } from '@app/shared';

const num = (v: string | undefined, def: number): number => {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : def;
};

export const config = {
  port: num(process.env.API_PORT, 3001),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  rateLimitPerMinute: num(process.env.RATE_LIMIT_PER_MINUTE, 10),
  rateLimitScrapingPerMinute: num(process.env.RATE_LIMIT_SCRAPING_PER_MINUTE, 3),
  ttl: {
    registralSeconds: num(process.env.REPORT_TTL_REGISTRAL_DAYS, 7) * 86400,
    segurosSeconds: num(process.env.REPORT_TTL_SEGUROS_HOURS, 24) * 3600,
    siniestralidadSeconds: num(process.env.REPORT_TTL_SINIESTRALIDAD_HOURS, 24) * 3600,
  } satisfies CacheTtlConfig,
};
