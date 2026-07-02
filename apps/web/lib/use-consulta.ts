'use client';

import { useEffect, useState } from 'react';
import type { Report } from '@app/shared';

type State =
  | { phase: 'loading'; report: null; error: null; generating: boolean }
  | { phase: 'done'; report: Report | null; error: null; cached: boolean; generating: boolean }
  | { phase: 'error'; report: null; error: string; needsPro: boolean; generating: false };

/**
 * Lee el reporte de la placa desde `/api/reporte/[placa]` (Supabase vía route handler,
 * recortado por el nivel pagado). Hace polling cada 3 s mientras el motor del VPS lo
 * genera. `refreshToken` re-dispara la lectura (botón Actualizar).
 */
export function useConsulta(placa: string, refreshToken = 0, enabled = true, preview?: string): State {
  const [state, setState] = useState<State>({ phase: 'loading', report: null, error: null, generating: false });

  useEffect(() => {
    if (!enabled || !placa) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const qs = preview ? `?preview=${encodeURIComponent(preview)}` : '';

    const load = async () => {
      try {
        const r = await fetch(`/api/reporte/${encodeURIComponent(placa)}${qs}`, { cache: 'no-store' });
        if (cancelled) return;
        const d = (await r.json()) as { generating?: boolean; report?: Report | null };
        if (cancelled) return;
        const generating = !!d.generating;
        if (d.report) {
          setState({ phase: 'done', report: d.report, error: null, cached: false, generating });
          // Sigue puliendo aunque ya haya reporte: puede estar regenerándose con más fuentes
          // (upgrade PRO/ULTRA) → así detectamos cuándo termina y revelamos el reporte completo.
          if (generating) timer = setTimeout(load, 3000);
        } else if (generating) {
          // Generando y sin reporte devuelto: si YA mostrábamos uno, consérvalo (no blanquees la
          // pantalla → evita que el loader de pantalla completa reaparezca durante el upgrade).
          // Solo la primera carga (sin reporte previo) cae al 'loading' de pantalla completa.
          setState((prev) => (prev.phase === 'done' && prev.report
            ? { ...prev, generating: true }
            : { phase: 'loading', report: null, error: null, generating: true }));
          timer = setTimeout(load, 3000);
        } else {
          setState({ phase: 'error', report: null, error: 'Aún no has generado este reporte.', needsPro: true, generating: false });
        }
      } catch (e) {
        if (!cancelled) setState({ phase: 'error', report: null, error: (e as Error).message, needsPro: false, generating: false });
      }
    };

    // Al re-consultar (botón Actualizar o polling de un upgrade PRO/ULTRA) conserva el reporte
    // ya visible en vez de blanquear la pantalla: así solo cambia lo que llega nuevo. Solo la
    // primera carga (sin reporte aún) muestra el estado 'loading' de pantalla completa.
    setState((prev) => (prev.phase === 'done' && prev.report ? prev : { phase: 'loading', report: null, error: null, generating: false }));
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [placa, refreshToken, enabled, preview]);

  return state;
}
