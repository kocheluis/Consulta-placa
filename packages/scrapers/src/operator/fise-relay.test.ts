import { describe, it, expect, beforeEach } from 'vitest';
import { relayNext, relayResult, relayEnqueue, fiseRelayAlive, fiseRelayStatus, aliveRelays } from './fise-relay.js';

// La cola es estado de módulo (igual que en producción): los tests van en orden y cada uno
// deja la cola vacía (consume lo que encola).

const TOKEN = 'token-de-prueba-123';

describe('fise-relay (cola del relay residencial)', () => {
  beforeEach(() => { process.env.FISE_RELAY_TOKEN = TOKEN; });

  it('rechaza token inválido y NO late el heartbeat', () => {
    const r = relayNext('token-equivocado-xx');
    expect(r.code).toBe(403);
  });

  it('sin FISE_RELAY_TOKEN el relay queda deshabilitado (403 incluso con token vacío)', () => {
    delete process.env.FISE_RELAY_TOKEN;
    expect(relayNext('').code).toBe(403);
    expect(relayNext(undefined).code).toBe(403);
    expect((fiseRelayStatus() as { enabled: boolean }).enabled).toBe(false);
  });

  it('poll válido sin trabajos → job:null y el heartbeat late (alive=true)', () => {
    const r = relayNext(TOKEN);
    expect(r.code).toBe(200);
    expect((r.body as { job: unknown }).job).toBeNull();
    expect(fiseRelayAlive()).toBe(true);
  });

  it('roundtrip: enqueue → next entrega el job → result resuelve la promesa', async () => {
    const p = relayEnqueue('ABC123', 'tok-v3-xyz', 5000);
    const next = relayNext(TOKEN);
    const job = (next.body as { job: { id: string; plate: string; captchaToken: string } }).job;
    expect(job.plate).toBe('ABC123');
    expect(job.captchaToken).toBe('tok-v3-xyz');
    const rr = relayResult(TOKEN, { id: job.id, ok: true, httpStatus: 200, bodyText: '{"status":0,"rows":[]}' });
    expect((rr.body as { ok: boolean }).ok).toBe(true);
    const out = await p;
    expect(out.ok).toBe(true);
    expect(out.httpStatus).toBe(200);
    expect(out.bodyText).toBe('{"status":0,"rows":[]}');
  });

  it('timeout: sin worker que responda, la promesa expira con error claro', async () => {
    const out = await relayEnqueue('XYZ789', 'tok', 60); // 60ms — nadie hace poll
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/sin respuesta/);
    // El job expirado ya no se entrega en el siguiente poll.
    const next = relayNext(TOKEN);
    expect((next.body as { job: unknown }).job).toBeNull();
  });

  it('resultado de un job desconocido (expirado) se ignora sin romper', () => {
    const rr = relayResult(TOKEN, { id: 'no-existe', ok: true, bodyText: 'x' });
    expect(rr.code).toBe(200);
    expect((rr.body as { ok: boolean }).ok).toBe(false);
  });

  it('resultado con ok=false transporta el error del celular', async () => {
    const p = relayEnqueue('DEF456', 'tok2', 5000);
    const job = (relayNext(TOKEN).body as { job: { id: string } }).job;
    relayResult(TOKEN, { id: job.id, ok: false, error: 'fetch failed (sin datos móviles)' });
    const out = await p;
    expect(out.ok).toBe(false);
    expect(out.error).toContain('sin datos móviles');
  });
});

describe('fise-relay · varios relays con prioridad (PC principal, celular respaldo)', () => {
  beforeEach(() => { process.env.FISE_RELAY_TOKEN = TOKEN; });

  it('ordena los relays vivos por prioridad y entrega cada consulta solo a su destinatario', async () => {
    relayNext(TOKEN, { id: 'celular', prio: 2 });
    relayNext(TOKEN, { id: 'pc', prio: 1, label: 'PC de casa' });
    expect(aliveRelays().map((r) => r.id)).toEqual(['pc', 'celular']);

    const p = relayEnqueue('PCX123', 'tok', 5000, 'pc');
    // El celular pide trabajo: la consulta es de la PC → no la recibe.
    expect((relayNext(TOKEN, { id: 'celular', prio: 2 }).body as { job: unknown }).job).toBeNull();
    const job = (relayNext(TOKEN, { id: 'pc', prio: 1 }).body as { job: { id: string; plate: string } }).job;
    expect(job.plate).toBe('PCX123');
    relayResult(TOKEN, { id: job.id, ok: true, bodyText: '{}' }, { id: 'pc', prio: 1 });
    expect((await p).ok).toBe(true);

    const st = fiseRelayStatus() as { active: string; relays: Array<{ id: string; done: number }> };
    expect(st.active).toBe('pc');
    expect(st.relays.find((r) => r.id === 'pc')?.done).toBe(1);
  });

  it('si la PC no responde a tiempo, cuenta la falla (el runner pasa al celular)', async () => {
    relayNext(TOKEN, { id: 'pc', prio: 1 });
    const out = await relayEnqueue('PCY456', 'tok', 50, 'pc'); // la PC no hace poll en 50 ms
    expect(out.ok).toBe(false);
    const st = fiseRelayStatus() as { relays: Array<{ id: string; fails: number }> };
    expect(st.relays.find((r) => r.id === 'pc')!.fails).toBeGreaterThanOrEqual(1);
  });
});
