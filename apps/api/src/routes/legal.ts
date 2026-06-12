import type { FastifyInstance } from 'fastify';
import { DISCLAIMER_TEXT } from '@app/shared';

const DOCS: Record<string, { title: string; body: string }> = {
  terms: {
    title: 'Términos de uso',
    body:
      'ConsultaPlaca muestra información referencial obtenida de portales públicos oficiales ' +
      '(SUNARP, SBS, APESEG). No constituye un certificado oficial. Prohibido el uso automatizado ' +
      'o masivo y la elaboración de bases de datos de personas.',
  },
  privacy: {
    title: 'Política de privacidad',
    body:
      'Tratamos los datos conforme a la Ley 29733 y el DS 016-2024-JUS. El nombre del titular es ' +
      'dato registral público de SUNARP; se muestra con minimización, retención corta y sin ' +
      'búsqueda inversa por nombre. ' +
      DISCLAIMER_TEXT,
  },
};

export function registerLegalRoutes(app: FastifyInstance): void {
  app.get<{ Params: { doc: string } }>('/api/v1/legal/:doc', async (request, reply) => {
    const doc = DOCS[request.params.doc];
    if (!doc) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Documento inválido' });
    return reply.send(doc);
  });
}
