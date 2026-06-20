'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PendingPurchase } from '@/lib/payments';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

const fmtDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString('es-PE', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

const money = (amount: number, currency: string): string =>
  currency === 'PEN' ? `S/ ${amount.toFixed(2)}` : `${currency} ${amount.toFixed(2)}`;

const ref8 = (orderId: string): string => orderId.slice(0, 8).toUpperCase();

export function AdminPagosClient({ initial }: { initial: PendingPurchase[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<PendingPurchase[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Re-sincroniza cuando el server component refresca (botón Actualizar).
  useEffect(() => {
    setRows(initial);
  }, [initial]);

  const act = async (p: PendingPurchase, action: 'confirm' | 'reject') => {
    const verb = action === 'confirm' ? 'CONFIRMAR' : 'RECHAZAR';
    const msg =
      action === 'confirm'
        ? `¿Confirmar el pago de ${money(p.amount, p.currency)} de ${p.email}?\nSe desbloqueará el reporte ${p.tier} de ${p.plate} y se le enviará el recibo por correo.`
        : `¿Rechazar el pedido ${ref8(p.orderId)} de ${p.email}?`;
    if (!window.confirm(`${verb}\n\n${msg}`)) return;

    setBusy(p.orderId);
    setError(null);
    setDone(null);
    try {
      const res = await fetch('/api/admin/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: p.orderId, action }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'No se pudo procesar. Intenta de nuevo.');
        return;
      }
      setRows((rs) => rs.filter((r) => r.orderId !== p.orderId));
      setDone(
        action === 'confirm'
          ? `Pago confirmado: ${p.plate} (${p.tier}) de ${p.email}.`
          : `Pedido rechazado: ${ref8(p.orderId)}.`,
      );
    } catch {
      setError('No pudimos conectar. Revisa tu conexión e intenta de nuevo.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-[26px] font-extrabold tracking-tight text-foreground">Pagos pendientes</h1>
          <p className="font-body text-sm text-muted">
            Confirma los pagos por Yape para desbloquear el reporte y enviar el recibo.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Badge tone={rows.length > 0 ? 'warning' : 'neutral'} icon="schedule">
            {rows.length} pendiente{rows.length === 1 ? '' : 's'}
          </Badge>
          <Button variant="secondary" size="sm" icon="refresh" onClick={() => router.refresh()}>
            Actualizar
          </Button>
        </div>
      </div>

      {done && (
        <p
          role="status"
          className="mb-4 flex items-center gap-2 rounded-md border border-success/30 bg-success-bg px-3.5 py-2.5 font-body text-sm font-medium text-success-fg"
        >
          <Icon name="check_circle" fill className="text-[18px]" />
          {done}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-md border border-danger/40 bg-danger-bg px-3.5 py-2.5 font-body text-sm font-medium text-danger-fg"
        >
          <Icon name="error" className="text-[18px]" />
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface px-6 py-14 text-center shadow-sm">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-success-bg">
            <Icon name="task_alt" className="text-[26px] text-success" />
          </div>
          <p className="font-body font-semibold text-foreground">No hay pagos pendientes</p>
          <p className="mx-auto mt-1 max-w-xs font-body text-sm text-muted">
            Cuando alguien inicie una compra por Yape, aparecerá aquí para confirmarla.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          {rows.map((p) => (
            <div
              key={p.orderId}
              className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border px-4 py-4 first:border-t-0 sm:px-5"
            >
              {/* Comprador + fecha */}
              <div className="min-w-[200px] flex-1">
                <p className="truncate font-body text-[15px] font-semibold text-foreground">{p.email || '—'}</p>
                <p className="mt-0.5 font-body text-[12.5px] text-muted">{fmtDate(p.createdAt)}</p>
              </div>

              {/* Placa + plan */}
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold tracking-wide text-foreground">{p.plate}</span>
                <Badge tone={p.tier === 'ULTRA' ? 'brand' : 'info'} size="sm" icon={p.tier === 'ULTRA' ? 'bolt' : null}>
                  {p.tier === 'ULTRA' ? 'Ultra' : 'Pro'}
                </Badge>
              </div>

              {/* Monto */}
              <div className="text-right">
                <p className="font-heading text-lg font-extrabold text-foreground">{money(p.amount, p.currency)}</p>
              </div>

              {/* Referencia (lo que el cliente escribe en el Yape) */}
              <div
                className="rounded-lg bg-azul-50 px-2.5 py-1.5 text-center"
                title={`Referencia completa: ${p.orderId}`}
              >
                <p className="font-body text-[10px] font-semibold uppercase tracking-wide text-azul-700">Ref.</p>
                <p className="font-mono text-sm font-bold tracking-wider text-primary">{ref8(p.orderId)}</p>
              </div>

              {/* Acciones */}
              <div className="flex items-center gap-2">
                <Button
                  variant="accent"
                  size="sm"
                  icon="check"
                  disabled={busy !== null}
                  onClick={() => act(p, 'confirm')}
                >
                  {busy === p.orderId ? 'Procesando…' : 'Confirmar'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="close"
                  disabled={busy !== null}
                  onClick={() => act(p, 'reject')}
                >
                  Rechazar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-5 flex items-start gap-1.5 font-body text-[12.5px] leading-snug text-slate-400">
        <Icon name="info" className="mt-0.5 flex-none text-[14px]" />
        <span>
          Verifica en tu app de Yape que recibiste el monto con la referencia indicada antes de confirmar. Al confirmar,
          el cliente recibe el correo de “pago confirmado” y su reporte queda desbloqueado.
        </span>
      </p>
    </div>
  );
}
