/* eslint-disable no-console */
// Relay RESIDENCIAL de FISE — el VPS NO alcanza fise.minem.gob.pe:23308 (doble bloqueo, probado
// con Chrome real el 31-jul-2026: el MINEM filtra IPs datacenter — SYN descartado — y iProyal
// rechaza el CONNECT a puertos no estándar tanto por HTTP como por SOCKS5). La única salida
// validada es una IP residencial peruana (PC/celular del operador: formulario carga y el
// endpoint responde en <0.1s).
//
// Arquitectura (a prueba de CGNAT — el celular NO acepta conexiones entrantes):
//   Motor (VPS)                                Celular (Termux · tools/fise-relay-celular.mjs)
//   ───────────                                ───────────────────────────────────────────────
//   placa GNV → resuelve reCAPTCHA v3          hace POLLING: GET /api/fise-relay/next?token=…
//   (CapSolver, el secreto NO viaja) →         ← recibe {id, plate, captchaToken}
//   encola job y espera (~45s tope)            GET inicio (cookies+consultaId) + POST buscarSaldo
//   ← recibe el JSON crudo y lo parsea         POST /api/fise-relay/result {id, bodyText}
//
// El celular es un relay TONTO: sin secretos (solo el token del relay), sin lógica de negocio.
// Si no late (>2 min sin poll), la fuente falla AL INSTANTE en vez de quemar los ~200s de la
// cadena de egresos muerta. Endpoints deshabilitados si no hay FISE_RELAY_TOKEN en el env.
import { timingSafeEqual } from 'node:crypto';
import type { CaptchaSolver } from '../captcha/index.js';
import { parseFiseSaldo, FISE_SITEKEY, FISE_PAGE_URL, type OperatorSourceResult } from './sources.js';

export interface RelayOutcome {
  ok: boolean;
  httpStatus?: number;
  /** Respuesta cruda de buscarSaldo (JSON texto) — el parseo vive en el VPS. */
  bodyText?: string;
  error?: string;
}

interface RelayJob {
  id: string;
  plate: string;
  captchaToken: string;
  createdAt: number;
  resolve: (r: RelayOutcome) => void;
}

const pending: RelayJob[] = []; // aún no entregados al celular
const inFlight = new Map<string, RelayJob>(); // entregados, esperando resultado
let lastSeen = 0; // último poll del celular (heartbeat)
let served = 0;
let done = 0;
let seq = 0;

function tokenOk(t: unknown): boolean {
  const want = process.env.FISE_RELAY_TOKEN ?? '';
  if (!want) return false; // sin token configurado → relay deshabilitado (no hay endpoint abierto)
  const got = String(t ?? '');
  if (got.length !== want.length) return false;
  try { return timingSafeEqual(Buffer.from(got), Buffer.from(want)); } catch { return false; }
}

/** ¿El celular dio señales de vida hace poco? (default 2 min; knob FISE_RELAY_ALIVE_MS). */
export function fiseRelayAlive(): boolean {
  const maxAge = Math.max(15_000, Number(process.env.FISE_RELAY_ALIVE_MS ?? 120_000));
  return Date.now() - lastSeen < maxAge;
}

export function fiseRelayStatus(): Record<string, unknown> {
  return {
    enabled: !!process.env.FISE_RELAY_TOKEN,
    alive: fiseRelayAlive(),
    lastSeenAgoS: lastSeen ? Math.round((Date.now() - lastSeen) / 1000) : null,
    pending: pending.length, inFlight: inFlight.size, served, done,
  };
}

/** GET /api/fise-relay/next — el celular pide trabajo (y de paso late el heartbeat). */
export function relayNext(token: unknown): { code: number; body: unknown } {
  if (!tokenOk(token)) return { code: 403, body: { error: 'token inválido o relay deshabilitado' } };
  lastSeen = Date.now();
  const job = pending.shift();
  if (!job) return { code: 200, body: { job: null } };
  inFlight.set(job.id, job);
  served++;
  return { code: 200, body: { job: { id: job.id, plate: job.plate, captchaToken: job.captchaToken } } };
}

