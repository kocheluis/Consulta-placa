/**
 * Lógica de compras (pago por reporte). Server-only: usa el cliente admin
 * (service_role) para escribir en `purchases`, y el cliente con sesión para leer
 * la titularidad del usuario (RLS).
 */
import { createAdminClient } from './supabase/admin';
import { createClient } from './supabase/server';

export type PaidTier = 'PRO' | 'ULTRA';

/** Precios de lanzamiento (S/). Fuente de verdad del monto cobrado. */
export const TIER_PRICE: Record<PaidTier, number> = { PRO: 15.9, ULTRA: 19.9 };

export async function createPendingPurchase(p: {
  userId: string;
  plate: string;
  tier: PaidTier;
  amount: number;
}): Promise<string> {
  const sb = createAdminClient();
  const { data, error } = await sb
    .from('purchases')
    .insert({
      user_id: p.userId,
      plate: p.plate,
      tier: p.tier,
      amount: p.amount,
      status: 'pending',
      provider: 'izipay',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'No se pudo registrar la compra.');
  return (data as { id: string }).id;
}

export async function markPurchasePaid(orderId: string, providerRef: string | null): Promise<void> {
  const sb = createAdminClient();
  // Solo transiciona desde 'pending' (idempotente ante reintentos del webhook).
  const { error } = await sb
    .from('purchases')
    .update({ status: 'paid', paid_at: new Date().toISOString(), provider_ref: providerRef })
    .eq('id', orderId)
    .eq('status', 'pending');
  if (error) throw new Error(error.message);
}

export async function markPurchaseFailed(orderId: string): Promise<void> {
  const sb = createAdminClient();
  await sb.from('purchases').update({ status: 'failed' }).eq('id', orderId).eq('status', 'pending');
}

/** Nivel desbloqueado por el usuario para una placa (BASIC si no compró). */
export async function getPaidTier(plate: string): Promise<'BASIC' | PaidTier> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return 'BASIC';
  const { data } = await sb
    .from('purchases')
    .select('tier')
    .eq('user_id', user.id)
    .eq('plate', plate.toUpperCase())
    .eq('status', 'paid');
  const rows = (data ?? []) as { tier: string }[];
  if (rows.length === 0) return 'BASIC';
  return rows.some((r) => r.tier === 'ULTRA') ? 'ULTRA' : 'PRO';
}
