import { NextResponse } from 'next/server';
import { createAdminClient, isAdminConfigured } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Historial del usuario en sesión: sus reportes CONGELADOS (tabla `reportes_usuario`, migración 0011)
 * de los últimos 30 días. Solo metadatos (placa, nivel, fechas); el reporte se abre por id.
 */
export async function GET() {
  if (!isAdminConfigured) return NextResponse.json({ items: [] });
  const { data: auth } = await (await createClient()).auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  const { data, error } = await createAdminClient()
    .from('reportes_usuario')
    .select('id, placa, tier, created_at, expires_at')
    .eq('user_id', auth.user.id)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ items: [] }); // tabla aún no migrada → historial vacío
  return NextResponse.json({
    items: (data ?? []).map((r) => ({ id: r.id, plate: r.placa, tier: r.tier, createdAt: r.created_at, expiresAt: r.expires_at })),
  });
}
