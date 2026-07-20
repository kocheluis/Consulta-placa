import { NextResponse } from 'next/server';
import { isAdminConfigured } from '@/lib/supabase/admin';
import { getSessionCupo, getCupoStatus } from '@/lib/cupo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Estado del cupo del usuario en sesión (para la página /consultas): si está autenticado, tiene
 * cupo, su nivel y cuánto le queda por ventana. NO consume cupo.
 */
export async function GET() {
  if (!isAdminConfigured) return NextResponse.json({ authed: false, enabled: false });
  const cupo = await getSessionCupo();
  if (!cupo) return NextResponse.json({ authed: false, enabled: false });
  if (!cupo.access.enabled) return NextResponse.json({ authed: true, enabled: false });
  const status = await getCupoStatus(cupo.userId, cupo.access);
  return NextResponse.json({ authed: true, ...status });
}
