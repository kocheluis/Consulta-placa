import { NextResponse } from 'next/server';
import { createAdminClient, isAdminConfigured } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { stripByTier } from '@/lib/report-tier';
import type { Report } from '@app/shared';

export const dynamic = 'force-dynamic';

/**
 * Un reporte CONGELADO del historial del usuario: tal como se le entregó, recortado al nivel de ESE
 * pedido. Solo su dueño y solo mientras no venza (30 días). No se regenera ni se actualiza.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isAdminConfigured || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { data: auth } = await (await createClient()).auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  const { data } = await createAdminClient()
    .from('reportes_usuario')
    .select('id, placa, tier, report, created_at, expires_at')
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .maybeSingle();
  if (!data || Date.parse(data.expires_at) <= Date.now()) return NextResponse.json({ error: 'expired_or_missing' }, { status: 404 });
  const tier = (['BASIC', 'PRO', 'ULTRA'].includes(data.tier) ? data.tier : 'BASIC') as 'BASIC' | 'PRO' | 'ULTRA';
  return NextResponse.json({
    report: stripByTier(data.report as Report, tier),
    tier,
    snapshot: { id: data.id, createdAt: data.created_at, expiresAt: data.expires_at },
  });
}
