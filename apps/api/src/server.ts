import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import {
  ConsultaService,
  createQueue,
  createRedis,
} from './services/consulta.js';
import { registerConsultaRoutes } from './routes/consultas.js';
import { registerHealthRoute } from './routes/health.js';
import { registerReporteRoutes } from './routes/reportes.js';
import { registerSolicitudRoutes } from './routes/solicitudes.js';
import { registerLegalRoutes } from './routes/legal.js';
import { registerAuthRoutes } from './routes/auth.js';

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(helmet);
  // CORS: en producción solo los dominios configurados en WEB_ORIGIN; en dev,
  // se permite cualquier origen para facilitar pruebas locales.
  await app.register(cors, {
    origin: config.isProd ? (config.corsOrigins.length ? config.corsOrigins : false) : true,
  });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(rateLimit, {
    max: config.rateLimitPerMinute,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => ({
      error: 'RATE_LIMITED',
      message: 'Demasiadas consultas. Intenta nuevamente más tarde.',
      retryAfter: Math.ceil(ctx.ttl / 1000),
    }),
  });

  const redis = createRedis();
  const queue = createQueue();
  const service = new ConsultaService(redis, queue);

  registerHealthRoute(app, redis);
  registerAuthRoutes(app);
  // BASIC es gratis y abierto (identidad + semáforo de riesgo): cualquiera puede
  // consultar. El cobro de PRO/ULTRA se hará por reporte (pago → tier en Supabase),
  // no bloqueando la consulta. Protegido por rate-limit + caché por placa.
  registerConsultaRoutes(app, service);
  registerReporteRoutes(app, service);
  registerSolicitudRoutes(app);
  registerLegalRoutes(app);

  app.addHook('onClose', async () => {
    await queue.close();
    redis.disconnect();
  });

  return app;
}
