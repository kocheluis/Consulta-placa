/* eslint-disable no-console */
import type { Report } from '@app/shared';

/**
 * Publica el `Report` normalizado en Supabase (tabla `reportes`) para que la web lo lea
 * (modelo B: el VPS sólo hace conexiones SALIENTES a Supabase). Upsert por placa vía
 * PostgREST con la `service_role`. No-op si Supabase no está configurado (modo SQLite local).
 */
const norm = (p: string): string => p.toUpperCase().replace(/[^A-Z0-9]/g, '');

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
