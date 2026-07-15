import { describe, it, expect } from 'vitest';
import { AsyncQueue } from './async-queue.js';

describe('AsyncQueue', () => {
  it('devuelve items ya encolados en orden FIFO', async () => {
    const q = new AsyncQueue<number>();
    q.push(1); q.push(2); q.push(3);
    expect(q.size).toBe(3);
    expect(await q.take()).toBe(1);
    expect(await q.take()).toBe(2);
    expect(await q.take()).toBe(3);
  });

  it('un take que espera se resuelve cuando llega un push posterior', async () => {
    const q = new AsyncQueue<string>();
    const p = q.take(); // espera: aún no hay items
    expect(q.waiting).toBe(1);
    q.push('hola');
    expect(await p).toBe('hola');
  });

  it('reparte un item a UN solo consumidor (FIFO de esperas)', async () => {
    const q = new AsyncQueue<number>();
    const a = q.take();
    const b = q.take();
    q.push(10); q.push(20);
    expect(await a).toBe(10);
    expect(await b).toBe(20);
  });

  it('close() despierta a los que esperan con null y los take futuros dan null', async () => {
    const q = new AsyncQueue<number>();
    const waiting = q.take();
    q.close();
    expect(await waiting).toBeNull();
    expect(await q.take()).toBeNull();
    expect(q.isClosed).toBe(true);
  });

  it('tras close() aún se drenan los items ya encolados antes del null', async () => {
    const q = new AsyncQueue<number>();
    q.push(1); q.push(2);
    q.close();
    expect(await q.take()).toBe(1);
    expect(await q.take()).toBe(2);
    expect(await q.take()).toBeNull();
  });

  it('push tras close() es no-op', async () => {
    const q = new AsyncQueue<number>();
    q.close();
    q.push(99);
    expect(q.size).toBe(0);
    expect(await q.take()).toBeNull();
  });

  it('N workers drenan todos los items sin duplicar', async () => {
    const q = new AsyncQueue<number>();
    const seen: number[] = [];
    const total = 20;
    const worker = async (): Promise<void> => {
      for (;;) { const v = await q.take(); if (v === null) break; seen.push(v); }
    };
    const workers = [worker(), worker(), worker()];
    for (let i = 0; i < total; i++) q.push(i);
    q.close();
    await Promise.all(workers);
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: total }, (_, i) => i));
  });
});
