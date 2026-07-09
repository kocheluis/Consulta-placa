import { describe, it, expect, beforeAll } from 'vitest';
import { runHistorialPool, type HistorialResult } from './historial-pool.js';
import type { SprlSlot } from './sprl-slots.js';

// 2 slots con credenciales → sprlSlots() (leído al ejecutar) devuelve 2 workers.
beforeAll(() => {
  process.env.SPRL_USER = 'a'; process.env.SPRL_PASS = 'x';
  process.env.SPRL_USER_2 = 'b'; process.env.SPRL_PASS_2 = 'y';
});

const ok = (): HistorialResult =>
  ({ ok: true, sede: '', vehiculo: null, titulos: [], timeline: [], flags: { aseguradora: false, remate: false, financiera: false, gravamen: false, embargo: false } }) as HistorialResult;
const lockedRes = (): HistorialResult => ({ ...ok(), ok: false, locked: true }) as HistorialResult;
const fakeOpen = async () => ({ browser: null, close: async () => {} });

describe('runHistorialPool', () => {
  it('reparte todas las placas entre 2 workers y abre el browser 1 vez por slot (reúso)', async () => {
    const opens: number[] = [];
    const seen: string[] = [];
    const plates = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
    const res = await runHistorialPool(plates, {
      concurrency: 2,
      openBrowser: async (slot: SprlSlot) => { opens.push(slot.index); return fakeOpen(); },
      runOne: async (plate) => { seen.push(plate); return ok(); },
    });
    expect(res.size).toBe(6);
    expect([...res.values()].every((r) => r.result.ok)).toBe(true);
    expect(opens.length).toBe(2); // 1 apertura por slot, NO una por placa
    expect(seen.sort()).toEqual([...plates].sort());
  });

  it('si todos los slots se bloquean, cada worker atiende 1 placa y se detiene', async () => {
    const res = await runHistorialPool(['P1', 'P2', 'P3', 'P4'], {
      concurrency: 2,
      openBrowser: fakeOpen,
      runOne: async () => lockedRes(),
    });
    expect(res.size).toBe(2); // 2 workers × 1 placa; el resto queda sin atender
  });

  it('degrada a vacío si no hay credenciales SPRL', async () => {
    const saved = [process.env.SPRL_USER, process.env.SPRL_PASS, process.env.SPRL_USER_2, process.env.SPRL_PASS_2];
    delete process.env.SPRL_USER; delete process.env.SPRL_PASS;
    delete process.env.SPRL_USER_2; delete process.env.SPRL_PASS_2;
    const res = await runHistorialPool(['P1'], { openBrowser: fakeOpen, runOne: async () => ok() });
    expect(res.size).toBe(0);
    [process.env.SPRL_USER, process.env.SPRL_PASS, process.env.SPRL_USER_2, process.env.SPRL_PASS_2] = saved;
  });
});
