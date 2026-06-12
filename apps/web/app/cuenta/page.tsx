'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { login, register, fetchMe, clearToken, type Account } from '@/lib/auth';

export default function CuentaPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchMe().then(setAccount);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        await register(email, password);
        await login(email, password);
      } else {
        await login(email, password);
      }
      setAccount(await fetchMe());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (account) {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-2xl font-semibold text-foreground">Mi cuenta</h1>
        <div className="mt-4 rounded-xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">Correo</p>
          <p className="font-medium text-foreground">{account.email}</p>
          <div className="mt-3 flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                account.isPro && account.isActive
                  ? 'bg-success-bg text-success-fg'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {account.isPro && account.isActive ? 'PRO activa' : 'Cuenta gratuita'}
            </span>
          </div>
          {!(account.isPro && account.isActive) && (
            <p className="mt-3 text-sm text-muted">
              Tu cuenta aún no tiene PRO activo. La activación PRO se habilita tras la suscripción
              (próximamente). Mientras tanto usa la consulta guiada gratuita.
            </p>
          )}
          <button
            onClick={() => {
              clearToken();
              setAccount(null);
            }}
            className="mt-4 text-sm text-accent hover:underline cursor-pointer"
          >
            Cerrar sesión
          </button>
        </div>
        <Link href="/" className="mt-4 inline-block text-sm text-accent hover:underline">
          ← Volver al inicio
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold text-foreground">
        {mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
      </h1>
      <p className="mt-1 text-sm text-muted">
        Necesaria para el reporte automático PRO. La consulta guiada es gratis y no requiere cuenta.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1">
            Correo
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1">
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          />
        </div>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-primary-600 cursor-pointer disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        >
          {busy ? 'Procesando…' : mode === 'login' ? 'Entrar' : 'Registrarme'}
        </button>
      </form>

      <button
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setError(null);
        }}
        className="mt-4 text-sm text-accent hover:underline cursor-pointer"
      >
        {mode === 'login' ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
      </button>
    </div>
  );
}
