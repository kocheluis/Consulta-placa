'use client';

import { useEffect, useState } from 'react';
import type { ConsultaResponse } from '@app/shared';
import { crearConsulta, obtenerJob } from './api';

type State =
  | { phase: 'loading'; report: null; error: null }
  | { phase: 'done'; report: ConsultaResponse['report']; error: null; cached: boolean }
  | { phase: 'error'; report: null; error: string };

/** Crea la consulta y hace polling del job hasta COMPLETED/PARTIAL/FAILED. */
export function useConsulta(placa: string, forceRefresh = false): State {
  const [state, setState] = useState<State>({ phase: 'loading', report: null, error: null });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async (jobId: string) => {
      try {
        const res = await obtenerJob(jobId);
        if (cancelled) return;
        if (res.status === 'COMPLETED' || res.status === 'PARTIAL') {
          setState({ phase: 'done', report: res.report, error: null, cached: res.cached });
        } else if (res.status === 'FAILED') {
          setState({ phase: 'error', report: null, error: 'La consulta falló. Intenta de nuevo.' });
        } else {
          timer = setTimeout(() => poll(jobId), 1500);
        }
      } catch (e) {
        if (!cancelled) setState({ phase: 'error', report: null, error: (e as Error).message });
      }
    };

    (async () => {
      try {
        const res = await crearConsulta(placa, forceRefresh);
        if (cancelled) return;
        if (res.report && (res.status === 'COMPLETED' || res.status === 'PARTIAL')) {
          setState({ phase: 'done', report: res.report, error: null, cached: res.cached });
        } else if (res.jobId) {
          poll(res.jobId);
        }
      } catch (e) {
        if (!cancelled) setState({ phase: 'error', report: null, error: (e as Error).message });
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [placa, forceRefresh]);

  return state;
}
