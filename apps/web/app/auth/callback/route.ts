import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { safeNext } from '@/lib/next-path';

export const dynamic = 'force-dynamic';

/**
 * Callback de OAuth (Google/Facebook). Supabase redirige aquí con `?code=…`;
 * se canjea por sesión (flujo PKCE, el verifier viaja en cookie httpOnly) y se
 * envía al usuario a su cuenta. Si falla, vuelve al acceso.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  // safeNext: solo rutas INTERNAS ("/x", nunca "//dominio" ni "/dominio") → sin open redirect.
  const next = safeNext(searchParams.get('next')) ?? '/cuenta';

  if (isSupabaseConfigured && code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) redirect(next);
  }

  redirect('/cuenta');
}
