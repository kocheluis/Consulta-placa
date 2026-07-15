import { describe, it, expect, beforeAll } from 'vitest';
import { runHistorialPool, runHistorialPoolLive, type HistorialResult, type HistorialTask } from './historial-pool.js';
import { AsyncQueue } from './async-queue.js';
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

describe('runHistorialPoolLive (pool continuo)', () => {
  it('jala del canal en caliente, reúsa el browser por slot y admite placas nuevas', async () => {
    const opens: number[] = [];
    const seen: string[] = [];
    const chan = new AsyncQueue<HistorialTask>();
    const done = runHistorialPoolLive(() => chan.take(), {
      concurrency: 2,
      openBrowser: async (slot: SprlSlot) => { opens.push(slot.index); return fakeOpen(); },
      runOne: async (plate) => { seen.push(plate); return ok(); },
      onResult: () => {},
    });
    chan.push({ plate: 'P1' }); chan.push({ plate: 'P2' });
    await new Promise((r) => setTimeout(r, 10));
    chan.push({ plate: 'P3' }); // llega DESPUÉS de arrancar → el pool continuo lo toma igual
    await new Promise((r) => setTimeout(r, 10));
    chan.close();
    await done;
    expect(opens.length).toBe(2); // 1 apertura por slot, no una por placa
    expect(seen.sort()).toEqual(['P1', 'P2', 'P3']);
  });

  it('reporta cada placa vía onResult apenas termina', async () => {
    const reported: string[] = [];
    const chan = new AsyncQueue<HistorialTask>();
    const done = runHistorialPoolLive(() => chan.take(), {
      concurrency: 2, openBrowser: fakeOpen, runOne: async () => ok(),
      onResult: (r) => reported.push(r.plate),
    });
    chan.push({ plate: 'P1' }); chan.push({ plate: 'P2' });
    await new Promise((r) => setTimeout(r, 10));
    chan.close();
    await done;
    expect(reported.sort()).toEqual(['P1', 'P2']);
  });

  it('failover (conc 1): si el slot caliente se bloquea, REINTENTA la placa en el siguiente slot', async () => {
    const opens: number[] = [];
    const seenBy: Array<[string, number]> = [];
    const chan = new AsyncQueue<HistorialTask>();
    const done = runHistorialPoolLive(() => chan.take(), {
      concurrency: 1, // 1 slot caliente + failover
      openBrowser: async (slot: SprlSlot) => { opens.push(slot.index); return fakeOpen(); },
      // slot 1 (el "caliente") siempre lockea; slot 2 (failover) funciona.
      runOne: async (plate, slot) => { seenBy.push([plate, slot.index]); return slot.index === 1 ? lockedRes() : ok(); },
      onResult: () => {},
    });
    chan.push({ plate: 'P1' });
    await new Promise((r) => setTimeout(r, 20));
    chan.close();
    await done;
    expect(opens).toEqual([1, 2]);                 // abrió slot 1 (lockea) → failover abrió slot 2
    expect(seenBy).toContainEqual(['P1', 1]);       // intentada en slot 1
    expect(seenBy).toContainEqual(['P1', 2]);       // REINTENTADA en slot 2 (failover)
  });
});
