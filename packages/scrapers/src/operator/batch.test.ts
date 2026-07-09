import { describe, it, expect } from 'vitest';
import { orchestrateBatch, type OrchJob, type Lane } from './batch.js';
import type { OperatorSourceResult } from './sources.js';

const res = (source: string): OperatorSourceResult =>
  ({ source, label: source, category: 'OTRO', status: 'ENCONTRADO', summary: '', ms: 1 });
const mkJobs = (plates: string[], sources: string[]): OrchJob[] =>
  plates.map((plate, i) => ({ id: `j${i}`, plate, tier: 'PRO', sources: [...sources], outDir: '/tmp', results: [], percent: 0, done: false }));
/** Carril que reporta `source` para todas sus placas de inmediato. */
const lane = (source: string): Lane => async (plates, report) => { for (const p of plates) report(p.plate, res(source)); };

describe('orchestrateBatch', () => {
  it('adjunta cada fuente a su pedido y cierra cuando están todas', async () => {
    const jobs = mkJobs(['P1', 'P2'], ['sunarp', 'historial', 'sat']);
    const done: string[] = [];
    await orchestrateBatch(jobs, {
      lanes: [{ sources: ['sunarp'], run: lane('SUNARP') }, { sources: ['historial'], run: lane('HISTORIAL') }, { sources: ['sat'], run: lane('sat') }],
      onJobDone: async (j) => { done.push(j.plate); },
    });
    expect(done.sort()).toEqual(['P1', 'P2']);
    expect(jobs.every((j) => j.done && j.percent === 100 && j.results.length === 3)).toBe(true);
  });

  it('entrega ASAP: cierra P1 antes de que el carril lento termine P2', async () => {
    const jobs = mkJobs(['P1', 'P2'], ['a', 'b']);
    const order: string[] = [];
    const slow: Lane = async (plates, report) => {
      report('P1', res('b')); // P1 ya tiene a+b → debe cerrarse ya
      await new Promise((r) => setTimeout(r, 25));
      report('P2', res('b'));
    };
    await orchestrateBatch(jobs, {
      lanes: [{ sources: ['a'], run: lane('a') }, { sources: ['b'], run: slow }],
      onJobDone: async (j) => { order.push(j.plate); },
    });
    expect(order).toEqual(['P1', 'P2']); // P1 se entregó antes que P2
  });

  it('cierra parcial si a una fuente le falta carril', async () => {
    const jobs = mkJobs(['P1'], ['a', 'b']); // 'b' sin carril
    const done: OrchJob[] = [];
    await orchestrateBatch(jobs, {
      lanes: [{ sources: ['a'], run: lane('a') }],
      onJobDone: async (j) => { done.push(j); },
    });
    expect(done).toHaveLength(1);
    expect(jobs[0]!.done).toBe(true);
    expect(jobs[0]!.results.length).toBe(1); // parcial: solo 'a'
  });

  it('respeta el tope de carriles simultáneos', async () => {
    const jobs = mkJobs(['P1'], ['a', 'b', 'c', 'd']);
    let running = 0, peak = 0;
    const busy = (source: string): Lane => async (plates, report) => {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      for (const p of plates) report(p.plate, res(source));
      running--;
    };
    await orchestrateBatch(jobs, {
      lanes: ['a', 'b', 'c', 'd'].map((s) => ({ sources: [s], run: busy(s) })),
      laneConcurrency: 2,
      onJobDone: async () => {},
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(jobs[0]!.results.length).toBe(4);
  });
});
