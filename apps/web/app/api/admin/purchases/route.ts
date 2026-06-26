import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { isAdminEmail } from '@/lib/admin';
import { enqueueReportForPurchase, getPurchaseNotice, markPurchaseFailed, markPurchasePaid } from '@/lib/payments';
import { notifyPurchasePaid } from '@/lib/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Verifica que la petición venga de un admin con sesión. Nunca confía en el cliente. */
async function isAdminRequest(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return isAdminEmail(user?.email);
}

/**
 * Acciones del panel admin sobre una compra (pago Yape manual).
 *   { orderId, action: 'confirm' } → marca pagado + envía recibo por correo.
 *   { orderId, action: 'reject'  } → marca fallida.
 * Idempotente: confirmar solo notifica si la compra realmente pasó pending→paid.
 */
export async function POST(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { orderId?: string; action?: string };
  const orderId = String(body.orderId ?? '').trim();
  const action = body.action;
  if (!orderId) return NextResponse.json({ error: 'Falta orderId.' }, { status: 400 });

  try {
    if (action === 'confirm') {
      const transitioned = await markPurchasePaid(orderId, 'yape-admin');
      if (transitioned) {
        await enqueueReportForPurchase(orderId); // encola el reporte para el motor del VPS
        const notice = await getPurchaseNotice(orderId);
        if (notice) await notifyPurchasePaid(notice);
      }
      return NextResponse.json({ ok: true, status: 'paid', transitioned });
    }
    if (action === 'reject') {
      await markPurchaseFailed(orderId);
      return NextResponse.json({ ok: true, status: 'failed' });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json({ error: 'Acción inválida.' }, { status: 400 });
}
