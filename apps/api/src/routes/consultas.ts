import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { ConsultaRequestSchema, InvalidPlateError } from '@app/shared';
import { config } from '../config.js';
import type { ConsultaService } from '../services/consulta.js';

export function registerConsultaRoutes(
  app: FastifyInstance,
  service: ConsultaService,
  guard?: preHandlerHookHandler,
): void {
  const preHandler = guard ? [guard] : [];

  app.post(
    '/api/v1/consultas',
    {
      preHandler,
      config: {
        // Límite más estricto: crear una consulta puede disparar scraping (FR-003).
        rateLimit: { max: config.rateLimitScrapingPerMinute, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
    const parsed = ConsultaRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_PLATE',
        message: parsed.error.issues[0]?.message ?? 'Placa inválida',
      });
    }
    const origin = request.ip;
    try {
      const { http, body } = await service.create(
        parsed.data.placa,
        parsed.data.forceRefresh,
        origin,
      );
      return reply.status(http).send(body);
    } catch (err) {
      if (err instanceof InvalidPlateError) {
        return reply.status(400).send({ error: 'INVALID_PLATE', message: err.message });
      }
      request.log.error(err);
      return reply.status(500).send({ error: 'INTERNAL', message: 'Error al procesar la consulta' });
    }
  });

  app.get<{ Params: { jobId: string } }>('/api/v1/consultas/:jobId', { preHandler }, async (request, reply) => {
    const result = await service.getJob(request.params.jobId);
    if (!result) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Job inexistente o expirado' });
    }
    return reply.send(result);
  });
}
