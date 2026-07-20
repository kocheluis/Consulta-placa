'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isValidPlate, normalizePlate } from '@app/shared';
import { PlateInput } from '@/components/ui/PlateInput';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

interface Estado {
  authed: boolean;
  enabled: boolean;
  tier?: 'PRO' | 'ULTRA';
  limits?: { hour: number; day: number; week: number };
  used?: { hour: number; day: number; week: number };
  remaining?: { hour: number; day: number; week: number };
}

function CupoChip({ label, left, total }: { label: string; left: number; total: number }) {
  const pct = total > 0 ? Math.round(((total - left) / total) * 100) : 0;
  const tone = left === 0 ? 'text-danger' : left <= Math.max(1, Math.ceil(total * 0.2)) ? 'text-warning-fg' : 'text-teal-700';
  return (
    <div className="flex-1 rounded-xl border border-border bg-surface p-4 text-center shadow-sm">
      <div className="font-mono text-[11px] uppercase tracking-widest text-muted">{label}</div>
      <div className={`mt-1 font-heading text-3xl font-extrabold tabular-nums ${tone}`}>{left}</div>
      <div className="text-[12px] text-muted">de {total} restantes</div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function ConsultasPage() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [placa, setPlaca] = useState('');
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadEstado = useCallback(async () => {
    try {
      const r = await fetch('/api/cupo/estado', { cache: 'no-store' });
      setEstado((await r.json()) as Estado);
    } catch {
      setEstado({ authed: false, enabled: false });
    }
  }, []);
  useEffect(() => {
    void loadEstado();
  }, [loadEstado]);

  const consultar = async () => {
    const norm = normalizePlate(placa);
    if (!isValidPlate(norm)) {
      setMsg({ kind: 'err', text: 'Ingresa una placa peruana válida (ej. ABC-123).' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/cupo/consultar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placa: norm }),
      });
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; status?: string };
      await loadEstado();
      if (!r.ok || !d.ok) {
        setMsg({ kind: 'err', text: d.error ?? 'No se pudo consultar.' });
        return;
      }
      // Consumió cupo y la cuenta tiene su nivel asignado → abre el reporte.
      router.push(`/reporte/${norm}`);
    } catch {
      setMsg({ kind: 'err', text: 'Error de red. Intenta de nuevo.' });
    } finally {
      setBusy(false);
    }
  };

  // ── Estados de carga / sin cupo ────────────────────────────────────
  if (estado === null) {
    return <div className="mx-auto max-w-[720px] px-6 py-16 text-center text-muted">Cargando…</div>;
  }
  if (!estado.authed) {
    return (
      <div className="mx-auto max-w-[560px] px-6 py-16 text-center">
        <h1 className="font-heading text-2xl font-bold text-foreground">Consultas por cupo</h1>
        <p className="mt-3 text-muted">Inicia sesión con tu cuenta para usar tu cupo de consultas.</p>
        <div className="mt-6"><Button href="/cuenta" variant="primary" iconRight="login">Iniciar sesión</Button></div>
      </div>
    );
  }
  if (!estado.enabled) {
    return (
      <div className="mx-auto max-w-[560px] px-6 py-16 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-azul-50">
          <Icon name="hourglass_empty" className="text-2xl text-primary" />
        </div>
        <h1 className="font-heading text-2xl font-bold text-foreground">Aún no tienes un cupo asignado</h1>
        <p className="mt-3 text-muted">
          Tu cuenta está creada, pero todavía no tiene consultas asignadas. Escríbenos para activarte un cupo.
        </p>
        <div className="mt-6"><Button href="/cuenta" variant="secondary">Volver a mi cuenta</Button></div>
      </div>
    );
  }

  // ── Panel de consultas ─────────────────────────────────────────────
  const rem = estado.remaining ?? { hour: 0, day: 0, week: 0 };
  const lim = estado.limits ?? { hour: 0, day: 0, week: 0 };
  const sinCupo = rem.hour === 0 || rem.day === 0 || rem.week === 0;

  return (
    <div className="mx-auto max-w-[820px] px-6 py-12 sm:px-8">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-md bg-azul-50 px-2 py-0.5 font-mono text-[11.5px] font-bold tracking-wide text-primary">MI CUPO</span>
        <span className="rounded-md border border-border px-2 py-0.5 font-mono text-[11px] text-muted">nivel {estado.tier}</span>
      </div>
      <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground sm:text-[34px]">Consulta de placas</h1>
      <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-muted">
        Cada consulta genera un reporte <b>{estado.tier}</b> y descuenta 1 de tu cupo. Volver a ver un
        reporte ya generado no consume cupo.
      </p>

      {/* Cupos */}
      <div className="mt-7 flex flex-wrap gap-3">
        <CupoChip label="Esta hora" left={rem.hour} total={lim.hour} />
        <CupoChip label="Hoy" left={rem.day} total={lim.day} />
        <CupoChip label="Esta semana" left={rem.week} total={lim.week} />
      </div>

      {/* Buscador */}
      <div className="mt-8 rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <label className="mb-3 block font-body text-sm font-semibold text-foreground">Consultar una placa</label>
        <div className="flex flex-wrap items-stretch gap-3">
          <PlateInput value={placa} onChange={setPlaca} onEnter={consultar} size="lg" />
          <Button variant="accent" size="lg" iconRight="arrow_forward" onClick={consultar} disabled={busy || sinCupo}>
            {busy ? 'Consultando…' : 'Consultar'}
          </Button>
        </div>
        {sinCupo && (
          <p className="mt-3 flex items-center gap-1.5 text-sm text-warning-fg">
            <Icon name="hourglass_empty" className="text-[16px]" /> Sin cupo disponible en alguna ventana. Espera a que se libere.
          </p>
        )}
        {msg && (
          <p className={`mt-3 flex items-start gap-1.5 text-sm ${msg.kind === 'err' ? 'text-danger' : 'text-teal-700'}`} role="alert">
            <Icon name={msg.kind === 'err' ? 'error' : 'check_circle'} className="mt-px text-[16px]" />
            <span>{msg.text}</span>
          </p>
        )}
      </div>

      <p className="mt-6 text-[12.5px] leading-relaxed text-muted">
        El pago por reporte sigue disponible como siempre. Tu cupo lo asigna el administrador y se ajusta
        por cuenta.
      </p>
    </div>
  );
}
