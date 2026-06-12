import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { CONSULTA_QUEUE, type ConsultaJobData } from '@app/shared';
import { BrowserPool } from '@app/scrapers';
import { config } from './config.js';
import { runSunarp } from './processors/sunarp.js';
import { runSbs } from './processors/sbs.js';
import { runApeseg } from './processors/apeseg.js';
import { assembleAndPersist } from './assemble.js';
import { demoSources } from './demo.js';

const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const pool = new BrowserPool();

const redisUrl = new URL(config.redisUrl);
const bullConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  ...(redisUrl.password ? { password: redisUrl.password } : {}),
};

const worker = new Worker(
  CONSULTA_QUEUE,
  async (job) => {
    const data = job.data as ConsultaJobData;
    await connection.set(
      `job:${data.jobId}`,
      JSON.stringify({ jobId: data.jobId, status: 'RUNNING', report: null }),
      'EX',
      600,
    );

    let sources;
    if (config.demoMode) {
      // Modo demo: datos de ejemplo, sin scraping ni CAPTCHA.
      sources = demoSources(data.plateNormalized);
    } else {
      // Scrapers de las fuentes MVP en paralelo; cada uno degrada por separado.
      const settled = await Promise.allSettled([
        runSunarp(pool, data.plateNormalized),
        runSbs(pool, data.plateNormalized),
        runApeseg(pool, data.plateNormalized),
      ]);
      sources = settled
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof runSunarp>>> => r.status === 'fulfilled')
        .flatMap((r) => r.value);
    }

    const report = await assembleAndPersist(connection, data, sources);
    return { status: report.status };
  },
  { connection: bullConnection, concurrency: config.concurrency },
);

worker.on('completed', (job) => console.log(`[worker] job ${job.id} completado`));
worker.on('failed', (job, err) => console.error(`[worker] job ${job?.id} falló:`, err.message));

const shutdown = async () => {
  await worker.close();
  await pool.close();
  connection.disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log(`[worker] escuchando la cola "${CONSULTA_QUEUE}" (concurrency=${config.concurrency})`);
