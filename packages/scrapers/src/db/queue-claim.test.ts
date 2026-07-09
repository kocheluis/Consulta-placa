import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Claim atómico de la cola (base de los 2 hilos de historial del lote): reclamar
 * marca 'procesando' y NO vuelve a entregar el mismo pedido. FIFO estable por
 * (createdAt, id) aun cuando varios se crean en el mismo milisegundo.
 */
// PLACAPE_DB se captura al importar db/index → hay que fijarlo ANTES del import dinámico.
type Repo = typeof import('./repo.js');
let repo: Repo;

beforeAll(async () => {
  process.env.PLACAPE_DB = join(mkdtempSync(join(tmpdir(), 'placape-q-')), 'q.db');
  repo = await import('./repo.js');
});

describe('pedidoClaimBatch / pedidoClaimNext', () => {
  it('reclama en FIFO, marca procesando y no re-entrega', () => {
    repo.pedidoCreate({ placa: 'AAA111' });
    repo.pedidoCreate({ placa: 'BBB222' });
    repo.pedidoCreate({ placa: 'CCC333' });

    const batch = repo.pedidoClaimBatch(2);
    expect(batch.map((p) => p.placa)).toEqual(['AAA111', 'BBB222']); // FIFO estable
    expect(batch.every((p) => p.estado === 'procesando')).toBe(true);

    // Lo ya reclamado no vuelve a salir; queda solo el tercero.
    const next = repo.pedidoClaimNext();
    expect(next?.placa).toBe('CCC333');
    expect(next?.estado).toBe('procesando');

    // Cola vacía de pendientes.
    expect(repo.pedidoClaimNext()).toBeUndefined();
    expect(repo.pedidoClaimBatch(5)).toHaveLength(0);
  });

  it('pedidoNext no muta estado (solo lee); claim sí', () => {
    const id = repo.pedidoCreate({ placa: 'DDD444' });
    expect(repo.pedidoNext()?.placa).toBe('DDD444'); // sigue pendiente
    expect(repo.pedidoNext()?.placa).toBe('DDD444'); // idempotente
    const claimed = repo.pedidoClaimNext();
    expect(claimed?.placa).toBe('DDD444');
    expect(repo.pedidoGet(id)?.estado).toBe('procesando');
    expect(repo.pedidoNext()).toBeUndefined();
  });
});
