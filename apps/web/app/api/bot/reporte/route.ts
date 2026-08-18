import { NextResponse } from 'next/server';
import { createAdminClient, isAdminConfigured } from '@/lib/supabase/admin';
import { botAuthOk, normPlaca, getBotUser, entitledBotTier, reportSummary } from '@/lib/bot';
import { stripByTier } from '@/lib/report-tier';
import type { Report } from '@app/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * BOT · devuelve el estado + un RESUMEN del reporte listo para WhatsApp. Auth por token de servicio.
 * Query: `?placa=ABC123&phone=51...` (el phone es opcional; recorta el reporte al nivel que ese número
 * tiene DERECHO a ver — así no se filtra un PRO/ULTRA que otro usuario generó). Estados: `ready` |
 * `generating` | `not_found` | `not_registered` (placa inexistente en SUNARP).
 */
export async function GET(req: Request) {
  if (!botAuthOk(req)) return NextResponse.json({ ok: false, error: 'no autorizado' }, { status: 401 });
  if (!isAdminConfigured) return NextResponse.json({ ok: false, error: 'backend no configurado' }, { status: 503 });

  const url = new URL(req.url);
  const placa = normPlaca(url.searchParams.get('placa') ?? '');
  const phone = url.searchParams.get('phone') ?? '';
  if (!placa) return NextResponse.json({ ok: false, status: 'invalid', error: 'placa inválida' }, { status: 400 });

  const admin = createAdminClient();
  const { data: rep } = await admin.from('reportes').select('report').eq('placa', placa).maybeSingle();
  const { data: ped } = await admin
    .from('pedidos').select('id').eq('placa', placa).in('estado', ['pendiente', 'procesando']).limit(1);
  const generating = !!(ped && ped.length);

  if (rep?.report) {
    // Recorte por nivel del número (Ley 29733 + paywall): BASIC si no está vinculado con cupo.
    const bu = phone ? await getBotUser(phone) : null;
    const tier = await entitledBotTier(bu?.userId ?? null, placa);
    const report = stripByTier(rep.report as Report, tier);
    const summary = reportSummary(report);
    const status = summary.plateNotFound ? 'not_registered' : 'ready';
    return NextResponse.json({ ok: true, generating, status, tier, ...summary });
  }
  return NextResponse.json({ ok: true, generating, status: generating ? 'generating' : 'not_found', placa });
}
