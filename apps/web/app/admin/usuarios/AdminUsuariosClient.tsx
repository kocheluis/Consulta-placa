'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import type { CupoUser } from '@/lib/admin-cupo';

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block text-[11px] font-mono uppercase tracking-wide text-muted">
      {label}
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="mt-1 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm tabular-nums text-foreground outline-none focus:border-accent"
      />
    </label>
  );
}

function UserRow({ u }: { u: CupoUser }) {
  const [d, setD] = useState<CupoUser>(u);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (patch: Partial<CupoUser>) => {
    setD((x) => ({ ...x, ...patch }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch('/api/admin/cupo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: d.id, enabled: d.enabled, tier: d.tier, quotaHour: d.quotaHour, quotaDay: d.quotaDay, quotaWeek: d.quotaWeek }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) {
        setErr(j.error ?? 'No se pudo guardar.');
        return;
      }
      setSaved(true);
    } catch {
      setErr('Error de red.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`rounded-xl border bg-surface p-4 shadow-sm ${d.enabled ? 'border-teal-700/40' : 'border-border'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-body text-[15px] font-semibold text-foreground">{d.email ?? '(sin correo)'}</div>
          {d.fullName && <div className="truncate text-[13px] text-muted">{d.fullName}</div>}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-foreground">
          <input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="h-4 w-4 accent-primary" />
          Cupo activo
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block text-[11px] font-mono uppercase tracking-wide text-muted">
          Nivel
          <select
            value={d.tier}
            onChange={(e) => set({ tier: e.target.value === 'ULTRA' ? 'ULTRA' : 'PRO' })}
            className="mt-1 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          >
            <option value="PRO">PRO</option>
            <option value="ULTRA">ULTRA</option>
          </select>
        </label>
        <NumField label="Por hora" value={d.quotaHour} onChange={(v) => set({ quotaHour: v })} />
        <NumField label="Por día" value={d.quotaDay} onChange={(v) => set({ quotaDay: v })} />
        <NumField label="Por semana" value={d.quotaWeek} onChange={(v) => set({ quotaWeek: v })} />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" variant="primary" onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm text-teal-700"><Icon name="check_circle" className="text-[16px]" /> Guardado</span>
        )}
        {err && <span className="text-sm text-danger">{err}</span>}
      </div>
    </div>
  );
}

export function AdminUsuariosClient({ initial, migrated }: { initial: CupoUser[]; migrated: boolean }) {
  const [users, setUsers] = useState<CupoUser[]>(initial);
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [loading, setLoading] = useState(false);

  const search = useCallback(async () => {
    setLoading(true);
    setTerm(q.trim());
    try {
      const r = await fetch('/api/admin/cupo?q=' + encodeURIComponent(q.trim()), { cache: 'no-store' });
      const j = (await r.json().catch(() => ({}))) as { users?: CupoUser[] };
      setUsers(j.users ?? []);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [q]);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-extrabold text-foreground">Cupos de consulta</h1>
          <p className="mt-1 text-sm text-muted">Asigna a una cuenta un nivel (PRO/ULTRA) y su tope de consultas por hora, día y semana.</p>
        </div>
        <Link href="/admin/pagos" className="whitespace-nowrap text-sm font-semibold text-primary hover:underline">Pagos →</Link>
      </div>

      {!migrated && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-bg px-4 py-3 text-sm text-warning-fg">
          <Icon name="warning" className="mt-px text-[18px]" />
          <span>Falta correr la migración <b>0009_cupo_consultas.sql</b> en Supabase. Hasta entonces no se puede asignar cupo.</span>
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Buscar cuenta por correo…"
          className="min-w-[240px] flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground outline-none focus:border-accent"
        />
        <Button variant="secondary" icon="search" onClick={search} disabled={loading}>{loading ? 'Buscando…' : 'Buscar'}</Button>
      </div>

      <p className="mb-3 text-[13px] text-muted">
        {term ? `Resultados para "${term}"` : 'Cuentas con cupo activo'} · {users.length}
      </p>

      <div className="flex flex-col gap-3">
        {users.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
            {term ? 'Sin resultados. Prueba con otro correo.' : 'Aún no hay cuentas con cupo. Busca un correo para asignarle uno.'}
          </div>
        )}
        {users.map((u) => (
          <UserRow key={u.id} u={u} />
        ))}
      </div>
    </div>
  );
}
