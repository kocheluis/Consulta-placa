import { eq } from 'drizzle-orm';
import { getDb, schema } from './index.js';

/** Capa de datos de PlacaPe. Funciones de alto nivel sobre el esquema Drizzle. */

const now = (): string => new Date().toISOString();
const norm = (p: string): string => p.toUpperCase().replace(/[^A-Z0-9]/g, '');

type SuperbidRow = typeof schema.superbidIndex.$inferInsert;
type BoletaRow = typeof schema.boletas.$inferInsert;
type PedidoRow = typeof schema.pedidos.$inferInsert;

// ── Índice Superbid ──────────────────────────────────────────────────────────
/** Inserta/actualiza un lote en el índice (marca visto_at). */
export function superbidUpsert(row: SuperbidRow): void {
  const db = getDb();
  const v = { ...row, placa: norm(row.placa), vistoAt: now() };
  db.insert(schema.superbidIndex).values(v)
    .onConflictDoUpdate({ target: schema.superbidIndex.placa, set: v })
    .run();
}
/** Busca una placa en el índice (null si no está). */
export function superbidLookup(placa: string): SuperbidRow | undefined {
  return getDb().select().from(schema.superbidIndex)
    .where(eq(schema.superbidIndex.placa, norm(placa))).get();
}
/** Marca un lote como cerrado (conserva la fila = histórico). */
export function superbidMarkClosed(placa: string): void {
  getDb().update(schema.superbidIndex)
    .set({ estado: 'cerrada', cerradoAt: now() })
    .where(eq(schema.superbidIndex.placa, norm(placa))).run();
}
/** Cuántos lotes hay en el índice. */
export function superbidCount(): number {
  return getDb().select().from(schema.superbidIndex).all().length;
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

// ── Pedidos ──────────────────────────────────────────────────────────────────
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
export function pedidosPendientes(): PedidoRow[] {
  return getDb().select().from(schema.pedidos)
    .where(eq(schema.pedidos.estado, 'pendiente')).all();
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
