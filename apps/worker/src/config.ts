const num = (v: string | undefined, def: number): number => {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : def;
};

export const config = {
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  demoMode: (process.env.DEMO_MODE ?? '').toLowerCase() === 'true',
  concurrency: num(process.env.WORKER_CONCURRENCY, 2),
  scraperTimeoutMs: num(process.env.SCRAPER_TIMEOUT_MS, 30000),
  // Navegador stealth: headful (false) es lo validado. En servidores sin display
  // (Render) se pone STEALTH_HEADLESS=true (requiere validar que el Turnstile pase).
  stealthHeadless: (process.env.STEALTH_HEADLESS ?? 'false').toLowerCase() === 'true',
  // Canal del navegador stealth: 'chrome' (validado en local). En imágenes sin
  // Google Chrome se puede probar otro canal por entorno.
  stealthChannel: process.env.STEALTH_CHANNEL,
  captcha: {
    provider: process.env.CAPTCHA_PROVIDER ?? 'capsolver',
    apiKey: process.env.CAPTCHA_API_KEY ?? '',
  },
  ttl: {
    registralSeconds: num(process.env.REPORT_TTL_REGISTRAL_DAYS, 7) * 86400,
    segurosSeconds: num(process.env.REPORT_TTL_SEGUROS_HOURS, 24) * 3600,
    siniestralidadSeconds: num(process.env.REPORT_TTL_SINIESTRALIDAD_HOURS, 24) * 3600,
  },
  ownerRetentionDays: num(process.env.OWNER_RETENTION_DAYS, 7),
};
