import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { isAdminEmail } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ¿La sesión actual pertenece a un administrador? Permite que el cliente
 * (pantalla de cuenta) muestre el acceso al panel de pagos sin exponer
 * `ADMIN_EMAILS` (server-only). Nunca confía en el cliente: resuelve el
 * correo desde la sesión de Supabase en el servidor.
 */
export async function GET() {
  if (!isSupabaseConfigured) return NextResponse.json({ isAdmin: false });
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return NextResponse.json({ isAdmin: isAdminEmail(user?.email) });
}
