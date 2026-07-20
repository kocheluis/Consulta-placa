import { NextResponse } from 'next/server';
import { isAdminConfigured } from '@/lib/supabase/admin';
import { getSessionOperatorAccess, checkAndRecordQuota, enqueueOperatorConsulta } from '@/lib/operador';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Consulta de una cuenta interna de OPERADOR. Requiere sesión + `consulta_enabled`. Aplica el
 * cupo (hora/día/semana) del perfil ANTES de encolar; si no hay cupo, 429 con la ventana y el
 * reset. Al pasar, encola el reporte del nivel del operador (PRO/ULTRA) sin cobrar. Ver
 * lib/operador.ts. NO toca el flujo de pago por reporte.
 */
export async function POST(req: Request) {
  if (!isAdminConfigured) {
    return NextResponse.json({ ok: false, error: 'backend no configurado' }, { status: 503 });
  }
  const op = await getSessionOperatorAccess();
  if (!op) return NextResponse.json({ ok: false, error: 'Inicia sesión.' }, { status: 401 });
  if (!op.access.enabled) {
    return NextResponse.json({ ok: false, error: 'Tu cuenta no tiene acceso de consulta por operador.' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { placa?: string };
  const placa = String(body?.placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (placa.length < 6 || placa.length > 7) {
    return NextResponse.json({ ok: false, error: 'Placa inválida.' }, { status: 400 });
  }

  const q = await checkAndRecordQuota(op.userId, op.access, placa);
  if (!q.ok) {
    return NextResponse.json(
      { ok: false, error: `Alcanzaste tu tope por ${q.window}. Se libera en ~${q.resetInMin} min.`, window: q.window, resetInMin: q.resetInMin },
      { status: 429 },
    );
  }

  const status = await enqueueOperatorConsulta(op.userId, op.email, placa, op.access.tier);
  return NextResponse.json(
    { ok: status !== 'invalid', placa, status, tier: op.access.tier, remaining: q.remaining },
    { status: status === 'invalid' ? 400 : 200 },
  );
}
