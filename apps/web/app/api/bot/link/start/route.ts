import { NextResponse } from 'next/server';
import { isAdminConfigured } from '@/lib/supabase/admin';
import { botAuthOk, startLink } from '@/lib/bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * BOT · inicia la vinculación de un número a una cuenta. Body `{ phone, email }`. Si existe una cuenta
 * con ese correo, envía un OTP por correo (Resend). Auth por token de servicio (`x-bot-token`).
 * Estados: otp_sent | no_account | invalid | error.
 */
export async function POST(req: Request) {
  if (!botAuthOk(req)) return NextResponse.json({ ok: false, error: 'no autorizado' }, { status: 401 });
  if (!isAdminConfigured) return NextResponse.json({ ok: false, error: 'backend no configurado' }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { phone?: string; email?: string };
  const { status } = await startLink(String(body.phone ?? ''), String(body.email ?? ''));
  return NextResponse.json({ ok: status === 'otp_sent', status });
}
