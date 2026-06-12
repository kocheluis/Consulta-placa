import type { FastifyInstance } from 'fastify';

export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/v1/health', async () => ({
    status: 'ok',
    service: 'consulta-placa-api',
    // El estado por scraper se completará en la fase de polish (T073).
    scrapers: { SUNARP: 'unknown', SBS: 'unknown', APESEG: 'unknown' },
  }));
}
