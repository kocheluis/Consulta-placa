/* eslint-disable no-console */
import type { Report } from '@app/shared';

/**
 * Publica el `Report` normalizado en Supabase (tabla `reportes`) para que la web lo lea
 * (modelo B: el VPS sólo hace conexiones SALIENTES a Supabase). Upsert por placa vía
 * PostgREST con la `service_role`. No-op si Supabase no está configurado (modo SQLite local).
 */
const norm = (p: string): string => p.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Lee el reporte ya publicado de una placa (tabla `reportes`) + su `updated_at`, para
 * decidir el REÚSO: si es reciente y del mismo dueño, no hace falta re-correr las fuentes.
 * Devuelve null si Supabase no está configurado o no hay reporte.
 */
export async function fetchReport(placa: string): Promise<{ report: Report; updatedAt: string } | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  try {
    const r = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/reportes?placa=eq.${encodeURIComponent(norm(placa))}&select=report,updated_at&limit=1`,
      { headers },
    );
    if (!r.ok) return null;
    const rows = (await r.json()) as Array<{ report?: Report; updated_at?: string }>;
    const row = rows[0];
    if (!row?.report) return null;
    return { report: row.report, updatedAt: row.updated_at ?? new Date().toISOString() };
  } catch (e) {
    console.warn('[reportes] fetch falló:', (e as Error).message);
    return null;
  }
}

export async function publishReport(
  placa: string,
  report: Report,
  opts?: { userId?: string | null; pedidoId?: string | null },
): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  const headers = {
    apikey: key, Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
  };
  const row = {
    placa: norm(placa), report, status: 'listo',
    user_id: opts?.userId ?? null, pedido_id: opts?.pedidoId ?? null,
    updated_at: new Date().toISOString(),
  };
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/reportes?on_conflict=placa`, {
      method: 'POST', headers, body: JSON.stringify(row),
    });
    if (!r.ok) { console.warn(`[reportes] publish ${r.status}: ${await r.text()}`); return false; }
    return true;
  } catch (e) {
    console.warn('[reportes] publish falló:', (e as Error).message);
    return false;
  }
}
