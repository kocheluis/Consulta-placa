/**
 * Fachada de cuentas: usa Supabase Auth cuando está configurado
 * (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY) y, si no, cae al backend legado
 * (lib/auth.ts → API Fastify). Toda la UI consume esta capa, no las dos.
 */
import { isSupabaseConfigured } from './supabase/config';
import * as legacy from './auth';

export type Tier = 'BASIC' | 'PRO' | 'ULTRA';

export interface Account {
  id: string;
  email: string;
  fullName?: string;
  tier: Tier;
  isPro: boolean;
  isActive: boolean;
}

export interface RegisterResult {
  account: Account | null;
  /** true si Supabase exige confirmar el correo antes de iniciar sesión. */
  needsConfirmation: boolean;
}

/** ¿La UI está operando contra Supabase (true) o el backend de prueba (false)? */
export const usingSupabase = isSupabaseConfigured;

/* ── Mensajes de error en español ─────────────────────────────────── */
function translate(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.';
  if (m.includes('already registered') || m.includes('already been registered'))
    return 'Ese correo ya está registrado. Inicia sesión.';
  if (m.includes('password should be at least')) return 'La contraseña debe tener al menos 8 caracteres.';
  if (m.includes('email not confirmed')) return 'Confirma tu correo antes de iniciar sesión.';
  if (m.includes('unable to validate email')) return 'Ingresa un correo válido.';
  if (m.includes('invalid path') || m.includes('failed to fetch'))
    return 'No pudimos conectar con el servidor de cuentas. Verifica la configuración de Supabase (URL del proyecto).';
  return message;
}

/* ── Camino Supabase ──────────────────────────────────────────────── */
async function sb() {
  const { createClient } = await import('./supabase/client');
  return createClient();
}

async function sbGetAccount(): Promise<Account | null> {
  const client = await sb();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;

  let tier: Tier = 'BASIC';
  let fullName: string | undefined = (user.user_metadata?.full_name as string | undefined) ?? undefined;

  const { data: profile } = await client
    .from('profiles')
    .select('tier, full_name')
    .eq('id', user.id)
    .maybeSingle();
  if (profile) {
    tier = (profile.tier as Tier) ?? 'BASIC';
    fullName = profile.full_name ?? fullName;
  }

  return { id: user.id, email: user.email ?? '', fullName, tier, isPro: tier !== 'BASIC', isActive: true };
}

/* ── Camino legado (mapeo a la forma de Account) ──────────────────── */
function fromLegacy(a: legacy.Account): Account {
  const tier: Tier = a.isPro && a.isActive ? 'PRO' : 'BASIC';
  return { id: a.id, email: a.email, tier, isPro: a.isPro, isActive: a.isActive };
}

/* ── API pública ──────────────────────────────────────────────────── */
export async function register(email: string, password: string, fullName?: string): Promise<RegisterResult> {
  if (usingSupabase) {
    const client = await sb();
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: fullName ? { full_name: fullName } : undefined },
    });
    if (error) throw new Error(translate(error.message));
    if (!data.session) return { account: null, needsConfirmation: true };
    return { account: await sbGetAccount(), needsConfirmation: false };
  }
  await legacy.register(email, password);
  const acc = await legacy.login(email, password);
  return { account: fromLegacy(acc), needsConfirmation: false };
}

export async function login(email: string, password: string): Promise<Account | null> {
  if (usingSupabase) {
    const client = await sb();
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(translate(error.message));
    return sbGetAccount();
  }
  return fromLegacy(await legacy.login(email, password));
}

/** Proveedores OAuth soportados (deben estar habilitados en Supabase Auth). */
export type OAuthProvider = 'google' | 'facebook';

/**
 * Inicia sesión con un proveedor social. Redirige el navegador al proveedor; al
 * volver, /auth/callback canjea el código por sesión. Requiere Supabase.
 */
export async function signInWithProvider(provider: OAuthProvider): Promise<void> {
  if (!usingSupabase) throw new Error('El acceso con Google/Facebook requiere Supabase configurado.');
  const client = await sb();
  const redirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}/auth/callback?next=/cuenta` : undefined;
  const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo } });
  if (error) throw new Error(translate(error.message));
}

export async function logout(): Promise<void> {
  if (usingSupabase) {
    const client = await sb();
    await client.auth.signOut();
    return;
  }
  legacy.clearToken();
}

export async function getAccount(): Promise<Account | null> {
  if (usingSupabase) return sbGetAccount();
  const acc = await legacy.fetchMe();
  return acc ? fromLegacy(acc) : null;
}

export interface ReportHistoryItem {
  id: string;
  plate: string;
  tier: Tier;
  status: string; // pending | paid | failed
  amount: number;
  createdAt: string;
  paidAt: string | null;
}

/**
 * Reportes comprados por el usuario (tabla `purchases`, RLS). Devuelve [] si
 * Supabase no está configurado o si la tabla aún no existe (migración 0002).
 */
export async function getMyReports(): Promise<ReportHistoryItem[]> {
  if (!usingSupabase) return [];
  try {
    const client = await sb();
    const { data, error } = await client
      .from('purchases')
      .select('id, plate, tier, status, amount, created_at, paid_at')
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      plate: String(r.plate),
      tier: (r.tier as Tier) ?? 'PRO',
      status: String(r.status),
      amount: Number(r.amount ?? 0),
      createdAt: String(r.created_at),
      paidAt: r.paid_at ? String(r.paid_at) : null,
    }));
  } catch {
    return [];
  }
}
