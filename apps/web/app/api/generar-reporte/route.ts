import { NextResponse } from 'next/server';
import { isAdminConfigured } from '@/lib/supabase/admin';
import { enqueuePaidReport } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Asegura la generación del reporte del NIVEL PAGADO (PRO/ULTRA) de una placa. La llama la web
 * cuando el usuario tiene el nivel desbloqueado pero el reporte guardado aún no lo cubre, para
 * que el motor lo genere y la pantalla de carga termine resolviéndose. Verifica el pago server-side.
 */
export async function POST(req: Request) {
  if (!isAdminConfigured) {
    return NextResponse.json({ ok: false, status: 'invalid' }, { status: 503 });
  }
  const body = (await req.json().catch(() => ({}))) as { placa?: string };
  const r = await enqueuePaidReport(String(body?.placa ?? ''));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
