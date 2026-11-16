import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createAdminClient, isAdminConfigured } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { enqueuePaidReport } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PRUEBA GRATIS del reporte Completo: 1 por cuenta Y por dispositivo (migración 0012, tabla `trial_uses`).
 * Un dispositivo se reconoce por cualquiera de 3 señales: cookie httpOnly `pp_dev` (la pone este endpoint),
 * id en localStorage y huella del navegador (lib/device.ts). Si alguna ya usó la prueba, no hay otra
 * aunque la cuenta sea nueva. La IP solo frena abusos masivos (máx. 3 pruebas por IP en 30 días).
 * Al conceder: compra de S/ 0 (provider 'prueba') en `purchases` → el reporte se desbloquea y se genera
 * exactamente como uno pagado (mismo flujo, mismo paywall).
 */
const COOKIE = 'pp_dev';
const MAX_POR_IP = 3;
const norm = (p: string): string => p.toUpperCase().replace(/[^A-Z0-9]/g, '');
const clean = (v: unknown): string => String(v ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 80);

async function deviceCookie(): Promise<{ id: string; isNew: boolean }> {
  const jar = await cookies();
  const cur = clean(jar.get(COOKIE)?.value);
  return cur ? { id: cur, isNew: false } : { id: crypto.randomUUID(), isNew: true };
}

function withCookie(res: NextResponse, dev: { id: string; isNew: boolean }): NextResponse {
  if (dev.isNew) res.cookies.set(COOKIE, dev.id, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 730 });
  return res;
}

/** ¿Alguna señal del dispositivo (o la cuenta) ya usó la prueba? */
async function yaUsada(userId: string, deviceId: string, localId: string, fp: string): Promise<boolean> {
  const ors = [`user_id.eq.${userId}`, `device_id.eq.${deviceId}`];
  if (localId) ors.push(`local_id.eq.${localId}`);
  if (fp) ors.push(`fp_hash.eq.${fp}`);
  const { data, error } = await createAdminClient().from('trial_uses').select('user_id').or(ors.join(',')).limit(1);
  if (error) throw new Error('trial_uses no disponible (¿falta la migración 0012?)');
  return (data ?? []).length > 0;
}

/** GET ?l=localId&f=fp → ¿esta cuenta, en este dispositivo, puede usar la prueba? */
export async function GET(req: Request) {
  const dev = await deviceCookie();
  if (!isAdminConfigured) return withCookie(NextResponse.json({ eligible: false }), dev);
  const { data: auth } = await (await createClient()).auth.getUser();
  if (!auth.user) return withCookie(NextResponse.json({ eligible: false, reason: 'auth_required' }), dev);
  const qs = new URL(req.url).searchParams;
  try {
    const used = await yaUsada(auth.user.id, dev.id, clean(qs.get('l')), clean(qs.get('f')));
    return withCookie(NextResponse.json({ eligible: !used }), dev);
  } catch {
    return withCookie(NextResponse.json({ eligible: false, reason: 'no_disponible' }), dev);
  }
}

/** POST { placa, localId, fp } → concede la prueba (si corresponde) y encola el reporte Completo. */
export async function POST(req: Request) {
  const dev = await deviceCookie();
  if (!isAdminConfigured) return NextResponse.json({ ok: false, error: 'no_disponible' }, { status: 503 });
  const { data: auth } = await (await createClient()).auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ ok: false, error: 'auth_required' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { placa?: unknown; localId?: unknown; fp?: unknown };
  const placa = norm(String(body.placa ?? ''));
  if (placa.length < 6 || placa.length > 7) return NextResponse.json({ ok: false, error: 'placa_invalida' }, { status: 400 });
  const localId = clean(body.localId);
  const fp = clean(body.fp);
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
  const sb = createAdminClient();
  const usada = () => withCookie(NextResponse.json({ ok: false, error: 'prueba_usada' }, { status: 409 }), dev);

  try {
    if (await yaUsada(user.id, dev.id, localId, fp)) return usada();
    if (ip) {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { count } = await sb.from('trial_uses').select('user_id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', since);
      if ((count ?? 0) >= MAX_POR_IP) return usada();
    }
    // No regalar la prueba en una placa inexistente.
    const { data: rep } = await sb.from('reportes').select('report').eq('placa', placa).maybeSingle();
    if ((rep?.report as { plateNotFound?: boolean } | null)?.plateNotFound) {
      return withCookie(NextResponse.json({ ok: false, error: 'placa_no_registrada' }, { status: 400 }), dev);
    }
    // user_id es PK → si dos pestañas lo piden a la vez, solo una inserta.
    const { error: insErr } = await sb.from('trial_uses').insert({ user_id: user.id, placa, device_id: dev.id, local_id: localId || null, fp_hash: fp || null, ip });
    if (insErr) return usada();
    const { error: purErr } = await sb.from('purchases').insert({
      user_id: user.id, plate: placa, tier: 'ULTRA', amount: 0, status: 'paid', provider: 'prueba',
      provider_ref: `prueba-${user.id}`, paid_at: new Date().toISOString(),
    });
    if (purErr) throw new Error(purErr.message);
  } catch (e) {
    console.error('[prueba-completa]', (e as Error).message);
    return withCookie(NextResponse.json({ ok: false, error: 'no_disponible' }, { status: 503 }), dev);
  }
  const q = await enqueuePaidReport(placa);
  return withCookie(NextResponse.json({ ok: true, status: q.status }), dev);
}
