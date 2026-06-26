'use client';

import { useEffect, useState } from 'react';
import type { Report } from '@app/shared';

type State =
  | { phase: 'loading'; report: null; error: null }
  | { phase: 'done'; report: Report | null; error: null; cached: boolean }
  | { phase: 'error'; report: null; error: string; needsPro: boolean };

/**
 * Lee el reporte de la placa desde `/api/reporte/[placa]` (Supabase vía route handler,
 * recortado por el nivel pagado). Hace polling cada 3 s mientras el motor del VPS lo
 * genera. `refreshToken` re-dispara la lectura (botón Actualizar).
 */
export function useConsulta(placa: string, refreshToken = 0, enabled = true): State {
  const [state, setState] = useState<State>({ phase: 'loading', report: null, error: null });

  useEffect(() => {
    if (!enabled || !placa) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const load = async () => {
      try {
        const r = await fetch(`/api/reporte/${encodeURIComponent(placa)}`, { cache: 'no-store' });
        if (cancelled) return;
        const d = (await r.json()) as { generating?: boolean; report?: Report | null };
        if (cancelled) return;
        if (d.report) {
          setState({ phase: 'done', report: d.report, error: null, cached: false });
        } else if (d.generating) {
          setState({ phase: 'loading', report: null, error: null });
          timer = setTimeout(load, 3000);
        } else {
          setState({ phase: 'error', report: null, error: 'Aún no has generado este reporte.', needsPro: true });
        }
      } catch (e) {
        if (!cancelled) setState({ phase: 'error', report: null, error: (e as Error).message, needsPro: false });
      }
    };

    setState({ phase: 'loading', report: null, error: null });
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [placa, refreshToken, enabled]);

  return state;
}
