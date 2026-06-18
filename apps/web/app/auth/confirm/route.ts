import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Verifica el enlace de confirmación de correo de Supabase (flujo token_hash,
 * recomendado para SSR) y redirige a una página de éxito en la web.
 * El template del correo apunta aquí:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/auth/confirmado
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const rawNext = searchParams.get('next') ?? '/auth/confirmado';
  const next = rawNext.startsWith('/') ? rawNext : '/auth/confirmado';

  // En Vercel el host público viene en x-forwarded-host.
  const forwardedHost = request.headers.get('x-forwarded-host');
  const isLocal = process.env.NODE_ENV === 'development';
  const baseUrl = !isLocal && forwardedHost ? `https://${forwardedHost}` : origin;

  if (isSupabaseConfigured && tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(`${baseUrl}${next}`);
    }
  }

  // Token inválido o expirado: pantalla de error con mensaje claro.
  return NextResponse.redirect(`${baseUrl}/auth/confirmado?error=1`);
}
