import { eq, and, asc, inArray } from 'drizzle-orm';
import { getDb, schema } from './index.js';

/** Capa de datos de PlacaPe. Funciones de alto nivel sobre el esquema Drizzle. */

const now = (): string => new Date().toISOString();
const norm = (p: string): string => p.toUpperCase().replace(/[^A-Z0-9]/g, '');

type SuperbidRow = typeof schema.superbidIndex.$inferInsert;
type BoletaRow = typeof schema.boletas.$inferInsert;
type PedidoRow = typeof schema.pedidos.$inferInsert;

// ── Índice de subastas (multi-fuente) ─────────────────────────────────────────
/** Inserta/actualiza un lote en el índice (clave placa+fuente, marca visto_at). */
export function subastaUpsert(row: SuperbidRow): void {
  const db = getDb();
  const v = { ...row, placa: norm(row.placa), fuente: row.fuente ?? 'superbid', vistoAt: now() };
  db.insert(schema.superbidIndex).values(v)
    .onConflictDoUpdate({ target: [schema.superbidIndex.placa, schema.superbidIndex.fuente], set: v })
    .run();
}
/** Alias retrocompatible: upsert con fuente 'superbid' por defecto. */
export const superbidUpsert = subastaUpsert;

/** Todas las apariciones de una placa en cualquier subasta/portal. */
export function subastaLookupAll(placa: string): SuperbidRow[] {
  return getDb().select().from(schema.superbidIndex)
    .where(eq(schema.superbidIndex.placa, norm(placa))).all();
}
/**
 * Mejor coincidencia de una placa en el índice (una sola fila): prioriza subastas
 * ABIERTAS y, entre iguales, la vista más recientemente. `undefined` si no está.
 */
export function superbidLookup(placa: string): SuperbidRow | undefined {
  const rows = subastaLookupAll(placa);
  if (rows.length === 0) return undefined;
  return rows.sort((a, b) => {
    const open = (r: SuperbidRow) => (r.estado === 'cerrada' ? 0 : 1);
    if (open(a) !== open(b)) return open(b) - open(a);
    return (b.vistoAt ?? '').localeCompare(a.vistoAt ?? '');
  })[0];
}
/** Marca un lote como cerrado (conserva la fila = histórico). Si se omite `fuente`, marca todas. */
export function superbidMarkClosed(placa: string, fuente?: string): void {
  const where = fuente
    ? and(eq(schema.superbidIndex.placa, norm(placa)), eq(schema.superbidIndex.fuente, fuente))
    : eq(schema.superbidIndex.placa, norm(placa));
  getDb().update(schema.superbidIndex)
    .set({ estado: 'cerrada', cerradoAt: now() }).where(where).run();
}
/** Cuántos lotes hay en el índice (opcionalmente filtrado por fuente). */
export function superbidCount(fuente?: string): number {
  const q = getDb().select().from(schema.superbidIndex);
  return (fuente ? q.where(eq(schema.superbidIndex.fuente, fuente)).all() : q.all()).length;
}

// ── Boletas ──────────────────────────────────────────────────────────────────
/** Guarda/actualiza la boleta de una placa (marca obtenida_at si falta). */
export function boletaSave(row: BoletaRow): void {
  const db = getDb();
  const v = { ...row, placa: norm(row.placa), obtenidaAt: row.obtenidaAt ?? now() };
  db.insert(schema.boletas).values(v)
    .onConflictDoUpdate({ target: schema.boletas.placa, set: v })
    .run();
}
export function boletaGet(placa: string): BoletaRow | undefined {
  return getDb().select().from(schema.boletas)
    .where(eq(schema.boletas.placa, norm(placa))).get();
}

// ── Pedidos (cola del motor) ──────────────────────────────────────────────────
export function pedidoCreate(p: Omit<PedidoRow, 'id' | 'estado' | 'createdAt'>): number {
  const r = getDb().insert(schema.pedidos)
    .values({ ...p, placa: norm(p.placa), estado: 'pendiente', createdAt: now() }).run();
  return Number(r.lastInsertRowid);
}
export function pedidoSetEstado(id: number, estado: string, reportPath?: string): void {
  getDb().update(schema.pedidos)
    .set({ estado, ...(reportPath ? { reportPath } : {}) })
    .where(eq(schema.pedidos.id, id)).run();
}
export function pedidoGet(id: number): PedidoRow | undefined {
  return getDb().select().from(schema.pedidos).where(eq(schema.pedidos.id, id)).get();
}
export function pedidosPendientes(): PedidoRow[] {
  return getDb().select().from(schema.pedidos)
    .where(eq(schema.pedidos.estado, 'pendiente')).all();
}
/** El pedido pendiente más antiguo (FIFO) — lo que el motor debe atender ahora. */
export function pedidoNext(): PedidoRow | undefined {
  return getDb().select().from(schema.pedidos)
    .where(eq(schema.pedidos.estado, 'pendiente'))
    .orderBy(asc(schema.pedidos.createdAt)).limit(1).get();
}
/** Tablero (marquesina): pendientes + en proceso, por orden de llegada. */
export function pedidoBoard(): PedidoRow[] {
  return getDb().select().from(schema.pedidos)
    .where(inArray(schema.pedidos.estado, ['pendiente', 'procesando']))
    .orderBy(asc(schema.pedidos.createdAt)).all();
}
export function pedidoSetProcessing(id: number): void {
  getDb().update(schema.pedidos)
    .set({ estado: 'procesando', startedAt: now() }).where(eq(schema.pedidos.id, id)).run();
}
export function pedidoSetDone(id: number, reportPath?: string): void {
  getDb().update(schema.pedidos)
    .set({ estado: 'listo', reportPath, finishedAt: now() }).where(eq(schema.pedidos.id, id)).run();
}
export function pedidoSetError(id: number, error: string): void {
  getDb().update(schema.pedidos)
    .set({ estado: 'error', error, finishedAt: now() }).where(eq(schema.pedidos.id, id)).run();
}
export function pedidoSetDelivered(id: number): void {
  getDb().update(schema.pedidos).set({ estado: 'entregado' }).where(eq(schema.pedidos.id, id)).run();
}

// ── Meta (control del índice) ─────────────────────────────────────────────────
export function metaGet<T = unknown>(k: string): T | null {
  const r = getDb().select().from(schema.meta).where(eq(schema.meta.k, k)).get();
  return r ? (r.v as T) : null;
}
export function metaSet(k: string, v: unknown): void {
  getDb().insert(schema.meta).values({ k, v })
    .onConflictDoUpdate({ target: schema.meta.k, set: { v } }).run();
}
