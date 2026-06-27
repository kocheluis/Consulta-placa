'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  login,
  register,
  signInWithProvider,
  getAccount,
  logout,
  getMyReports,
  usingSupabase,
  type Account,
  type ReportHistoryItem,
} from '@/lib/account';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Badge';

type View = 'login' | 'register' | 'forgot';

/* ── Panel de marca (columna izquierda) ───────────────────────────── */
const TRUST_POINTS = [
  { icon: 'account_balance', t: '+10 fuentes nacionales', d: 'SUNARP, SAT, SBS, MTC, SUTRAN, ONPE y más.' },
  { icon: 'bolt', t: 'Resultado en segundos', d: 'Consolidamos todo en un reporte claro.' },
  { icon: 'lock', t: 'Pago y datos protegidos', d: 'Cifrado de extremo a extremo en cada consulta.' },
];

function BrandPanel() {
  return (
    <div
      className="relative hidden flex-col overflow-hidden p-11 text-white md:flex"
      style={{ background: 'linear-gradient(165deg, #103D52 0%, #0A2E3D 55%, #06222E 100%)' }}
    >
      <div
        className="pointer-events-none absolute -right-28 -top-28 h-80 w-80 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(22,181,163,.22), transparent 70%)' }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo-placape-light.svg" alt="PlacaPe" className="relative h-8 self-start" />

      <div className="relative flex flex-1 flex-col justify-center">
        <h2 className="mb-3.5 font-heading text-[32px] font-extrabold leading-[1.12] tracking-tight">
          Conoce el historial
          <br />
          antes de comprar
        </h2>
        <p className="mb-8 max-w-sm text-base leading-relaxed text-azul-200">
          Verifica cualquier placa del Perú y compra tu próximo vehículo con total tranquilidad.
        </p>
        <div className="flex flex-col gap-[18px]">
          {TRUST_POINTS.map((p) => (
            <div key={p.t} className="flex items-start gap-3.5">
              <div className="grid h-10 w-10 flex-none place-items-center rounded-md border border-teal-400/40 bg-teal-400/15">
                <Icon name={p.icon} className="text-[22px] text-teal-300" />
              </div>
              <div>
                <p className="font-body text-[15px] font-bold">{p.t}</p>
                <p className="mt-0.5 text-[13.5px] leading-snug text-azul-200">{p.d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="relative flex items-center gap-2.5">
        <div className="flex">
          {['#2D7FA0', '#13A091', '#1A6584', '#0F8A7E'].map((c, i) => (
            <span
              key={c}
              className="h-7 w-7 rounded-full border-2 border-azul-900"
              style={{ background: c, marginLeft: i ? -8 : 0 }}
            />
          ))}
        </div>
        <span className="text-[13.5px] text-azul-200">
          Compradores de todo el Perú verifican con PlacaPe
        </span>
      </div>
    </div>
  );
}

/* ── Login social (Supabase OAuth: Google + Facebook) ─────────────── */
function SocialButtons({ onError }: { onError: (m: string) => void }) {
  const [busy, setBusy] = useState<'google' | 'facebook' | null>(null);
  const go = async (provider: 'google' | 'facebook') => {
    setBusy(provider);
    try {
      await signInWithProvider(provider);
      // En éxito, el navegador se redirige al proveedor (no vuelve aquí).
    } catch (err) {
      onError((err as Error).message);
      setBusy(null);
    }
  };
  const base =
    'flex flex-1 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 py-3 font-body text-sm font-semibold text-foreground transition-colors hover:bg-azul-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed';
  return (
    <div className="flex gap-2.5">
      <button type="button" onClick={() => go('google')} disabled={busy !== null} className={base}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.4h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5z" />
          <path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18z" />
          <path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8l3-2.3z" />
          <path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6z" />
        </svg>
        {busy === 'google' ? 'Conectando…' : 'Google'}
      </button>
      <button type="button" onClick={() => go('facebook')} disabled={busy !== null} className={base}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.25h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z" />
        </svg>
        {busy === 'facebook' ? 'Conectando…' : 'Facebook'}
      </button>
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="my-4 flex items-center gap-3">
      <div className="h-px flex-1 bg-border" />
      <span className="font-body text-xs font-semibold text-muted">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

/* ── Pantalla de cuenta (logueado) ────────────────────────────────── */
const fmtDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
};
const STATUS: Record<string, { tone: 'success' | 'warning' | 'danger'; label: string }> = {
  paid: { tone: 'success', label: 'Pagado' },
  pending: { tone: 'warning', label: 'Pendiente' },
  failed: { tone: 'danger', label: 'Fallido' },
};

function ReportRow({ r }: { r: ReportHistoryItem }) {
  const st = STATUS[r.status] ?? STATUS.pending;
  return (
    <div className="flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0">
      <div className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-azul-50">
        <Icon name="directions_car" className="text-[22px] text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold tracking-wide text-foreground">{r.plate}</span>
          <Badge tone={r.tier === 'ULTRA' ? 'brand' : 'info'} size="sm" icon={r.tier === 'ULTRA' ? 'bolt' : null}>
            {r.tier === 'ULTRA' ? 'Ultra' : 'Pro'}
          </Badge>
        </div>
        <p className="mt-0.5 font-body text-[13px] text-muted">{fmtDate(r.createdAt)}</p>
      </div>
      <Badge tone={st.tone} size="sm" icon={null}>
        {st.label}
      </Badge>
      {r.status === 'paid' && (
        <Button variant="ghost" size="sm" iconRight="arrow_forward" href={`/reporte/${r.plate}`}>
          Ver
        </Button>
      )}
    </div>
  );
}

function AccountView({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const [reports, setReports] = useState<ReportHistoryItem[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    getMyReports().then(setReports).catch(() => setReports([]));
    // ¿Esta cuenta es admin? El servidor decide (ADMIN_EMAILS es server-only);
    // si lo es, mostramos el acceso al panel de confirmación de pagos Yape.
    fetch('/api/admin/me')
      .then((r) => (r.ok ? r.json() : { isAdmin: false }))
      .then((d) => setIsAdmin(Boolean(d?.isAdmin)))
      .catch(() => setIsAdmin(false));
  }, []);

  const firstName = account.fullName?.trim().split(/\s+/)[0];
  const paid = (reports ?? []).filter((r) => r.status === 'paid');

  return (
    <div className="mx-auto max-w-[960px] px-4 py-12 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-[26px] font-extrabold tracking-tight text-foreground">
            Hola{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="font-body text-sm text-muted">Tus reportes y datos de cuenta.</p>
        </div>
        <Button variant="secondary" size="sm" icon="add" href="/">
          Nueva consulta
        </Button>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_300px]">
        {/* Mis reportes */}
        <div className="order-2 lg:order-1">
          <h2 className="mb-3 font-heading text-lg font-bold text-foreground">Mis reportes</h2>
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            {reports === null ? (
              <div className="p-8 text-center font-body text-sm text-muted">Cargando…</div>
            ) : paid.length > 0 ? (
              paid.map((r) => <ReportRow key={r.id} r={r} />)
            ) : (
              <div className="px-6 py-12 text-center">
                <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-azul-50">
                  <Icon name="description" className="text-[24px] text-primary" />
                </div>
                <p className="font-body font-semibold text-foreground">Aún no tienes reportes comprados</p>
                <p className="mx-auto mt-1 max-w-xs font-body text-sm text-muted">
                  Cuando compres un reporte Pro o Ultra, aparecerá aquí para volver a verlo.
                </p>
                <div className="mt-4">
                  <Button variant="accent" size="sm" href="/" iconRight="arrow_forward">
                    Consultar una placa
                  </Button>
                </div>
              </div>
            )}
          </div>
          {!usingSupabase && (
            <p className="mt-3 font-body text-[12px] text-slate-400">
              El historial real se activa con Supabase configurado.
            </p>
          )}
        </div>

        {/* Datos de cuenta */}
        <aside className="order-1 flex flex-col gap-4 lg:order-2 lg:sticky lg:top-20">
          <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
            {account.fullName && (
              <>
                <p className="font-body text-xs font-semibold uppercase tracking-wide text-slate-400">Nombre</p>
                <p className="mb-3 font-body font-semibold text-foreground">{account.fullName}</p>
              </>
            )}
            <p className="font-body text-xs font-semibold uppercase tracking-wide text-slate-400">Correo</p>
            <p className="break-all font-body font-semibold text-foreground">{account.email}</p>
            <div className="mt-3">
              <Badge tone="neutral" icon={null}>
                Cuenta Basic (gratis)
              </Badge>
            </div>
            <p className="mt-3 font-body text-[13px] leading-snug text-muted">
              El acceso a Pro/Ultra es por reporte: se desbloquea al comprar la placa que consultas.
            </p>
            <button
              onClick={onLogout}
              className="mt-4 inline-flex items-center gap-1.5 font-body text-sm font-semibold text-accent hover:underline cursor-pointer"
            >
              <Icon name="logout" className="text-[18px]" />
              Cerrar sesión
            </button>
          </div>

          {isAdmin && (
            <div className="rounded-xl border border-azul-200 bg-azul-50 p-5 shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-azul-100 text-primary">
                  <Icon name="admin_panel_settings" className="text-[20px]" />
                </span>
                <p className="font-heading text-sm font-bold text-foreground">Administración</p>
              </div>
              <p className="mb-3 font-body text-[13px] leading-snug text-muted">
                Confirma o rechaza los pagos por Yape/Plin que están a la espera de validación.
              </p>
              <Button variant="primary" size="sm" block href="/admin/pagos" iconRight="arrow_forward">
                Confirmar pagos Yape
              </Button>
            </div>
          )}

          <Link href="/" className="font-body text-sm text-muted hover:text-foreground">
            ← Volver al inicio
          </Link>
        </aside>
      </div>
    </div>
  );
}

/* ── Pantalla principal ───────────────────────────────────────────── */
export default function CuentaPage() {
  const [view, setView] = useState<View>('login');
  const [account, setAccount] = useState<Account | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombres, setNombres] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [celular, setCelular] = useState('');
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getAccount().then(setAccount).catch(() => setAccount(null));
  }, []);

  const go = (v: View) => {
    setView(v);
    setError(null);
    setNotice(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (view === 'forgot') {
      // La recuperación por correo se habilita al migrar a Supabase Auth.
      setNotice(
        'La recuperación por correo se habilitará muy pronto. Por ahora escríbenos a soporte@placape.pe y te ayudamos.',
      );
      return;
    }

    if (view === 'register' && !terms) {
      setError('Debes aceptar los Términos y la Política de privacidad.');
      return;
    }

    setBusy(true);
    try {
      if (view === 'register') {
        const fullName = `${nombres} ${apellidos}`.trim() || undefined;
        const { account: acc, needsConfirmation } = await register(email, password, fullName);
        if (needsConfirmation) {
          setNotice('Te enviamos un correo para confirmar tu cuenta. Ábrelo para activar el acceso.');
          setBusy(false);
          return;
        }
        setAccount(acc ?? (await getAccount()));
      } else {
        await login(email, password);
        setAccount(await getAccount());
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (account) {
    return (
      <AccountView
        account={account}
        onLogout={async () => {
          await logout();
          setAccount(null);
          go('login');
        }}
      />
    );
  }

  return (
    <section
      className="grid place-items-center px-4 py-12 sm:py-16"
      style={{
        background: 'radial-gradient(120% 130% at 80% -10%, #EFF6F9 0%, #EEF2F5 60%)',
      }}
    >
      <div className="grid w-full max-w-[940px] grid-cols-1 overflow-hidden rounded-2xl bg-surface shadow-xl md:min-h-[600px] md:grid-cols-2">
        <BrandPanel />

        <div className="flex flex-col justify-center p-7 sm:p-11">
          {view === 'forgot' ? (
            <>
              <button
                onClick={() => go('login')}
                className="mb-4 inline-flex items-center gap-1.5 font-body text-sm font-semibold text-muted hover:text-foreground cursor-pointer"
              >
                <Icon name="arrow_back" className="text-[18px]" /> Volver
              </button>
              <h1 className="mb-1 font-heading text-[27px] font-extrabold tracking-tight text-foreground">
                Recupera tu acceso
              </h1>
              <p className="mb-6 font-body text-[15px] leading-relaxed text-muted">
                Ingresa tu correo y te enviaremos un enlace para restablecer tu contraseña.
              </p>
            </>
          ) : view === 'login' ? (
            <>
              <h1 className="mb-1 font-heading text-[27px] font-extrabold tracking-tight text-foreground">
                Bienvenido de nuevo
              </h1>
              <p className="mb-6 font-body text-[15px] text-muted">
                Ingresa para ver tus reportes guardados.
              </p>
              <SocialButtons onError={setError} />
              <Divider label="o con tu correo" />
            </>
          ) : (
            <>
              <h1 className="mb-1 font-heading text-[27px] font-extrabold tracking-tight text-foreground">
                Crea tu cuenta
              </h1>
              <p className="mb-6 font-body text-[15px] text-muted">
                Gratis. Tu primer reporte básico no cuesta nada.
              </p>
              <SocialButtons onError={setError} />
              <Divider label="o con tu correo" />
            </>
          )}

          <form onSubmit={submit} className="flex flex-col gap-3.5">
            {view === 'register' && (
              <div className="flex gap-3">
                <Input
                  label="Nombres"
                  icon="person"
                  placeholder="Carlos"
                  autoComplete="given-name"
                  value={nombres}
                  onChange={(e) => setNombres(e.target.value)}
                  className="flex-1"
                />
                <Input
                  label="Apellidos"
                  placeholder="Mendoza"
                  autoComplete="family-name"
                  value={apellidos}
                  onChange={(e) => setApellidos(e.target.value)}
                  className="flex-1"
                />
              </div>
            )}

            <Input
              label="Correo electrónico"
              type="email"
              icon="mail"
              placeholder="tu@correo.com"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            {view === 'register' && (
              <Input
                label="Celular"
                icon="smartphone"
                placeholder="987 654 321"
                autoComplete="tel"
                inputMode="tel"
                hint="Opcional. Te avisamos cuando tu reporte esté listo."
                value={celular}
                onChange={(e) => setCelular(e.target.value)}
              />
            )}

            {view !== 'forgot' && (
              <Input
                label="Contraseña"
                type="password"
                icon="lock"
                placeholder={view === 'register' ? 'Mínimo 8 caracteres' : '••••••••'}
                autoComplete={view === 'register' ? 'new-password' : 'current-password'}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}

            {view === 'login' && (
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 font-body text-[13.5px] text-foreground cursor-pointer">
                  <input type="checkbox" defaultChecked className="h-4 w-4 accent-accent" /> Recordarme
                </label>
                <button
                  type="button"
                  onClick={() => go('forgot')}
                  className="font-body text-[13.5px] font-semibold text-accent hover:underline cursor-pointer"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
            )}

            {view === 'register' && (
              <label className="flex items-start gap-2 font-body text-[13px] leading-snug text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={terms}
                  onChange={(e) => setTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-accent"
                />
                <span>
                  Acepto los{' '}
                  <Link href="/legal/terminos" className="font-semibold text-accent hover:underline">
                    Términos
                  </Link>{' '}
                  y la{' '}
                  <Link href="/legal/privacidad" className="font-semibold text-accent hover:underline">
                    Política de privacidad
                  </Link>
                  .
                </span>
              </label>
            )}

            {error && (
              <p className="font-body text-sm font-medium text-danger-fg" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p
                className="rounded-md border border-azul-200 bg-azul-50 px-3 py-2.5 font-body text-[13px] leading-snug text-azul-700"
                role="status"
              >
                {notice}
              </p>
            )}

            <Button
              type="submit"
              variant="accent"
              size="lg"
              block
              disabled={busy}
              iconRight={view === 'forgot' ? undefined : 'arrow_forward'}
              icon={view === 'forgot' ? 'send' : undefined}
            >
              {busy
                ? 'Procesando…'
                : view === 'login'
                  ? 'Ingresar'
                  : view === 'register'
                    ? 'Crear cuenta gratis'
                    : 'Enviar enlace'}
            </Button>
          </form>

          {view === 'login' && (
            <p className="mt-5 text-center font-body text-sm text-muted">
              ¿No tienes cuenta?{' '}
              <button
                onClick={() => go('register')}
                className="font-bold text-accent hover:underline cursor-pointer"
              >
                Crear cuenta
              </button>
            </p>
          )}
          {view === 'register' && (
            <p className="mt-5 text-center font-body text-sm text-muted">
              ¿Ya tienes cuenta?{' '}
              <button
                onClick={() => go('login')}
                className="font-bold text-accent hover:underline cursor-pointer"
              >
                Ingresar
              </button>
            </p>
          )}

          {!usingSupabase && (
            <p className="mt-6 flex items-center justify-center gap-1.5 text-center font-body text-[12px] text-slate-400">
              <Icon name="info" className="text-[14px]" />
              Cuentas en modo de prueba. Configura Supabase para activarlas.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
