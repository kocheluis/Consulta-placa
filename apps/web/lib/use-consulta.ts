'use client';

import { useEffect, useState } from 'react';
import type { Report } from '@app/shared';

type State =
  | { phase: 'loading'; report: null; error: null; generating: boolean }
  | { phase: 'done'; report: Report | null; error: null; cached: boolean; generating: boolean }
  | { phase: 'error'; report: null; error: string; needsPro: boolean; generating: false };

type DoneState = Extract<State, { phase: 'done' }>;
/**
 * ¿El estado ya muestra un reporte con datos REALES? Un stub vacío (sin secciones ni vehículo,
 * p. ej. antes de la consulta gratis) NO cuenta: en ese caso SÍ queremos el loader de pantalla
 * completa. Solo un reporte con datos se conserva durante los refrescos/upgrade. Type guard →
 * al conservar `prev` TypeScript lo estrecha al estado 'done' con reporte no nulo.
 */
function hasRealReport(s: State): s is DoneState & { report: Report } {
  return s.phase === 'done' && !!s.report && (s.report.sections.length > 0 || !!s.report.vehicle);
}

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
          // Generando y sin reporte devuelto: si YA mostrábamos uno CON DATOS, consérvalo (no
          // blanquees → evita que el loader de pantalla completa reaparezca durante el upgrade PRO).
          // Si solo había un stub vacío (consulta gratis inicial), cae al 'loading' de pantalla
          // completa (el panel con consejos que se ve mientras se genera el reporte BASIC).
          setState((prev) => (hasRealReport(prev)
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

    // Al re-consultar (botón Actualizar o polling de un upgrade PRO/ULTRA) conserva el reporte con
    // DATOS ya visible en vez de blanquear la pantalla: así solo cambia lo que llega nuevo. La
    // primera carga (sin reporte) o un stub vacío (pre-consulta gratis) sí van al 'loading' full.
    setState((prev) => (hasRealReport(prev) ? prev : { phase: 'loading', report: null, error: null, generating: false }));
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [placa, refreshToken, enabled, preview]);

  return state;
}
