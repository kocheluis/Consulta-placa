import type { OperatorSourceResult } from './sources.js';

/**
 * Orquestador del LOTE. Recibe N pedidos (cada uno con su lista de fuentes según el tier) y una
 * lista de CARRILES (uno por fuente/grupo: historial-pool, cada fuente ligera, sunarp, atu…).
 * Corre los carriles en paralelo con un TOPE de carriles simultáneos (RAM de 4 GB), adjunta cada
 * resultado a su pedido y —apenas un pedido tiene TODAS sus fuentes— dispara `onJobDone`
 * (ensamblar/publicar/entregar) SIN esperar a que termine el lote → entrega por-placa ASAP.
 *
 * Los carriles se INYECTAN (no se acopla a Playwright/SPRL) → totalmente testeable. La glue real
 * (runHistorialPool, runLightLane, scrapeSunarpViaCdp…) se arma en el servidor.
 */
export interface OrchJob {
  id: string;
  plate: string;
  tier: string;
  /** Fuentes de ESTE pedido (por su tier). */
  sources: string[];
  outDir: string;
  /** Se va llenando conforme cada carril reporta. */
  results: OperatorSourceResult[];
  percent: number;
  done: boolean;
}

export type LaneReport = (plate: string, result: OperatorSourceResult) => void;
export type Lane = (plates: Array<{ plate: string; outDir: string }>, report: LaneReport) => Promise<void>;

export interface OrchestrateOpts {
  /** Carriles a correr; cada uno declara qué fuente(s) cubre. */
  lanes: Array<{ sources: string[]; run: Lane }>;
  /** Máximo de carriles simultáneos (tope de RAM). Default 3. */
  laneConcurrency?: number;
  /** Un pedido completó TODAS sus fuentes → ensamblar/publicar/entregar. */
  onJobDone: (job: OrchJob) => Promise<void>;
  /** Avance (para el % de la consola). */
  onProgress?: (job: OrchJob) => void;
}

const norm = (s: string): string => s.toLowerCase().replace(/_/g, '-');

/** Corre `fn` sobre items con un máximo de `limit` en paralelo (pool de workers). */
async function runWithLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  const worker = async (): Promise<void> => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, worker));
}

export async function orchestrateBatch(jobs: OrchJob[], opts: OrchestrateOpts): Promise<void> {
  const byPlate = new Map(jobs.map((j) => [j.plate, j]));
  const finalizers: Promise<void>[] = [];
  const finalize = (job: OrchJob): void => {
    if (job.done) return;
    job.done = true;
    job.percent = 100;
    finalizers.push(opts.onJobDone(job));
  };
  const report: LaneReport = (plate, result) => {
    const job = byPlate.get(plate);
    if (!job || job.done) return;
    if (!job.results.some((r) => norm(r.source) === norm(result.source))) job.results.push(result);
    job.percent = Math.min(99, Math.round((job.results.length / Math.max(1, job.sources.length)) * 100));
    opts.onProgress?.(job);
    if (job.results.length >= job.sources.length) finalize(job); // ASAP: todas sus fuentes llegaron
  };

  // Cada carril corre sobre las placas cuyo pedido incluye alguna de las fuentes del carril.
  const tasks = opts.lanes
    .map((lane) => ({
      lane,
      plates: jobs.filter((j) => j.sources.some((s) => lane.sources.includes(s))).map((j) => ({ plate: j.plate, outDir: j.outDir })),
    }))
    .filter((t) => t.plates.length > 0);

  await runWithLimit(tasks, opts.laneConcurrency ?? 3, async (t) => {
    try { await t.lane.run(t.plates, report); }
    catch { /* un carril caído no tumba el lote: los pedidos incompletos se cierran parciales abajo */ }
  });

  // Cierre parcial: pedidos que no completaron todas sus fuentes (carril caído) → entregar lo que haya.
  for (const job of jobs) finalize(job);
  await Promise.all(finalizers);
}
