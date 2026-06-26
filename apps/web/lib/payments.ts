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
  provider?: string;
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
      provider: p.provider ?? 'izipay',
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
 * Encola el pedido de reporte para el motor del VPS (cola `pedidos` = broker, modelo B).
 * Se llama UNA vez tras confirmar el pago (transición pending→paid). Resiliente: si falla
 * NO rompe la confirmación del pago (el reporte se puede reprocesar). Evita duplicar si ya
 * existe un pedido activo para esa placa+usuario.
 */
export async function enqueueReportForPurchase(orderId: string): Promise<void> {
  try {
    const sb = createAdminClient();
    const { data: purchase } = await sb
      .from('purchases')
      .select('user_id, plate')
      .eq('id', orderId)
      .maybeSingle();
    if (!purchase) return;
    const p = purchase as { user_id: string; plate: string };

    const { data: existing } = await sb
      .from('pedidos')
      .select('id')
      .eq('user_id', p.user_id)
      .eq('placa', p.plate)
      .in('estado', ['pendiente', 'procesando', 'listo'])
      .limit(1);
    if (existing && existing.length) return; // ya encolado/atendido

    const { data: u } = await sb.auth.admin.getUserById(p.user_id);
    await sb.from('pedidos').insert({
      placa: p.plate,
      email: u?.user?.email ?? null,
      user_id: p.user_id,
      estado: 'pendiente',
    });
  } catch (e) {
    console.error('[pedidos] enqueue falló (no bloquea el pago):', (e as Error).message);
  }
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

export interface PendingPurchase {
  orderId: string;
  plate: string;
  tier: PaidTier;
  amount: number;
  currency: string;
  provider: string;
  email: string;
  createdAt: string;
}

/**
 * Lista las compras pendientes (panel admin de Yape). Resuelve el correo del
 * comprador por cada `user_id` (cacheado). Usa el cliente admin (service_role).
 */
export async function listPendingPurchases(limit = 100): Promise<PendingPurchase[]> {
  const sb = createAdminClient();
  const { data, error } = await sb
    .from('purchases')
    .select('id, user_id, plate, tier, amount, currency, provider, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];

  const rows = data as Array<{
    id: string;
    user_id: string;
    plate: string;
    tier: PaidTier;
    amount: number;
    currency: string | null;
    provider: string | null;
    created_at: string;
  }>;

  const emailByUser = new Map<string, string>();
  const out: PendingPurchase[] = [];
  for (const r of rows) {
    let email = emailByUser.get(r.user_id);
    if (email === undefined) {
      const { data: u } = await sb.auth.admin.getUserById(r.user_id);
      email = u?.user?.email ?? '';
      emailByUser.set(r.user_id, email);
    }
    out.push({
      orderId: r.id,
      plate: r.plate,
      tier: r.tier,
      amount: Number(r.amount),
      currency: r.currency ?? 'PEN',
      provider: r.provider ?? 'yape',
      email,
      createdAt: r.created_at,
    });
  }
  return out;
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
