import { Redis } from 'ioredis';
import { cacheKeys, type Report } from '@app/shared';

/**
 * Caché de reportes por placa con TTL (FR-042). Reduce el scraping real y el
 * costo de CAPTCHA; permite la respuesta <3 s en consultas repetidas (SC-002).
 */
export class ReportCache {
  constructor(private readonly redis: Redis) {}

  async get(plateNormalized: string): Promise<{ report: Report; ageSeconds: number } | null> {
    const key = cacheKeys.report(plateNormalized);
    const raw = await this.redis.get(key);
    if (!raw) return null;
    const ttl = await this.redis.ttl(key);
    const report = JSON.parse(raw) as Report & { _storedTtl?: number };
    const storedTtl = report._storedTtl ?? ttl;
    const ageSeconds = storedTtl > 0 ? Math.max(0, storedTtl - ttl) : 0;
    return { report, ageSeconds };
  }

  async set(plateNormalized: string, report: Report, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    const key = cacheKeys.report(plateNormalized);
    const value = JSON.stringify({ ...report, _storedTtl: ttlSeconds });
    await this.redis.set(key, value, 'EX', ttlSeconds);
  }

  /** Invalida la caché de una placa (FR-043 forceRefresh). */
  async invalidate(plateNormalized: string): Promise<void> {
    await this.redis.del(cacheKeys.report(plateNormalized));
  }
}
