import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@app/db';

const CredentialsSchema = z.object({
  email: z.string().email('Correo inválido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
});

export function registerAuthRoutes(app: FastifyInstance): void {
  // Registro: crea la cuenta SIN PRO y SIN activar (FR — PRO requiere activación).
  app.post('/api/v1/auth/register', async (request, reply) => {
    const parsed = CredentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID', message: parsed.error.issues[0]?.message });
    }
    const exists = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (exists) {
      return reply.status(409).send({ error: 'EMAIL_TAKEN', message: 'El correo ya está registrado' });
    }
    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    const user = await prisma.user.create({
      data: { email: parsed.data.email, passwordHash },
    });
    return reply.status(201).send({ id: user.id, email: user.email, isPro: user.isPro, isActive: user.isActive });
  });

  // Login: devuelve un JWT si las credenciales son válidas.
  app.post('/api/v1/auth/login', async (request, reply) => {
    const parsed = CredentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID', message: parsed.error.issues[0]?.message });
    }
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return reply.status(401).send({ error: 'BAD_CREDENTIALS', message: 'Correo o contraseña incorrectos' });
    }
    const token = await reply.jwtSign({ sub: user.id }, { expiresIn: '7d' });
    return reply.send({ token, user: { id: user.id, email: user.email, isPro: user.isPro, isActive: user.isActive } });
  });

  // Estado de la cuenta autenticada.
  app.get('/api/v1/auth/me', { preHandler: requireAuth }, async (request, reply) => {
    const user = await loadUser(request);
    if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Sesión inválida' });
    return reply.send({ id: user.id, email: user.email, isPro: user.isPro, isActive: user.isActive });
  });
}

async function loadUser(request: FastifyRequest) {
  const payload = request.user as { sub?: string } | undefined;
  if (!payload?.sub) return null;
  return prisma.user.findUnique({ where: { id: payload.sub } });
}

/** Exige sesión válida (JWT). */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Inicia sesión' });
  }
}

/** Exige sesión válida + cuenta PRO activa (gate del reporte automático). */
export async function requirePro(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;
  const user = await loadUser(request);
  if (!user) {
    return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Sesión inválida' });
  }
  if (!user.isPro || !user.isActive) {
    return reply
      .status(403)
      .send({ error: 'PRO_REQUIRED', message: 'El reporte automático requiere una cuenta PRO activa.' });
  }
}
