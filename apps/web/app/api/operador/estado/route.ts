import { NextResponse } from 'next/server';
import { isAdminConfigured } from '@/lib/supabase/admin';
import { getSessionOperatorAccess, getQuotaStatus } from '@/lib/operador';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Estado del cupo del operador en sesión (para la página /operador): si está autenticado,
 * habilitado, su nivel y cuánto le queda por ventana. NO consume cupo.
 */
export async function GET() {
  if (!isAdminConfigured) return NextResponse.json({ authed: false, enabled: false });
  const op = await getSessionOperatorAccess();
  if (!op) return NextResponse.json({ authed: false, enabled: false });
  if (!op.access.enabled) return NextResponse.json({ authed: true, enabled: false });
  const status = await getQuotaStatus(op.userId, op.access);
  return NextResponse.json({ authed: true, ...status });
}
