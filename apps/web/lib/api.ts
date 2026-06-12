import type { ConsultaResponse } from '@app/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface ApiError {
  error: string;
  message: string;
  retryAfter?: number | null;
}

export async function crearConsulta(
  placa: string,
  forceRefresh = false,
): Promise<ConsultaResponse> {
  const res = await fetch(`${API_URL}/api/v1/consultas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ placa, forceRefresh }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as ApiError;
    throw new Error(err.message ?? `Error ${res.status}`);
  }
  return (await res.json()) as ConsultaResponse;
}

export async function obtenerJob(jobId: string): Promise<ConsultaResponse> {
  const res = await fetch(`${API_URL}/api/v1/consultas/${jobId}`);
  if (!res.ok) throw new Error('No se pudo obtener el estado de la consulta');
  return (await res.json()) as ConsultaResponse;
}
