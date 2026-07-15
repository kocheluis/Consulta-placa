import { AsyncQueue } from './async-queue.js';
import type { OperatorSourceResult } from './sources.js';

/**
 * MOTOR CONTINUO (streaming). A diferencia del motor por lotes (`orchestrateBatch`), que recibe un
 * conjunto FIJO de pedidos y libera el motor solo cuando TODOS terminan, el Pipeline mantiene
 * carriles de VIDA LARGA que jalan de un canal (`AsyncQueue`) y admite pedidos NUEVOS en cualquier
 * momento con `submit()`. El dispatcher (operator-server) reclama pedidos y los inyecta sin esperar
 * a que terminen los anteriores → el motor "recibe y encola casi de inmediato".
 *
 * - Cada carril declara qué fuente(s) cubre. `submit(job)` empuja la placa SOLO a los carriles cuyas
 *   fuentes intersecan las del pedido (BASIC corre menos fuentes que PRO).
 * - Apenas un pedido junta TODAS sus fuentes → `onJobDone` (ensamblar/publicar/entregar) ASAP, sin
 *   esperar al resto. Igual que la entrega por-placa del lote, pero continua.
 * - Los carriles se INYECTAN (historial-pool, carril ligero…) → 100% testeable sin Chrome/SPRL.
 * - El tope de RAM NO vive aquí: lo pone el dispatcher con `MAX_INFLIGHT` (cuántos pedidos admite a
 *   la vez) y cada carril con su propia concurrencia interna (workers/navegadores).
 */
export interface PipelineJob {
  id: string;
  plate: string;
  tier: string;
  /** Fuentes de ESTE pedido (por su tier). */
  sources: string[];
  outDir: string;
  /** Se llena conforme cada carril reporta. */
  results: OperatorSourceResult[];
  percent: number;
  done: boolean;
}

/** Item que viaja por el canal de un carril. Lleva las fuentes del pedido para que el carril ligero
 *  sepa QUÉ fuentes correr por placa (BASIC vs PRO difieren). */
export interface PipelineItem {
  plate: string;
  outDir: string;
  sources: string[];
}
export type PipelineReport = (plate: string, result: OperatorSourceResult) => void;
export type PipelineTake = () => Promise<PipelineItem | null>;

export interface PipelineLane {
  /** Fuentes que cubre este carril (para enrutar placas y contar el cierre). */
  sources: string[];
  /** Worker(s) de vida larga: jala del canal con `take` hasta que devuelva null (canal cerrado). */
  run: (take: PipelineTake, report: PipelineReport) => Promise<void>;
}

export interface PipelineOpts {
  lanes: PipelineLane[];
  /** Un pedido juntó TODAS sus fuentes → ensamblar/publicar/entregar. */
  onJobDone: (job: PipelineJob) => Promise<void>;
  onProgress?: (job: PipelineJob) => void;
  /** Normaliza el nombre de fuente para deduplicar (SUNARP vs sunarp vs SAT_CAPTURA/sat-captura). */
  norm?: (s: string) => string;
  /** Tope por pedido: si no juntó sus fuentes en este tiempo (p. ej. historial colgado/ambos slots
   *  bloqueados), se cierra PARCIAL con lo que haya. 0/undefined = sin tope. */
  jobTimeoutMs?: number;
}

const defaultNorm = (s: string): string => s.toLowerCase().replace(/_/g, '-');

export class Pipeline {
  private readonly channels: Array<{ lane: PipelineLane; q: AsyncQueue<PipelineItem> }>;
  private readonly workers: Promise<void>[];
  private readonly byPlate = new Map<string, PipelineJob>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly finalizers = new Set<Promise<void>>();
  private readonly norm: (s: string) => string;

  constructor(private readonly opts: PipelineOpts) {
    this.norm = opts.norm ?? defaultNorm;
    const report: PipelineReport = (plate, result) => this.onReport(plate, result);
    this.channels = opts.lanes.map((lane) => ({ lane, q: new AsyncQueue<PipelineItem>() }));
    // Arranca cada carril UNA vez (vida larga). Un carril que revienta no tumba el resto: los
    // pedidos que no completen sus fuentes quedan sin cerrar hasta `close()` (cierre parcial).
    this.workers = this.channels.map(({ lane, q }) => lane.run(() => q.take(), report).catch(() => {}));
  }

  /** ¿Cuántos pedidos hay en vuelo (admitidos y sin terminar)? El dispatcher lo usa para el cap. */
  inFlight(): number { return this.byPlate.size; }
  isInFlight(plate: string): boolean { return this.byPlate.has(plate); }

  /** Cancela un pedido en vuelo: lo deja de rastrear SIN entregarlo (el caller marca la cola). Las
   *  fuentes que sigan corriendo para esa placa terminan solas y sus reportes se ignoran (onReport ve
   *  el job ya fuera). Libera cupo (inFlight baja) → el dispatcher admite el siguiente. */
  cancel(plate: string): PipelineJob | null {
    const job = this.byPlate.get(plate);
    if (!job) return null;
    job.done = true;
    this.byPlate.delete(plate);
    const timer = this.timers.get(plate);
    if (timer) { clearTimeout(timer); this.timers.delete(plate); }
    return job;
  }

  /** Admite un pedido: lo empuja a los carriles que cubren sus fuentes. Devuelve false si esa placa
   *  ya está en vuelo (dedup: evita correr la misma placa dos veces a la vez). */
  submit(job: PipelineJob): boolean {
    if (this.byPlate.has(job.plate)) return false;
    this.byPlate.set(job.plate, job);
    const item: PipelineItem = { plate: job.plate, outDir: job.outDir, sources: job.sources };
    let routed = 0;
    for (const { lane, q } of this.channels) {
      if (job.sources.some((s) => lane.sources.includes(s))) { q.push(item); routed++; }
    }
    // Ninguna fuente del pedido tiene carril → nada que correr; ciérralo parcial de una vez.
    if (routed === 0) { this.finalize(job); return true; }
    if (this.opts.jobTimeoutMs && this.opts.jobTimeoutMs > 0) {
      const timer = setTimeout(() => this.finalize(job), this.opts.jobTimeoutMs);
      timer.unref?.();
      this.timers.set(job.plate, timer);
    }
    return true;
  }

  private onReport(plate: string, result: OperatorSourceResult): void {
    const job = this.byPlate.get(plate);
    if (!job || job.done) return;
    if (!job.results.some((r) => this.norm(r.source) === this.norm(result.source))) job.results.push(result);
    job.percent = Math.min(99, Math.round((job.results.length / Math.max(1, job.sources.length)) * 100));
    this.opts.onProgress?.(job);
    if (job.results.length >= job.sources.length) this.finalize(job);
  }

  private finalize(job: PipelineJob): void {
    if (job.done) return;
    job.done = true;
    job.percent = 100;
    this.byPlate.delete(job.plate);
    const timer = this.timers.get(job.plate);
    if (timer) { clearTimeout(timer); this.timers.delete(job.plate); }
    const pr = Promise.resolve(this.opts.onJobDone(job)).catch(() => {}).finally(() => this.finalizers.delete(pr));
    this.finalizers.add(pr);
  }

  /** Cierra todos los canales (los workers terminan), cierra PARCIAL lo que quedó a medias y espera
   *  a que terminen las entregas en curso. Para apagado limpio. */
  async close(): Promise<void> {
    for (const { q } of this.channels) q.close();
    await Promise.all(this.workers);
    for (const job of this.byPlate.values()) this.finalize(job); // cierre parcial de los incompletos
    await Promise.all([...this.finalizers]);
  }
}
