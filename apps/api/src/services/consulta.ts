import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import {
  CONSULTA_QUEUE,
  assertValidPlate,
  formatPlateDisplay,
  type ConsultaJobData,
  type ConsultaResponse,
  type Report,
} from '@app/shared';
import { prisma } from '@app/db';
import { ReportCache } from './cache.js';
import { config } from '../config.js';

/** Estado de job compartido API↔worker (Redis). TTL corto. */
const JOB_STATE_TTL = 600;
const jobStateKey = (jobId: string) => `job:${jobId}`;

interface JobState {
  jobId: string;
  status: ConsultaResponse['status'];
  report: Report | null;
}

export class ConsultaService {
  private readonly cache: ReportCache;

  constructor(
    private readonly redis: Redis,
    private readonly queue: Queue,
  ) {
    this.cache = new ReportCache(redis);
  }

  /** Crea una consulta: cache-hit → reporte; miss → encola job y devuelve jobId. */
  async create(
    placaInput: string,
    forceRefresh: boolean,
    origin: string,
  ): Promise<{ http: 200 | 202; body: ConsultaResponse }> {
    const plateNormalized = assertValidPlate(placaInput); // lanza si inválida (FR-002)
    const plateDisplay = formatPlateDisplay(plateNormalized);

    if (forceRefresh) {
      await this.cache.invalidate(plateNormalized);
    } else {
      const hit = await this.cache.get(plateNormalized);
      if (hit) {
        await this.audit(plateNormalized, origin, hit.report);
        return {
          http: 200,
          body: { jobId: null, status: 'COMPLETED', cached: true, report: hit.report },
        };
      }
    }

    const jobId = randomUUID();
    await prisma.queryJob.create({
      data: { id: jobId, plateNormalized, status: 'PENDING', forceRefresh, origin },
    });
    await this.setJobState({ jobId, status: 'PENDING', report: null });

    const data: ConsultaJobData = { jobId, plateNormalized, plateDisplay, forceRefresh, origin };
    await this.queue.add('consulta', data, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });

    return { http: 202, body: { jobId, status: 'PENDING', cached: false, report: null } };
  }

  /** Estado/resultado de un job para polling. */
  async getJob(jobId: string): Promise<ConsultaResponse | null> {
    const state = await this.getJobState(jobId);
    if (!state) return null;
    return { jobId, status: state.status, cached: false, report: state.report };
  }

  private async setJobState(state: JobState): Promise<void> {
    await this.redis.set(jobStateKey(state.jobId), JSON.stringify(state), 'EX', JOB_STATE_TTL);
  }

  private async getJobState(jobId: string): Promise<JobState | null> {
    const raw = await this.redis.get(jobStateKey(jobId));
    return raw ? (JSON.parse(raw) as JobState) : null;
  }

  /** Registro de auditoría del tratamiento de datos personales (FR-053). */
  private async audit(plateNormalized: string, origin: string, report: Report): Promise<void> {
    await prisma.auditLog.create({
      data: {
        plateNormalized,
        origin,
        purpose: 'Consulta de verificación vehicular',
        accessedOwnerData: Boolean(report.vehicle?.owner),
      },
    });
  }
}

export function createRedis(): Redis {
  return new Redis(config.redisUrl, { maxRetriesPerRequest: null });
}

/** Opciones de conexión para BullMQ (evita compartir la instancia de ioredis). */
export function redisConnectionOptions(): { host: string; port: number; password?: string } {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
  };
}

export function createQueue(): Queue {
  return new Queue(CONSULTA_QUEUE, { connection: redisConnectionOptions() });
}
