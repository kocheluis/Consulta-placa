import type { CacheTtlConfig } from '@app/shared';

const num = (v: string | undefined, def: number): number => {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : def;
};

const isProd = process.env.NODE_ENV === 'production';

// Seguridad: en producción el secreto JWT es OBLIGATORIO. Sin él, cualquiera
// podría falsificar tokens de sesión, así que la app se niega a arrancar.
const jwtSecret = process.env.JWT_SECRET ?? '';
if (isProd && jwtSecret.length < 16) {
  throw new Error(
    'JWT_SECRET es obligatorio en producción (mín. 16 caracteres). Configúralo en las variables de entorno.',
  );
}

// CORS: dominios permitidos (coma-separados) p. ej. https://consulta-placa-web.vercel.app
const corsOrigins = (process.env.WEB_ORIGIN ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const config = {
  isProd,
  port: num(process.env.API_PORT, 3001),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret: jwtSecret || 'dev-only-insecure-secret-no-usar-en-produccion',
  corsOrigins,
  rateLimitPerMinute: num(process.env.RATE_LIMIT_PER_MINUTE, 10),
  rateLimitScrapingPerMinute: num(process.env.RATE_LIMIT_SCRAPING_PER_MINUTE, 3),
  rateLimitAuthPerMinute: num(process.env.RATE_LIMIT_AUTH_PER_MINUTE, 5),
  ttl: {
    registralSeconds: num(process.env.REPORT_TTL_REGISTRAL_DAYS, 7) * 86400,
    segurosSeconds: num(process.env.REPORT_TTL_SEGUROS_HOURS, 24) * 3600,
    siniestralidadSeconds: num(process.env.REPORT_TTL_SINIESTRALIDAD_HOURS, 24) * 3600,
  } satisfies CacheTtlConfig,
};
