import { describe, it, expect } from 'vitest';
import type { Redis } from 'ioredis';
import type { Report } from '@app/shared';
import { ReportCache } from './cache.js';

/** Redis en memoria mínimo para probar ReportCache sin infraestructura. */
function fakeRedis(): Redis {
  const store = new Map<string, { value: string; ttl: number }>();
  return {
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async set(key: string, value: string, _ex: string, ttl: number) {
      store.set(key, { value, ttl });
      return 'OK';
    },
    async ttl(key: string) {
      return store.get(key)?.ttl ?? -2;
    },
    async del(key: string) {
      return store.delete(key) ? 1 : 0;
    },
  } as unknown as Redis;
}

const report: Report = {
  id: 'r1',
  placa: 'ABC-123',
  status: 'COMPLETE',
  generatedAt: '2026-06-12T10:00:00Z',
  disclaimer: 'x',
  vehicle: null,
  sections: [],
};

describe('ReportCache', () => {
  it('guarda y recupera un reporte con antigüedad ~0 al recién escribir', async () => {
    const cache = new ReportCache(fakeRedis());
    await cache.set('ABC123', report, 3600);
    const hit = await cache.get('ABC123');
    expect(hit).not.toBeNull();
    expect(hit!.report.placa).toBe('ABC-123');
    expect(hit!.ageSeconds).toBe(0);
  });

  it('devuelve null tras invalidar (forceRefresh)', async () => {
    const cache = new ReportCache(fakeRedis());
    await cache.set('ABC123', report, 3600);
    await cache.invalidate('ABC123');
    expect(await cache.get('ABC123')).toBeNull();
  });

  it('no escribe con TTL <= 0', async () => {
    const cache = new ReportCache(fakeRedis());
    await cache.set('ABC123', report, 0);
    expect(await cache.get('ABC123')).toBeNull();
  });
});
