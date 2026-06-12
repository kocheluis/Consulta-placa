import type { FastifyInstance } from 'fastify';
import { DataSubjectRequestSchema } from '@app/shared';
import { prisma } from '@app/db';

/** Solicitudes de datos personales del titular (FR-052). */
export function registerSolicitudRoutes(app: FastifyInstance): void {
  app.post('/api/v1/solicitudes-datos', async (request, reply) => {
    const parsed = DataSubjectRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Solicitud inválida',
      });
    }
    const created = await prisma.dataSubjectRequest.create({
      data: {
        type: parsed.data.type,
        contactEmail: parsed.data.contactEmail,
        plateOrSubject: parsed.data.plateOrSubject ?? null,
        details: parsed.data.details ?? null,
      },
    });
    return reply.status(201).send({ id: created.id, status: created.status });
  });
}
