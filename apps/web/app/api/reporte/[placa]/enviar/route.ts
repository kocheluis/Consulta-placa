import { NextResponse } from 'next/server';
import { createAdminClient, isAdminConfigured } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email';
import { reportReadyEmail } from '@/lib/email-templates';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://placape.pe';
const norm = (p: string): string => p.toUpperCase().replace(/[^A-Z0-9]/g, '');
const lastSend = new Map<string, number>();

/**
 * "Enviar por correo": manda el enlace del reporte al correo de la CUENTA en sesión (nunca a una
 * dirección escrita por el usuario → no sirve para enviar spam con nuestro dominio). Con `snap` envía el
 * enlace a la copia CONGELADA del historial (verifica que sea suya). 1 envío por minuto por cuenta.
 */
export async function POST(req: Request, { params }: { params: Promise<{ placa: string }> }) {
  const placa = norm((await params).placa);
  const body = (await req.json().catch(() => ({}))) as { snap?: unknown };
  const snap = typeof body.snap === 'string' && /^[0-9a-f-]{36}$/i.test(body.snap) ? body.snap : null;
  const { data: auth } = await (await createClient()).auth.getUser();
  const email = auth.user?.email;
  if (!auth.user || !email) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const now = Date.now();
  if (now - (lastSend.get(auth.user.id) ?? 0) < 60_000) return NextResponse.json({ error: 'espera_un_minuto' }, { status: 429 });

  let tier: 'BASIC' | 'PRO' | 'ULTRA' = 'BASIC';
  if (snap) {
    if (!isAdminConfigured) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const { data } = await createAdminClient().from('reportes_usuario').select('placa, tier, expires_at')
      .eq('id', snap).eq('user_id', auth.user.id).maybeSingle();
    if (!data || data.placa !== placa || Date.parse(data.expires_at) <= now) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    tier = data.tier;
  }
  const reportUrl = `${SITE_URL}/reporte/${encodeURIComponent(placa)}${snap ? `?snap=${snap}` : ''}`;
  const mail = reportReadyEmail({ plate: placa, reportUrl, tier });
  lastSend.set(auth.user.id, now);
  const sent = await sendEmail({ to: email, ...mail });
  if (!sent.ok) return NextResponse.json({ error: sent.skipped ? 'correo_no_configurado' : 'envio_fallido' }, { status: 502 });
  return NextResponse.json({ ok: true, to: email });
}
