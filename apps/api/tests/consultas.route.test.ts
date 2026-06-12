import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { ConsultaResponse } from '@app/shared';
import { registerConsultaRoutes } from '../src/routes/consultas.js';
import type { ConsultaService } from '../src/services/consulta.js';

/** Servicio simulado: no toca Redis/BullMQ/Postgres. */
function fakeService(): ConsultaService {
  return {
    async create(placa: string) {
      const body: ConsultaResponse = {
        jobId: 'job-1',
        status: 'PENDING',
        cached: false,
        report: null,
      };
      return { http: 202 as const, body };
    },
    async getJob(jobId: string) {
      if (jobId === 'missing') return null;
      return { jobId, status: 'RUNNING', cached: false, report: null } as ConsultaResponse;
    },
  } as unknown as ConsultaService;
}

async function buildTestApp() {
  const app = Fastify();
  registerConsultaRoutes(app, fakeService());
  await app.ready();
  return app;
}

describe('POST /api/v1/consultas', () => {
  it('rechaza una placa inválida con 400 (FR-002)', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/consultas',
      payload: { placa: 'xx' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_PLATE');
    await app.close();
  });

  it('encola una placa válida y devuelve 202 con jobId', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/consultas',
      payload: { placa: 'ABC-123' },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe('PENDING');
    expect(body.jobId).toBe('job-1');
    await app.close();
  });
});

describe('GET /api/v1/consultas/:jobId', () => {
  it('devuelve 404 si el job no existe', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/consultas/missing' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('devuelve el estado del job', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/consultas/job-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('RUNNING');
    await app.close();
  });
});
