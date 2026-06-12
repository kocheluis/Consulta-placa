import type { FastifyInstance } from 'fastify';
import { InvalidPlateError } from '@app/shared';
import type { ConsultaService } from '../services/consulta.js';

export function registerReporteRoutes(app: FastifyInstance, service: ConsultaService): void {
  app.get<{ Params: { placa: string } }>('/api/v1/reportes/:placa', async (request, reply) => {
    try {
      const hit = await service.getCachedReport(request.params.placa);
      if (!hit) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Sin reporte previo' });
      }
      return reply.send({ report: hit.report, ageSeconds: hit.ageSeconds });
    } catch (err) {
      if (err instanceof InvalidPlateError) {
        return reply.status(400).send({ error: 'INVALID_PLATE', message: err.message });
      }
      throw err;
    }
  });
}