/** POST /api/fise-relay/result — el celular devuelve el resultado de un job. */
export function relayResult(token: unknown, body: Record<string, unknown>): { code: number; body: unknown } {
  if (!tokenOk(token)) return { code: 403, body: { error: 'token inválido o relay deshabilitado' } };
  lastSeen = Date.now();
  const job = inFlight.get(String(body.id ?? ''));
  if (!job) return { code: 200, body: { ok: false, error: 'job desconocido (¿expiró el tope y ya se resolvió como timeout?)' } };
  inFlight.delete(job.id);
  done++;
  job.resolve({
    ok: body.ok === true,
    httpStatus: Number(body.httpStatus ?? 0) || undefined,
    bodyText: typeof body.bodyText === 'string' ? body.bodyText : undefined,
    error: typeof body.error === 'string' ? body.error : undefined,
  });
  return { code: 200, body: { ok: true } };
}

/** Encola una consulta y espera el resultado del celular (o expira sin colgar el reporte). */
export function relayEnqueue(plate: string, captchaToken: string, timeoutMs: number): Promise<RelayOutcome> {
  return new Promise((resolve) => {
    const id = `f${Date.now().toString(36)}-${(seq++).toString(36)}`;
    let settled = false;
    const finish = (r: RelayOutcome): void => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
    const job: RelayJob = { id, plate, captchaToken, createdAt: Date.now(), resolve: finish };
    const timer = setTimeout(() => {
      const idx = pending.indexOf(job);
      if (idx >= 0) pending.splice(idx, 1);
      inFlight.delete(id);
      finish({ ok: false, error: `relay sin respuesta en ${Math.round(timeoutMs / 1000)}s (¿celular dormido / sin red?)` });
    }, timeoutMs);
    pending.push(job);
  });
}

/** Runner de la fuente FISE vía relay: el VPS resuelve el v3 (CapSolver) y el celular ejecuta. */
export async function runFiseViaRelay(
  plate: string,
  solver: CaptchaSolver,
  log: (m: string) => void,
): Promise<OperatorSourceResult> {
  const t0 = Date.now();
  const base = { source: 'FISE_GNV', label: 'FISE · Deuda de conversión GNV', category: 'GNV' };
  const timeoutMs = Math.max(20_000, Number(process.env.FISE_RELAY_TIMEOUT_MS ?? 45_000));
  for (let i = 1; i <= 2; i++) {
    let token = '';
    try { token = await solver.solveRecaptchaV3(FISE_SITEKEY, FISE_PAGE_URL, 'consulta'); }
    catch (e) { log(`intento ${i}/2: captcha falló (${(e as Error).message})`); continue; }
    log(`intento ${i}/2: token v3 listo → encolado al relay del celular (tope ${Math.round(timeoutMs / 1000)}s)`);
    const out = await relayEnqueue(plate, token, timeoutMs);
    if (!out.ok) {
      log(`intento ${i}/2: ${out.error ?? 'el celular reportó fallo'}`);
      if (!fiseRelayAlive()) break; // el celular se cayó a mitad de camino: no insistir
      continue;
    }
    let j: { status?: number; rows?: Array<Record<string, unknown>> } | null = null;
    try { j = JSON.parse(out.bodyText ?? ''); } catch { /* HTML / no-JSON (token rechazado) */ }
    if (!j || j.status !== 0 || !Array.isArray(j.rows)) {
      log(`intento ${i}/2: respuesta no válida (http ${out.httpStatus ?? '?'}, status=${j?.status ?? '?'}) → token fresco`);
      continue;
    }
    return parseFiseSaldo(j.rows[0] ?? null, base, t0);
  }
  return { ...base, status: 'ERROR', summary: 'relay celular sin resultado (token v3 rechazado o celular sin señal)', ms: Date.now() - t0 };
}
