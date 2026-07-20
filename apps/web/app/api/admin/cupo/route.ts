import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { isAdminEmail } from '@/lib/admin';
import { listCupoUsers, setCupo, type SetCupoInput } from '@/lib/admin-cupo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Verifica que la petición venga de un admin con sesión. Nunca confía en el cliente. */
async function isAdminRequest(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  return isAdminEmail(user?.email);
}

/** GET ?q=correo → lista/busca cuentas con su cupo. Sin q → cuentas con cupo activo. */
export async function GET(req: Request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
  const q = new URL(req.url).searchParams.get('q') ?? '';
  return NextResponse.json(await listCupoUsers(q));
}

/** POST { userId, enabled, tier, quotaHour, quotaDay, quotaWeek } → asigna nivel + cupo. */
export async function POST(req: Request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Partial<SetCupoInput>;
  if (!b.userId) return NextResponse.json({ ok: false, error: 'Falta userId.' }, { status: 400 });
  const r = await setCupo({
    userId: String(b.userId),
    enabled: Boolean(b.enabled),
    tier: b.tier === 'ULTRA' ? 'ULTRA' : 'PRO',
    quotaHour: Number(b.quotaHour ?? 5),
    quotaDay: Number(b.quotaDay ?? 20),
    quotaWeek: Number(b.quotaWeek ?? 100),
  });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
