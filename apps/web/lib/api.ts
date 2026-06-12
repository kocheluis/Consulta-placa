import type { ConsultaResponse } from '@app/shared';
import { getToken } from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** ¿El error es por falta de sesión o de cuenta PRO? */
  get needsPro(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function crearConsulta(placa: string, forceRefresh = false): Promise<ConsultaResponse> {
  const res = await fetch(`${API_URL}/api/v1/consultas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ placa, forceRefresh }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, err.error ?? 'ERROR', err.message ?? `Error ${res.status}`);
  }
  return (await res.json()) as ConsultaResponse;
}

export async function obtenerJob(jobId: string): Promise<ConsultaResponse> {
  const res = await fetch(`${API_URL}/api/v1/consultas/${jobId}`, { headers: authHeaders() });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, err.error ?? 'ERROR', err.message ?? 'No se pudo obtener el estado');
  }
  return (await res.json()) as ConsultaResponse;
}
