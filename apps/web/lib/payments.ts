/**
 * Lógica de compras (pago por reporte). Server-only: usa el cliente admin
 * (service_role) para escribir en `purchases`, y el cliente con sesión para leer
 * la titularidad del usuario (RLS).
 */
import { createAdminClient } from './supabase/admin';
import { createClient } from './supabase/server';
import type { PurchaseNotice } from './notifications';

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

/**
 * Marca la compra como pagada. Solo transiciona desde 'pending' (idempotente ante
 * reintentos del webhook). Devuelve `true` si esta llamada hizo la transición —
 * el llamador lo usa para notificar por correo UNA sola vez (no en cada reintento).
 */
export async function markPurchasePaid(orderId: string, providerRef: string | null): Promise<boolean> {
  const sb = createAdminClient();
  const { data, error } = await sb
    .from('purchases')
    .update({ status: 'paid', paid_at: new Date().toISOString(), provider_ref: providerRef })
    .eq('id', orderId)
    .eq('status', 'pending')
    .select('id');
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

/**
 * Datos de una compra + email del comprador, para notificar (webhook/panel admin,
 * que solo conocen el orderId). Usa el cliente admin (service_role + Auth admin).
 * Devuelve null si la compra no existe o no es de un tier de pago.
 */
export async function getPurchaseNotice(orderId: string): Promise<PurchaseNotice | null> {
  const sb = createAdminClient();
  const { data: purchase } = await sb
    .from('purchases')
    .select('user_id, plate, tier, amount, currency')
    .eq('id', orderId)
    .maybeSingle();
  if (!purchase) return null;
  const p = purchase as { user_id: string; plate: string; tier: string; amount: number; currency: string | null };
  if (p.tier !== 'PRO' && p.tier !== 'ULTRA') return null;

  const { data: userRes } = await sb.auth.admin.getUserById(p.user_id);
  const email = userRes?.user?.email ?? '';
  return {
    email,
    plate: p.plate,
    tier: p.tier,
    amount: Number(p.amount),
    currency: p.currency ?? 'PEN',
    orderId,
  };
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
