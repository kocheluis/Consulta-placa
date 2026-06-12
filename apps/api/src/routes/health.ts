import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { SourceId, cacheKeys, type ScraperHealth } from '@app/shared';

export function registerHealthRoute(app: FastifyInstance, redis: Redis): void {
  app.get('/api/v1/health', async () => {
    const sources = Object.values(SourceId);
    const entries = await Promise.all(
      sources.map(async (source) => {
        const raw = await redis.get(cacheKeys.scraperHealth(source));
        const health: ScraperHealth = raw
          ? (JSON.parse(raw) as ScraperHealth)
          : { source, status: 'unknown', at: '' };
        return [source, health] as const;
      }),
    );
    return {
      status: 'ok',
      service: 'consulta-placa-api',
      scrapers: Object.fromEntries(entries),
    };
  });
}
