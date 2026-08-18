import { NextResponse } from 'next/server';
import { isAdminConfigured } from '@/lib/supabase/admin';
import { botAuthOk, verifyLink } from '@/lib/bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * BOT · verifica el OTP y vincula el número a la cuenta. Body `{ phone, code }`. Auth por token de
 * servicio (`x-bot-token`). Estados: linked | expired | invalid_code | too_many | no_pending | error.
 */
export async function POST(req: Request) {
  if (!botAuthOk(req)) return NextResponse.json({ ok: false, error: 'no autorizado' }, { status: 401 });
  if (!isAdminConfigured) return NextResponse.json({ ok: false, error: 'backend no configurado' }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { phone?: string; code?: string };
  const r = await verifyLink(String(body.phone ?? ''), String(body.code ?? ''));
  return NextResponse.json({ ok: r.status === 'linked', ...r });
}
