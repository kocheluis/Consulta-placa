/**
 * Notificaciones transaccionales de compras. Capa fina que compone la plantilla
 * y la envía con `sendEmail` (Resend). Server-only: importar solo desde route
 * handlers / server actions. Nunca lanza (delega en `sendEmail`, que devuelve
 * `{ok|skipped|error}`), así un fallo de correo no rompe el flujo de pago.
 *
 * Único punto de entrada para los tres orígenes de un cambio de estado de compra:
 * checkout (mock inline), webhook de IziPay y el (futuro) panel admin de Yape.
 */
import { sendEmail, type SendEmailResult } from './email';
import { purchasePaidEmail, yapeReceivedEmail } from './email-templates';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://placape.pe';
const YAPE_NUMBER = process.env.NEXT_PUBLIC_YAPE_NUMBER ?? '';
const YAPE_NAME = process.env.NEXT_PUBLIC_YAPE_NAME ?? 'PlacaPe';

/** Datos mínimos de una compra para notificar al comprador. */
export interface PurchaseNotice {
  email: string;
  plate: string;
  tier: 'PRO' | 'ULTRA';
  amount: number;
  currency?: string;
  orderId: string;
}

function reportUrl(plate: string): string {
  return `${SITE_URL}/reporte/${encodeURIComponent(plate.toUpperCase())}`;
}

const skipped = (reason: string): SendEmailResult => ({ ok: false, skipped: true, error: reason });

/** Avisa "pago confirmado · reporte desbloqueado" (mock inline / webhook / admin). */
export async function notifyPurchasePaid(n: PurchaseNotice): Promise<SendEmailResult> {
  if (!n.email) return skipped('compra sin email');
  const { subject, html } = purchasePaidEmail({
    plate: n.plate,
    tier: n.tier,
    amount: n.amount,
    currency: n.currency ?? 'PEN',
    orderId: n.orderId,
    reportUrl: reportUrl(n.plate),
  });
  return sendEmail({ to: n.email, subject, html });
}

/** Envía las instrucciones de Yape (pedido recibido, pago pendiente). */
export async function notifyYapeReceived(n: PurchaseNotice): Promise<SendEmailResult> {
  if (!n.email) return skipped('compra sin email');
  const { subject, html } = yapeReceivedEmail({
    plate: n.plate,
    tier: n.tier,
    amount: n.amount,
    currency: n.currency ?? 'PEN',
    orderId: n.orderId,
    yapeNumber: YAPE_NUMBER,
    yapeName: YAPE_NAME,
    reportUrl: reportUrl(n.plate),
  });
  return sendEmail({ to: n.email, subject, html });
}
