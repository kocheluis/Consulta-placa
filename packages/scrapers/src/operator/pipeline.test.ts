import { describe, it, expect } from 'vitest';
import { Pipeline, type PipelineJob, type PipelineLane } from './pipeline.js';
import type { OperatorSourceResult } from './sources.js';

const res = (source: string): OperatorSourceResult =>
  ({ source, label: source, category: 'OTRO', status: 'ENCONTRADO', summary: '', ms: 1 });
const job = (id: string, plate: string, sources: string[]): PipelineJob =>
  ({ id, plate, tier: 'PRO', sources: [...sources], outDir: '/tmp', results: [], percent: 0, done: false });

/** Carril de vida larga que, por cada placa que jala, reporta `source` de inmediato. */
const lane = (source: string, coverSources: string[] = [source]): PipelineLane => ({
  sources: coverSources,
  run: async (take, report) => { for (;;) { const it = await take(); if (!it) break; report(it.plate, res(source)); } },
});

describe('Pipeline (motor continuo)', () => {
  it('cierra un pedido cuando junta todas sus fuentes', async () => {
    const done: string[] = [];
    const p = new Pipeline({
      lanes: [lane('SUNARP', ['sunarp']), lane('HISTORIAL', ['historial']), lane('sat', ['sat'])],
      onJobDone: async (j) => { done.push(j.plate); },
    });
    p.submit(job('j1', 'P1', ['sunarp', 'historial', 'sat']));
    await p.close();
    expect(done).toEqual(['P1']);
  });

  it('admite pedidos NUEVOS mientras ya corre (streaming, sin frontera de lote)', async () => {
    const done: string[] = [];
    const p = new Pipeline({
      lanes: [lane('a', ['a']), lane('b', ['b'])],
      onJobDone: async (j) => { done.push(j.plate); },
    });
    p.submit(job('j1', 'P1', ['a', 'b']));
    // Simula un pedido que llega "después": el pipeline lo admite sin esperar a P1.
    await new Promise((r) => setTimeout(r, 5));
    p.submit(job('j2', 'P2', ['a', 'b']));
    await p.close();
    expect(done.sort()).toEqual(['P1', 'P2']);
  });

  it('ENTREGA ASAP: cierra P1 aunque el carril lento siga con P2', async () => {
    const order: string[] = [];
    const fast = lane('a', ['a']);
    // Carril lento NO-bloqueante: reporta P1 de inmediato, pero difiere P2 sin frenar la cola →
    // P1 junta a+b y se cierra antes de que P2 reciba su 'b'.
    const slow: PipelineLane = {
      sources: ['b'],
      run: async (take, report) => {
        const pending: Promise<void>[] = [];
        for (;;) {
          const it = await take(); if (!it) break;
          if (it.plate === 'P2') pending.push(new Promise((r) => setTimeout(() => { report('P2', res('b')); r(); }, 30)));
          else report(it.plate, res('b'));
        }
        await Promise.all(pending);
      },
    };
    const p = new Pipeline({ lanes: [fast, slow], onJobDone: async (j) => { order.push(j.plate); } });
    p.submit(job('j1', 'P1', ['a', 'b']));
    p.submit(job('j2', 'P2', ['a', 'b']));
    await p.close();
    expect(order).toEqual(['P1', 'P2']); // P1 se entregó antes que el lento P2
  });

  it('enruta por fuente: BASIC (sin historial) no toca el carril de historial', async () => {
    let historialHits = 0;
    const done: string[] = [];
    const histLane: PipelineLane = {
      sources: ['historial'],
      run: async (take, report) => { for (;;) { const it = await take(); if (!it) break; historialHits++; report(it.plate, res('HISTORIAL')); } },
    };
    const p = new Pipeline({
      lanes: [lane('sunarp', ['sunarp']), lane('apeseg-soat', ['apeseg-soat']), lane('mtc-citv', ['mtc-citv']), histLane],
      onJobDone: async (j) => { done.push(j.plate); },
    });
    p.submit(job('b1', 'B1', ['sunarp', 'apeseg-soat', 'mtc-citv'])); // BASIC
    await p.close();
    expect(done).toEqual(['B1']);
    expect(historialHits).toBe(0); // el carril de historial nunca recibió la placa BASIC
  });

  it('dedup: una placa ya en vuelo no se admite dos veces', async () => {
    const p = new Pipeline({ lanes: [lane('a', ['a'])], onJobDone: async () => { await new Promise((r) => setTimeout(r, 30)); } });
    expect(p.submit(job('j1', 'P1', ['a']))).toBe(true);
    expect(p.submit(job('j2', 'P1', ['a']))).toBe(false); // misma placa → rechazado
    await p.close();
  });

  it('cierre PARCIAL: pedido con una fuente sin carril se entrega al cerrar', async () => {
    const done: PipelineJob[] = [];
    const p = new Pipeline({ lanes: [lane('a', ['a'])], onJobDone: async (j) => { done.push(j); } });
    p.submit(job('j1', 'P1', ['a', 'b'])); // 'b' no tiene carril → nunca completa solo
    await p.close();
    expect(done).toHaveLength(1);
    expect(done[0]!.results.length).toBe(1); // parcial: solo 'a'
  });
});
