import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';

// Mock de @app/db para no requerir base de datos.
vi.mock('@app/db', () => ({
  prisma: {
    dataSubjectRequest: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'req-1',
        status: 'RECEIVED',
        ...data,
      }),
    },
  },
}));

const { registerSolicitudRoutes } = await import('../src/routes/solicitudes.js');
const { registerLegalRoutes } = await import('../src/routes/legal.js');

async function buildApp() {
  const app = Fastify();
  registerSolicitudRoutes(app);
  registerLegalRoutes(app);
  await app.ready();
  return app;
}

describe('POST /api/v1/solicitudes-datos', () => {
  it('registra una solicitud válida (201)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/solicitudes-datos',
      payload: { type: 'DELETION', contactEmail: 'a@b.pe', plateOrSubject: 'ABC-123' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: 'req-1', status: 'RECEIVED' });
    await app.close();
  });

  it('rechaza correo inválido (400)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/solicitudes-datos',
      payload: { type: 'ACCESS', contactEmail: 'no-es-correo' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('GET /api/v1/legal/:doc', () => {
  it('devuelve términos y privacidad', async () => {
    const app = await buildApp();
    const terms = await app.inject({ method: 'GET', url: '/api/v1/legal/terms' });
    expect(terms.statusCode).toBe(200);
    expect(terms.json().title).toContain('Términos');
    const bad = await app.inject({ method: 'GET', url: '/api/v1/legal/xxx' });
    expect(bad.statusCode).toBe(404);
    await app.close();
  });
});
