import { NextResponse } from 'next/server';
import { isAdminConfigured } from '@/lib/supabase/admin';
import { enqueueFreeBasic } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Consulta GRATUITA (BASIC): encola un pedido tier=BASIC para que el motor del VPS
 * genere identidad + SOAT + revisión técnica (sin pago). Dedup por placa en el helper.
 * La web luego hace polling de /api/reporte/[placa] (anónimo → recortado a BASIC).
 *
 * NOTA: falta rate-limit por IP antes del lanzamiento público (hoy el dedup por placa
 * evita re-correr la misma placa, pero no el spam de placas nuevas).
 */
export async function POST(req: Request) {
  if (!isAdminConfigured) {
    return NextResponse.json({ ok: false, status: 'invalid', error: 'backend no configurado' }, { status: 503 });
  }
  const body = (await req.json().catch(() => ({}))) as { placa?: string };
  const r = await enqueueFreeBasic(String(body?.placa ?? ''));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
