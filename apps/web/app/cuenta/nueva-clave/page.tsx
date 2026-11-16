'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StateScreen } from '@/components/StateScreen';
import { createClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';

/**
 * Crear nueva contraseña. Se llega desde el correo de recuperación: /auth/confirm verifica el token
 * (type=recovery) y deja la sesión iniciada; aquí solo se fija la contraseña nueva.
 */
export default function NuevaClavePage() {
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) { setHasSession(false); return; }
    createClient().auth.getUser().then(({ data }) => setHasSession(Boolean(data.user))).catch(() => setHasSession(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return; }
    if (password !== repeat) { setError('Las contraseñas no coinciden.'); return; }
    setBusy(true);
    try {
      const { error: err } = await createClient().auth.updateUser({ password });
      if (err) setError('No pudimos guardar la contraseña. Pide un nuevo enlace e inténtalo otra vez.');
      else setDone(true);
    } finally {
      setBusy(false);
    }
  };

  if (hasSession === false) {
    return (
      <section className="bg-background px-4 py-16 sm:py-24">
        <StateScreen tone="danger" icon="error" title="El enlace expiró o ya fue usado"
          description="Los enlaces para cambiar la contraseña vencen en 1 hora y sirven una sola vez. Pide uno nuevo desde «¿Olvidaste tu contraseña?».">
          <div className="flex justify-center"><Button variant="accent" size="lg" href="/cuenta" iconRight="arrow_forward">Ir a iniciar sesión</Button></div>
        </StateScreen>
      </section>
    );
  }

  if (done) {
    return (
      <section className="bg-background px-4 py-16 sm:py-24">
        <StateScreen tone="success" icon="verified" title="Contraseña actualizada"
          description="Ya puedes usar tu nueva contraseña. Tu sesión sigue iniciada en este dispositivo.">
          <div className="flex flex-wrap justify-center gap-3">
            <Button variant="accent" size="lg" href="/" iconRight="arrow_forward">Consultar una placa</Button>
            <Button variant="secondary" size="lg" href="/cuenta" icon="person">Ir a mi cuenta</Button>
          </div>
        </StateScreen>
      </section>
    );
  }

  return (
    <section className="bg-background px-4 py-12 sm:py-16">
      <div className="mx-auto w-full max-w-[440px] rounded-2xl border border-border bg-surface px-6 py-7 shadow-sm sm:px-8">
        <h1 className="font-display text-xl font-bold text-foreground">Crea tu nueva contraseña</h1>
        <p className="mt-1.5 font-body text-sm text-muted">Usa al menos 8 caracteres.</p>
        <form onSubmit={submit} className="mt-5 flex flex-col gap-3.5">
          <Input label="Nueva contraseña" type="password" icon="lock" autoComplete="new-password" required minLength={8}
            value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input label="Repite la contraseña" type="password" icon="lock" autoComplete="new-password" required minLength={8}
            value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          {error && <p className="font-body text-sm font-medium text-danger-fg" role="alert">{error}</p>}
          <Button type="submit" variant="accent" size="lg" block disabled={busy || hasSession === null}>
            {busy ? 'Guardando…' : 'Guardar contraseña'}
          </Button>
        </form>
      </div>
    </section>
  );
}
