import { NextResponse } from 'next/server';
import { isAdminConfigured } from '@/lib/supabase/admin';
import { getSessionCupo, checkAndRecordCupo, enqueueCupoConsulta } from '@/lib/cupo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Consulta de un usuario con CUPO asignado. Requiere sesión + `consulta_enabled`. Aplica el cupo
 * (hora/día/semana) del perfil ANTES de encolar; si no hay cupo, 429 con la ventana y el reset. Al
 * pasar, encola el reporte del nivel asignado (PRO/ULTRA) sin cobrar. Ver lib/cupo.ts. NO toca el
 * flujo de pago por reporte ni da acceso a la consola del operador.
 */
export async function POST(req: Request) {
  if (!isAdminConfigured) {
    return NextResponse.json({ ok: false, error: 'backend no configurado' }, { status: 503 });
  }
  const cupo = await getSessionCupo();
  if (!cupo) return NextResponse.json({ ok: false, error: 'Inicia sesión.' }, { status: 401 });
  if (!cupo.access.enabled) {
    return NextResponse.json({ ok: false, error: 'Tu cuenta no tiene un cupo de consultas asignado.' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { placa?: string };
  const placa = String(body?.placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (placa.length < 6 || placa.length > 7) {
    return NextResponse.json({ ok: false, error: 'Placa inválida.' }, { status: 400 });
  }

  const q = await checkAndRecordCupo(cupo.userId, cupo.access, placa);
  if (!q.ok) {
    return NextResponse.json(
      { ok: false, error: `Alcanzaste tu tope por ${q.window}. Se libera en ~${q.resetInMin} min.`, window: q.window, resetInMin: q.resetInMin },
      { status: 429 },
    );
  }

  const status = await enqueueCupoConsulta(cupo.userId, cupo.email, placa, cupo.access.tier);
  return NextResponse.json(
    { ok: status !== 'invalid', placa, status, tier: cupo.access.tier, remaining: q.remaining },
    { status: status === 'invalid' ? 400 : 200 },
  );
}
