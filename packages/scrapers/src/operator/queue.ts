/* eslint-disable no-console */
import {
  pedidoCreate, pedidoGet, pedidoNext, pedidoBoard, pedidoHistory,
  pedidoRequeue, pedidoRequeueStuck,
  pedidoSetProcessing, pedidoSetDone, pedidoSetError, pedidoSetDelivered,
} from '../db/repo.js';

/**
 * Cola de pedidos = el "cableado central" entre la web pública y el motor del VPS.
 * Adaptador INTERCAMBIABLE:
 *   - `sqlite` (por defecto): la tabla `pedidos` local del VPS. Validable hoy mismo.
 *   - `supabase` (broker en la nube): si `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
 *     están en el entorno, el VPS jala/actualiza pedidos en Supabase por PostgREST —
 *     el cliente NUNCA toca el VPS (modelo B). Cambiar de uno a otro = 2 env vars.
 *
 * Contrato de estados: pendiente → procesando → listo|error → entregado.
 */
export interface Pedido {
  id: string | number;
  placa: string;
  whatsapp?: string | null;
  email?: string | null;
  estado: string;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  reportPath?: string | null;
  error?: string | null;
  userId?: string | null;
  /** 'BASIC' = consulta gratuita (fuentes reducidas); 'PRO'/'ULTRA' = reporte de pago (todas). */
  tier?: string | null;
  /** 'operador' = creado por el operador en la consola del VPS; 'servicio' = solicitud desde la web. */
  origin?: string | null;
}

export interface PedidoQueue {
  kind: 'sqlite' | 'supabase';
  enqueue(p: { placa: string; whatsapp?: string; email?: string; tier?: string; origin?: string }): Promise<Pedido>;
  next(): Promise<Pedido | null>;
  board(): Promise<Pedido[]>;
  /** Historial completo (todos los estados), más recientes primero. */
  history(limit?: number): Promise<Pedido[]>;
  /** Re-encola un pedido (vuelve a 'pendiente') para re-generarlo. */
  requeue(id: Pedido['id']): Promise<void>;
  /** Recupera pedidos 'procesando' huérfanos (tras un reinicio) → 'pendiente'. Devuelve cuántos. */
  requeueStuck(): Promise<number>;
  setProcessing(id: Pedido['id']): Promise<void>;
  setDone(id: Pedido['id'], reportPath?: string): Promise<void>;
  setError(id: Pedido['id'], msg: string): Promise<void>;
  setDelivered(id: Pedido['id']): Promise<void>;
}

const now = () => new Date().toISOString();

// ── Adaptador SQLite local ─────────────────────────────────────────────────────
const sqliteQueue: PedidoQueue = {
  kind: 'sqlite',
  async enqueue(p) {
    const id = pedidoCreate({ placa: p.placa, whatsapp: p.whatsapp ?? null, email: p.email ?? null });
    return pedidoGet(id) as Pedido;
  },
  async next() { return (pedidoNext() as Pedido) ?? null; },
  async board() { return pedidoBoard() as Pedido[]; },
  async history(limit = 100) { return pedidoHistory(limit) as Pedido[]; },
  async requeue(id) { pedidoRequeue(Number(id)); },
  async requeueStuck() { return pedidoRequeueStuck(); },
  async setProcessing(id) { pedidoSetProcessing(Number(id)); },
  async setDone(id, reportPath) { pedidoSetDone(Number(id), reportPath); },
  async setError(id, msg) { pedidoSetError(Number(id), msg); },
  async setDelivered(id) { pedidoSetDelivered(Number(id)); },
};

// ── Adaptador Supabase (PostgREST) ─────────────────────────────────────────────
function supabaseQueue(url: string, key: string): PedidoQueue {
  const base = `${url.replace(/\/$/, '')}/rest/v1/pedidos`;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const map = (r: Record<string, unknown>): Pedido => ({
    id: r.id as string, placa: r.placa as string, whatsapp: r.whatsapp as string, email: r.email as string,
    estado: r.estado as string, createdAt: r.created_at as string, startedAt: r.started_at as string,
    finishedAt: (r.finished_at as string) ?? null,
    reportPath: r.report_path as string, error: r.error as string, userId: (r.user_id as string) ?? null,
    tier: (r.tier as string) ?? null,
    origin: (r.origin as string) ?? 'servicio',
  });
  const patch = async (id: Pedido['id'], body: Record<string, unknown>) => {
    const r = await fetch(`${base}?id=eq.${id}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`supabase PATCH ${r.status}: ${await r.text()}`);
  };
  return {
    kind: 'supabase',
    async enqueue(p) {
      const r = await fetch(base, { method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ placa: p.placa, whatsapp: p.whatsapp ?? null, email: p.email ?? null, tier: p.tier ?? 'PRO', origin: p.origin ?? 'servicio', estado: 'pendiente' }) });
      if (!r.ok) throw new Error(`supabase POST ${r.status}: ${await r.text()}`);
      return map((await r.json())[0]);
    },
    async next() {
      const r = await fetch(`${base}?estado=eq.pendiente&order=created_at.asc&limit=1`, { headers });
      if (!r.ok) throw new Error(`supabase GET ${r.status}`);
      const rows = (await r.json()) as Record<string, unknown>[];
      return rows[0] ? map(rows[0]) : null;
    },
    async board() {
      const r = await fetch(`${base}?estado=in.(pendiente,procesando)&order=created_at.asc`, { headers });
      if (!r.ok) throw new Error(`supabase GET ${r.status}`);
      return ((await r.json()) as Record<string, unknown>[]).map(map);
    },
    async history(limit = 100) {
      const r = await fetch(`${base}?order=created_at.desc&limit=${limit}`, { headers });
      if (!r.ok) throw new Error(`supabase GET ${r.status}`);
      return ((await r.json()) as Record<string, unknown>[]).map(map);
    },
    async requeue(id) { await patch(id, { estado: 'pendiente', started_at: null, error: null }); },
    async requeueStuck() {
      const r = await fetch(`${base}?estado=eq.procesando`, { method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify({ estado: 'pendiente', started_at: null }) });
      if (!r.ok) throw new Error(`supabase PATCH ${r.status}: ${await r.text()}`);
      return ((await r.json()) as unknown[]).length;
    },
    async setProcessing(id) { await patch(id, { estado: 'procesando', started_at: now() }); },
    async setDone(id, reportPath) { await patch(id, { estado: 'listo', report_path: reportPath ?? null, finished_at: now() }); },
    async setError(id, msg) { await patch(id, { estado: 'error', error: msg, finished_at: now() }); },
    async setDelivered(id) { await patch(id, { estado: 'entregado' }); },
  };
}

let _q: PedidoQueue | null = null;
/** Devuelve la cola activa (Supabase si hay env, si no SQLite local). Singleton. */
export function getQueue(): PedidoQueue {
  if (_q) return _q;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  _q = url && key ? supabaseQueue(url, key) : sqliteQueue;
  console.log(`[cola] adaptador: ${_q.kind}`);
  return _q;
}
