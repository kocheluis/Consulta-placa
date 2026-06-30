import { NextResponse } from 'next/server';
import { isAdminConfigured } from '@/lib/supabase/admin';
import { enqueueFreeBasic, freeConsultaRateOk } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Consulta GRATUITA (BASIC): encola un pedido tier=BASIC para que el motor del VPS
 * genere identidad + SOAT + revisión técnica (sin pago). Dedup por placa en el helper +
 * rate-limit por IP (12/hora) para evitar spam de placas nuevas que sature el motor.
 * La web luego hace polling de /api/reporte/[placa] (anónimo → recortado a BASIC).
 */
export async function POST(req: Request) {
  if (!isAdminConfigured) {
    return NextResponse.json({ ok: false, status: 'invalid', error: 'backend no configurado' }, { status: 503 });
  }
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim()
    || req.headers.get('x-real-ip') || 'unknown';
  if (!(await freeConsultaRateOk(ip))) {
    return NextResponse.json(
      { ok: false, status: 'rate_limited', error: 'Demasiadas consultas gratis desde tu conexión. Intenta de nuevo en un rato.' },
      { status: 429 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as { placa?: string };
  const r = await enqueueFreeBasic(String(body?.placa ?? ''));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
