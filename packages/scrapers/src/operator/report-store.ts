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
export async function fetchReport(placa: string): Promise<{ report: Report; updatedAt: string; userId: string | null; pedidoId: string | null } | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  try {
    const r = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/reportes?placa=eq.${encodeURIComponent(norm(placa))}&select=report,updated_at,user_id,pedido_id&limit=1`,
      { headers },
    );
    if (!r.ok) return null;
    const rows = (await r.json()) as Array<{ report?: Report; updated_at?: string; user_id?: string | null; pedido_id?: string | number | null }>;
    const row = rows[0];
    if (!row?.report) return null;
    return {
      report: row.report,
      updatedAt: row.updated_at ?? new Date().toISOString(),
      userId: row.user_id ?? null,
      pedidoId: row.pedido_id != null ? String(row.pedido_id) : null,
    };
  } catch (e) {
    console.warn('[reportes] fetch falló:', (e as Error).message);
    return null;
  }
}

export interface ReportMeta {
  /** id del Report vivo (cambia en cada regeneración) → "índice" del reporte. */
  reportId: string | null;
  /** Fecha de generación del reporte vivo (ISO). */
  generatedAt: string | null;
  /** id del pedido cuya generación produjo el reporte vivo (para marcar la fila "viva"). */
  pedidoId: string | null;
}

/**
 * Trae el "índice" del reporte vivo de varias placas en UNA consulta (para la tabla del historial):
 * qué pedido lo produjo (`pedido_id`, idéntico a `report.id`) + cuándo se publicó (`updated_at`,
 * cambia en cada regeneración). Se usan columnas PLANAS (no `report->>...`) para no depender del
 * parseo de claves JSON en PostgREST. Devuelve un mapa placa→meta. Best-effort: si Supabase no está
 * o la consulta falla, devuelve un mapa vacío (la tabla simplemente no muestra el índice, sin romperse).
 */
export async function fetchReportsMeta(placas: string[]): Promise<Map<string, ReportMeta>> {
  const out = new Map<string, ReportMeta>();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const unique = [...new Set(placas.map(norm).filter(Boolean))];
  if (!url || !key || !unique.length) return out;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  try {
    const inList = unique.map((p) => `"${p}"`).join(',');
    const r = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/reportes?placa=in.(${encodeURIComponent(inList)})&select=placa,pedido_id,updated_at`,
      { headers },
    );
    if (!r.ok) return out;
    const rows = (await r.json()) as Array<{ placa?: string; pedido_id?: string | number; updated_at?: string }>;
    for (const row of rows) {
      if (!row.placa) continue;
      const pid = row.pedido_id != null ? String(row.pedido_id) : null;
      out.set(norm(row.placa), { reportId: pid, generatedAt: row.updated_at ?? null, pedidoId: pid });
    }
  } catch (e) {
    console.warn('[reportes] fetchReportsMeta falló:', (e as Error).message);
  }
  return out;
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
