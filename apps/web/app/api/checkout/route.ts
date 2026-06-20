import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { TIER_PRICE, createPendingPurchase, markPurchasePaid, type PaidTier } from '@/lib/payments';
import { createPaymentSession } from '@/lib/izipay';
import { notifyPurchasePaid, notifyYapeReceived } from '@/lib/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Inicia la compra de un reporte (PRO/ULTRA) para una placa. Crea la compra en
 * estado 'pending' y abre la sesión de pago. En modo mock se aprueba al instante.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { plate?: string; tier?: string };
  const plate = String(body.plate ?? '').toUpperCase().trim();
  const tier: PaidTier | null = body.tier === 'ULTRA' ? 'ULTRA' : body.tier === 'PRO' ? 'PRO' : null;

  if (!plate || !tier) {
    return NextResponse.json({ error: 'Indica placa y plan (PRO/ULTRA).' }, { status: 400 });
  }

  // Sin Supabase configurado: modo demostración (no se registra ni se cobra nada).
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: true, status: 'paid', provider: 'mock', demo: true });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Inicia sesión para comprar tu reporte.' }, { status: 401 });
  }

  const amount = TIER_PRICE[tier];
  const orderId = await createPendingPurchase({ userId: user.id, plate, tier, amount });
  const session = await createPaymentSession({
    orderId,
    amount,
    currency: 'PEN',
    plate,
    tier,
    email: user.email ?? '',
  });

  const email = user.email ?? '';

  // Mock: el pago se aprueba inline (en real, lo confirma el webhook de IziPay).
  if (session.status === 'paid') {
    const paid = await markPurchasePaid(orderId, `mock-${orderId}`);
    if (paid) await notifyPurchasePaid({ email, plate, tier, amount, orderId });
    return NextResponse.json({ ok: true, status: 'paid', orderId, provider: session.provider });
  }

  // Pendiente: Yape manual → enviar instrucciones por correo (además del modal);
  // IziPay real → el front redirige a `redirectUrl`.
  if (session.provider === 'yape') {
    await notifyYapeReceived({ email, plate, tier, amount, orderId });
  }

  return NextResponse.json({ ok: true, status: 'pending', orderId, redirectUrl: session.redirectUrl });
}
