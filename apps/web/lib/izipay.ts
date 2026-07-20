import crypto from 'node:crypto';

/**
 * Abstracción de la pasarela IziPay (Lyra). Mientras no haya cuenta/credenciales
 * opera en **modo mock**: el pago se aprueba al instante para poder probar el flujo
 * de extremo a extremo en marcha blanca. Al configurar IZIPAY_SHOP_ID/SECRET_KEY
 * se cablea la integración real (formToken + verificación de webhook).
 */
export const IZIPAY_CONFIGURED = Boolean(
  process.env.IZIPAY_SHOP_ID && process.env.IZIPAY_SECRET_KEY,
);

/** Modo interino: cobro con Yape PERSONAL (manual). El usuario yapea con la
 *  referencia del pedido y un admin confirma la compra (no hay webhook de Yape
 *  personal). Se activa al definir NEXT_PUBLIC_YAPE_NUMBER y sin IziPay. */
export const YAPE_MANUAL_ENABLED = Boolean(process.env.NEXT_PUBLIC_YAPE_NUMBER) && !IZIPAY_CONFIGURED;

/** Proveedor de pago efectivo según la configuración (para etiquetar la compra). */
export function paymentProvider(): 'izipay' | 'yape' | 'mock' {
  if (IZIPAY_CONFIGURED) return 'izipay';
  if (YAPE_MANUAL_ENABLED) return 'yape';
  return 'mock';
}

export interface PaymentRequest {
  orderId: string;
  amount: number;
  currency: string;
  plate: string;
  tier: 'PRO' | 'ULTRA';
  email: string;
}

export interface PaymentSession {
  provider: 'mock' | 'izipay' | 'yape';
  /** 'paid' = aprobado inline (mock); 'pending' = falta confirmar (Yape/IziPay). */
  status: 'paid' | 'pending';
  redirectUrl?: string;
}

/** Crea la sesión de pago según el modo configurado. */
export async function createPaymentSession(_req: PaymentRequest): Promise<PaymentSession> {
  if (IZIPAY_CONFIGURED) {
    // TODO(IziPay): POST /api-payment/V4/Charge/CreatePayment con Basic auth
    // (shopId:secretKey) → formToken; el front lo usa con KR (Krypton). Aquí se
    // devolvería { provider:'izipay', status:'pending', redirectUrl } o el formToken.
    throw new Error('Integración IziPay pendiente: completa createPaymentSession (formToken).');
  }
  // Yape personal (manual): queda pendiente hasta que un admin confirme el pago.
  if (YAPE_MANUAL_ENABLED) {
    return { provider: 'yape', status: 'pending' };
  }
  // Dev / sin pasarela: mock aprueba al instante para probar el flujo.
  return { provider: 'mock', status: 'paid' };
}

/**
 * Verifica la firma HMAC-SHA256 del webhook (Lyra envía `kr-hash`).
 *
 * SEGURIDAD (C-1): sin `IZIPAY_SECRET_KEY` configurado el webhook FALLA CERRADO. Antes aceptaba el
 * header `kr-hash: 'mock'` por defecto → cualquiera podía marcar una compra como pagada y sacar un
 * reporte PRO/ULTRA gratis (el flujo Yape manual confirma por el panel admin, NO por este webhook,
 * así que cerrarlo no afecta los pagos reales). El modo mock ahora SOLO existe en dev local y con una
 * env EXPLÍCITA (`ALLOW_MOCK_WEBHOOK=1`): nunca en producción ni en previews (NODE_ENV='production').
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.IZIPAY_SECRET_KEY ?? '';
  if (!secret) {
    // Fallar cerrado. El mock solo en dev local con opt-in explícito (jamás por defecto ni en deploy).
    return (
      process.env.NODE_ENV !== 'production' &&
      process.env.ALLOW_MOCK_WEBHOOK === '1' &&
      signature === 'mock'
    );
  }
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
