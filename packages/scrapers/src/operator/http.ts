/**
 * `fetch` con TIEMPO LÍMITE y reintentos acotados para servicios externos (Supabase/PostgREST, web,
 * n8n). Sin límite, una conexión colgada frenaba el dispatcher del motor varios minutos.
 *
 * - Timeout por intento (default 15 s) con AbortSignal.timeout; respeta además un `signal` del llamador.
 * - Reintenta SOLO si es seguro: métodos idempotentes (GET/HEAD/PUT/DELETE/PATCH, y POST marcado
 *   `idempotent: true`, p. ej. un upsert) ante error de red, timeout, 429 o 5xx. Backoff con jitter.
 * - Nunca reintenta 4xx (error del pedido: repetirlo no lo arregla).
 */
export interface SafeFetchOpts {
  timeoutMs?: number;
  retries?: number;
  idempotent?: boolean;
}

const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'PATCH']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function safeFetch(url: string, init: RequestInit = {}, opts: SafeFetchOpts = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const canRetry = opts.idempotent ?? IDEMPOTENT.has(method);
  const retries = canRetry ? (opts.retries ?? 2) : 0;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      const res = await fetch(url, { ...init, signal });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await res.body?.cancel().catch(() => {});
        await sleep(backoff(attempt));
        continue;
      }
      return res;
    } catch (e) {
      if (init.signal?.aborted) throw e; // lo canceló el llamador → no insistir
      lastErr = e;
      if (attempt < retries) { await sleep(backoff(attempt)); continue; }
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`${method} ${new URL(url).host} sin respuesta tras ${retries + 1} intento(s): ${msg}`);
}

const backoff = (attempt: number) => Math.round(400 * 2 ** attempt + Math.random() * 250);
