import { NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/izipay';
import { enqueueReportForPurchase, getPurchaseNotice, markPurchaseFailed, markPurchasePaid } from '@/lib/payments';
import { notifyPurchasePaid } from '@/lib/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook de IziPay (IPN). Verifica la firma, marca la compra como pagada/fallida
 * con el cliente admin (service_role) y responde 200. Es el endpoint estable que
 * confirma el pago aunque el usuario cierre la ventana.
 *
 * Probar en mock:  curl -X POST .../api/webhooks/izipay \
 *   -H 'kr-hash: mock' -H 'content-type: application/json' \
 *   -d '{"orderId":"<uuid>","orderStatus":"PAID","transactionId":"t1"}'
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get('kr-hash') ?? request.headers.get('x-izipay-signature');

  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: 'Firma inválida' }, { status: 401 });
  }

  let event: { orderId?: string; orderStatus?: string; status?: string; transactionId?: string };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 });
  }

  const orderId = event.orderId;
  const status = (event.orderStatus ?? event.status ?? '').toUpperCase();
  if (!orderId) {
    return NextResponse.json({ error: 'Falta orderId' }, { status: 400 });
  }

  try {
    if (status === 'PAID') {
      // Solo notifica si esta llamada hizo la transición (evita correos duplicados
      // ante reintentos del IPN).
      const transitioned = await markPurchasePaid(orderId, event.transactionId ?? null);
      if (transitioned) {
        await enqueueReportForPurchase(orderId); // encola el reporte para el motor del VPS
        const notice = await getPurchaseNotice(orderId);
        if (notice) await notifyPurchasePaid(notice);
      }
    } else if (status === 'FAILED' || status === 'CANCELLED') {
      await markPurchaseFailed(orderId);
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
