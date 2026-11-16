import { NextResponse } from 'next/server';
import { createAdminClient, isAdminConfigured } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email';
import { passwordResetEmail, socialOnlyAccountEmail } from '@/lib/email-templates';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://placape.pe';
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Freno básico por correo e IP (por instancia): evita usar el formulario para bombardear un buzón.
const recent = new Map<string, number>();
const WINDOW_MS = 60_000;

function throttled(key: string): boolean {
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > WINDOW_MS) recent.delete(k);
  if (recent.has(key)) return true;
  recent.set(key, now);
  return false;
}

/**
 * Recuperación de contraseña. Genera el enlace con la API admin de Supabase y lo envía con Resend
 * (el SMTP por defecto de Supabase solo entrega a correos del equipo y con tope por hora → no llegaba).
 * Responde SIEMPRE lo mismo, exista o no la cuenta, para no revelar qué correos están registrados.
 * Si la cuenta se creó solo con Google/Facebook, le avisa que entre con ese proveedor.
 */
export async function POST(req: Request) {
  const ok = NextResponse.json({ ok: true });
  const body = (await req.json().catch(() => ({}))) as { email?: unknown };
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!EMAIL_RX.test(email) || email.length > 200) return NextResponse.json({ ok: false, error: 'email_invalido' }, { status: 400 });
  if (!isAdminConfigured) return NextResponse.json({ ok: false, error: 'no_configurado' }, { status: 503 });

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'ip?';
  if (throttled(`e:${email}`) || throttled(`i:${ip}`)) return ok;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
    if (error || !data?.properties?.hashed_token) return ok; // cuenta inexistente → misma respuesta
    const providers = (data.user?.app_metadata?.providers as string[] | undefined) ?? [];
    if (providers.length && !providers.includes('email')) {
      const mail = socialOnlyAccountEmail({ providers, loginUrl: `${SITE_URL}/cuenta` });
      await sendEmail({ to: email, ...mail });
      return ok;
    }
    const link = `${SITE_URL}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery&next=${encodeURIComponent('/cuenta/nueva-clave')}`;
    const mail = passwordResetEmail({ link });
    const sent = await sendEmail({ to: email, ...mail });
    if (!sent.ok) console.warn('[recuperar] envío falló:', sent.error);
  } catch (e) {
    console.warn('[recuperar] error:', e instanceof Error ? e.message : e);
  }
  return ok;
}
