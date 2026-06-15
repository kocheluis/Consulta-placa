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

export interface PaymentRequest {
  orderId: string;
  amount: number;
  currency: string;
  plate: string;
  tier: 'PRO' | 'ULTRA';
  email: string;
}

export interface PaymentSession {
  provider: 'mock' | 'izipay';
  /** 'paid' = aprobado inline (mock); 'pending' = redirige a la pasarela. */
  status: 'paid' | 'pending';
  redirectUrl?: string;
}

/** Crea la sesión de pago. En mock aprueba al instante. */
export async function createPaymentSession(_req: PaymentRequest): Promise<PaymentSession> {
  if (!IZIPAY_CONFIGURED) {
    return { provider: 'mock', status: 'paid' };
  }
  // TODO(IziPay): POST /api-payment/V4/Charge/CreatePayment con Basic auth
  // (shopId:secretKey) → formToken; el front lo usa con KR (Krypton). Aquí se
  // devolvería { provider:'izipay', status:'pending', redirectUrl } o el formToken.
  throw new Error('Integración IziPay pendiente: define IZIPAY_SHOP_ID e IZIPAY_SECRET_KEY.');
}

/**
 * Verifica la firma HMAC-SHA256 del webhook (Lyra envía `kr-hash`).
 * En mock (sin secreto) acepta solo si el header trae el token de prueba.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.IZIPAY_SECRET_KEY ?? '';
  if (!secret) {
    // Modo mock: acepta el webhook de prueba marcado explícitamente.
    return signature === 'mock';
  }
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
