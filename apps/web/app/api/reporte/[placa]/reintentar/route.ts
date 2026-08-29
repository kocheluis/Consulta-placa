import { NextResponse } from 'next/server';
import { createAdminClient, isAdminConfigured } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getPaidTier, freeConsultaRateOk } from '@/lib/payments';
import { getSessionCupo } from '@/lib/cupo';
import { SectionStatus, TIER_RANK, type ReportTier, type Report } from '@app/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const norm = (p: string): string => p.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * REINTENTO de las fuentes con ERROR, disparado por el USUARIO desde el reporte. Encola un pedido
 * `origin='reintento'`: el motor re-corre SOLO las fuentes que fallaron (sin TTL de memoria, que
 * devolvería el mismo reporte cacheado) y fusiona con las que sí salieron. No cobra ni consume cupo
 * (es reparación de NUESTROS errores), pero se limita por IP para evitar abuso.
 * Estados: queued | generating | no_errors | no_report | rate_limited.
 */
export async function POST(req: Request, { params }: { params: Promise<{ placa: string }> }) {
  const { placa: raw } = await params;
  const placa = norm(raw);
  if (!placa) return NextResponse.json({ ok: false, status: 'no_report' }, { status: 400 });
  if (!isAdminConfigured) return NextResponse.json({ ok: false, error: 'backend no configurado' }, { status: 503 });

  const admin = createAdminClient();
  const { data: rep } = await admin.from('reportes').select('report').eq('placa', placa).maybeSingle();
  const report = (rep?.report ?? null) as Report | null;
  if (!report) return NextResponse.json({ ok: false, status: 'no_report' }, { status: 404 });
  // Placa inexistente en SUNARP o sin secciones con error → no hay nada que reintentar.
  const failed = report.plateNotFound ? 0 : report.sections.filter((s) => s.status === SectionStatus.UNAVAILABLE).length;
  if (!failed) return NextResponse.json({ ok: true, status: 'no_errors' });

  // ¿Ya hay una generación en curso para esta placa? → no duplicar; la web solo tiene que sondear.
  const { data: ped } = await admin
    .from('pedidos').select('id').eq('placa', placa).in('estado', ['pendiente', 'procesando']).limit(1);
  if (ped && ped.length) return NextResponse.json({ ok: true, status: 'generating' });

  // Anti-abuso: mismo limitador por IP de la consulta gratis (reparar errores es gratis, no ilimitado).
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim()
    || req.headers.get('x-real-ip') || 'unknown';
  if (!(await freeConsultaRateOk(ip))) {
    return NextResponse.json({ ok: false, status: 'rate_limited' }, { status: 429 });
  }

  // Identidad opcional (para la entrega y trazabilidad) + nivel efectivo (pago + cupo). El nivel NO
  // limita qué fuentes se reparan (eso lo decide el reporte guardado); solo gobierna IA/notificación.
  let tier: 'BASIC' | 'PRO' | 'ULTRA' = 'BASIC';
  try { tier = await getPaidTier(placa); } catch { /* anónimo → BASIC */ }
  let userId: string | null = null; let email: string | null = null;
  try {
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (user) { userId = user.id; email = user.email ?? null; }
  } catch { /* sin sesión */ }
  try {
    const cupo = await getSessionCupo();
    if (cupo?.access.enabled && TIER_RANK[cupo.access.tier] > TIER_RANK[tier as ReportTier]) tier = cupo.access.tier;
  } catch { /* sin cupo */ }

  const { error } = await admin.from('pedidos').insert({ placa, estado: 'pendiente', tier, origin: 'reintento', user_id: userId, email });
  if (error) return NextResponse.json({ ok: false, error: 'no se pudo encolar' }, { status: 500 });
  return NextResponse.json({ ok: true, status: 'queued', failed });
}
