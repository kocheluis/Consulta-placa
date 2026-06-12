import { Redis } from 'ioredis';
import {
  buildReport,
  cacheKeys,
  ttlForSection,
  SectionStatus,
  MVP_SECTIONS,
  type SourceResult,
  type Report,
  type ConsultaJobData,
} from '@app/shared';
import { prisma } from '@app/db';
import { config } from './config.js';

const JOB_STATE_TTL = 600;

/**
 * Ensambla el reporte a partir de los SourceResult, lo persiste (Vehicle,
 * OwnerRecord con retención, Report, SectionResult), actualiza el estado del job
 * y escribe la caché por placa.
 */
export async function assembleAndPersist(
  redis: Redis,
  job: ConsultaJobData,
  sources: SourceResult[],
): Promise<Report> {
  const generatedAt = new Date().toISOString();
  const report = buildReport({
    id: job.jobId,
    plateDisplay: job.plateDisplay,
    plateNormalized: job.plateNormalized,
    generatedAt,
    sources,
  });

  // Persistencia del vehículo y titular (con retención corta del nombre).
  let vehicleId: string | null = null;
  if (report.vehicle) {
    const v = report.vehicle;
    const vehicle = await prisma.vehicle.upsert({
      where: { plateNormalized: job.plateNormalized },
      create: {
        plateNormalized: job.plateNormalized,
        plateDisplay: v.plateDisplay,
        platePrevious: v.platePrevious,
        brand: v.brand,
        model: v.model,
        year: v.year,
        color: v.color,
        serie: v.serie,
        vin: v.vin,
        engineNumber: v.engineNumber,
        stolenAlert: v.stolenAlert,
      },
      update: {
        plateDisplay: v.plateDisplay,
        platePrevious: v.platePrevious,
        brand: v.brand,
        model: v.model,
        year: v.year,
        color: v.color,
        serie: v.serie,
        vin: v.vin,
        engineNumber: v.engineNumber,
        stolenAlert: v.stolenAlert,
      },
    });
    vehicleId = vehicle.id;

    if (v.owner) {
      const expiresAt = new Date(Date.now() + config.ownerRetentionDays * 86400_000);
      await prisma.ownerRecord.create({
        data: { vehicleId: vehicle.id, ownerName: v.owner.name, expiresAt },
      });
    }
  }

  // Persistir Report + secciones + actualizar job.
  const dbReport = await prisma.report.create({
    data: {
      id: report.id,
      vehicleId,
      plateNormalized: job.plateNormalized,
      status: report.status,
      sections: {
        create: report.sections.map((s) => ({
          kind: s.kind,
          source: s.source,
          status: s.status,
          fetchedAt: s.fetchedAt ? new Date(s.fetchedAt) : null,
          errorReason: s.errorReason ?? null,
          payload: s.payload === undefined ? undefined : (s.payload as object),
        })),
      },
    },
  });

  await prisma.queryJob.update({
    where: { id: job.jobId },
    data: { status: report.status === 'PARTIAL' ? 'PARTIAL' : 'COMPLETED', completedAt: new Date(), reportId: dbReport.id },
  });

  // Escritura de caché con el TTL mínimo entre las secciones MVP disponibles.
  const ttls = report.sections
    .filter((s) => MVP_SECTIONS.includes(s.kind) && s.status === SectionStatus.AVAILABLE)
    .map((s) => ttlForSection(s.kind, config.ttl))
    .filter((t) => t > 0);
  const ttl = ttls.length ? Math.min(...ttls) : 0;
  if (ttl > 0) {
    await redis.set(
      cacheKeys.report(job.plateNormalized),
      JSON.stringify({ ...report, _storedTtl: ttl }),
      'EX',
      ttl,
    );
  }

  // Estado del job para polling de la API.
  const jobStatus = report.status === 'PARTIAL' ? 'PARTIAL' : 'COMPLETED';
  await redis.set(
    `job:${job.jobId}`,
    JSON.stringify({ jobId: job.jobId, status: jobStatus, report }),
    'EX',
    JOB_STATE_TTL,
  );

  return report;
}
