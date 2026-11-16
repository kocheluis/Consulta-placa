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
import { request as httpsRequest } from 'node:https';
import type { CaptchaSolver } from '../captcha/index.js';
import { parseFiseSaldo, FISE_SITEKEY, FISE_PAGE_URL, FISE_ENDPOINT, type OperatorSourceResult } from './sources.js';

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
  /** Relay al que va dirigido (id). undefined = cualquiera. */
  target?: string;
  /** Relay que lo tomó (para contar éxitos/fallas por equipo). */
  takenBy?: string;
  resolve: (r: RelayOutcome) => void;
}

/**
 * VARIOS RELAYS con PRIORIDAD (nov-2026): la PC de casa (prioridad 1) y el celular de respaldo
 * (prioridad 2). Cada worker se identifica al hacer poll (relay, prio, label); el VPS dirige cada
 * consulta al relay VIVO de mejor prioridad y, si no responde a tiempo, la reintenta en el siguiente.
 * Un worker antiguo que no se identifica cuenta como "celular" (prioridad 2).
 */
export interface RelayMeta { id?: unknown; prio?: unknown; label?: unknown }
interface RelayInfo { id: string; label: string; prio: number; lastSeen: number; served: number; done: number; fails: number }

const relays = new Map<string, RelayInfo>();
const pending: RelayJob[] = []; // aún no entregados a un relay
const inFlight = new Map<string, RelayJob>(); // entregados, esperando resultado
let seq = 0;

function touchRelay(meta?: RelayMeta): RelayInfo {
  const id = String(meta?.id ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'celular';
  const prioN = Number(meta?.prio);
  const prio = Number.isFinite(prioN) && prioN >= 1 && prioN <= 9 ? Math.floor(prioN) : (id === 'pc' ? 1 : 2);
  const label = String(meta?.label ?? '').replace(/[^A-Za-z0-9ÁÉÍÓÚáéíóúÑñ ._-]/g, '').slice(0, 30)
    || (id === 'pc' ? 'PC de casa' : id === 'celular' ? 'Celular' : id);
  const cur = relays.get(id) ?? { id, label, prio, lastSeen: 0, served: 0, done: 0, fails: 0 };
  cur.label = label;
  cur.prio = prio;
  cur.lastSeen = Date.now();
  relays.set(id, cur);
  return cur;
}

const aliveMs = (): number => Math.max(15_000, Number(process.env.FISE_RELAY_ALIVE_MS ?? 120_000));
const isAlive = (r: RelayInfo): boolean => Date.now() - r.lastSeen < aliveMs();

/** Relays vivos, del de mejor prioridad al peor (a igual prioridad, el que latió más reciente). */
export function aliveRelays(): Array<{ id: string; label: string; prio: number }> {
  return [...relays.values()].filter(isAlive).sort((a, b) => a.prio - b.prio || b.lastSeen - a.lastSeen)
    .map(({ id, label, prio }) => ({ id, label, prio }));
}

function tokenOk(t: unknown): boolean {
  const want = process.env.FISE_RELAY_TOKEN ?? '';
  if (!want) return false; // sin token configurado → relay deshabilitado (no hay endpoint abierto)
  const got = String(t ?? '');
  if (got.length !== want.length) return false;
  try { return timingSafeEqual(Buffer.from(got), Buffer.from(want)); } catch { return false; }
}

/** ¿Algún relay (PC o celular) dio señales de vida hace poco? (default 2 min; knob FISE_RELAY_ALIVE_MS). */
export function fiseRelayAlive(): boolean {
  return [...relays.values()].some(isAlive);
}

export function fiseRelayStatus(): Record<string, unknown> {
  const all = [...relays.values()].sort((a, b) => a.prio - b.prio);
  const last = Math.max(0, ...all.map((r) => r.lastSeen));
  const active = aliveRelays()[0] ?? null;
  return {
    enabled: !!process.env.FISE_RELAY_TOKEN,
    alive: fiseRelayAlive(),
    lastSeenAgoS: last ? Math.round((Date.now() - last) / 1000) : null,
    active: active ? active.id : null,
    relays: all.map((r) => ({
      id: r.id, label: r.label, prio: r.prio, alive: isAlive(r),
      lastSeenAgoS: Math.round((Date.now() - r.lastSeen) / 1000), served: r.served, done: r.done, fails: r.fails,
    })),
    pending: pending.length, inFlight: inFlight.size,
  };
}

/** GET /api/fise-relay/next — un relay pide trabajo (y de paso late su heartbeat). */
export function relayNext(token: unknown, meta?: RelayMeta): { code: number; body: unknown } {
  if (!tokenOk(token)) return { code: 403, body: { error: 'token inválido o relay deshabilitado' } };
  const me = touchRelay(meta);
  const idx = pending.findIndex((j) => !j.target || j.target === me.id);
  if (idx < 0) return { code: 200, body: { job: null } };
  const job = pending.splice(idx, 1)[0]!;
  job.takenBy = me.id;
  inFlight.set(job.id, job);
  me.served++;
  return { code: 200, body: { job: { id: job.id, plate: job.plate, captchaToken: job.captchaToken } } };
}

/** POST /api/fise-relay/result — un relay devuelve el resultado de un job. */
export function relayResult(token: unknown, body: Record<string, unknown>, meta?: RelayMeta): { code: number; body: unknown } {
  if (!tokenOk(token)) return { code: 403, body: { error: 'token inválido o relay deshabilitado' } };
  const me = touchRelay(meta);
  const job = inFlight.get(String(body.id ?? ''));
  if (!job) return { code: 200, body: { ok: false, error: 'job desconocido (¿expiró el tope y ya se resolvió como timeout?)' } };
  inFlight.delete(job.id);
  const who = relays.get(job.takenBy ?? me.id) ?? me;
  if (body.ok === true) who.done++; else who.fails++;
  job.resolve({
    ok: body.ok === true,
    httpStatus: Number(body.httpStatus ?? 0) || undefined,
    bodyText: typeof body.bodyText === 'string' ? body.bodyText : undefined,
    error: typeof body.error === 'string' ? body.error : undefined,
  });
  return { code: 200, body: { ok: true } };
}

/** Encola una consulta y espera el resultado del celular (o expira sin colgar el reporte). */
export function relayEnqueue(plate: string, captchaToken: string, timeoutMs: number, target?: string): Promise<RelayOutcome> {
  return new Promise((resolve) => {
    const id = `f${Date.now().toString(36)}-${(seq++).toString(36)}`;
    let settled = false;
    const finish = (r: RelayOutcome): void => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
    const job: RelayJob = { id, plate, captchaToken, createdAt: Date.now(), target, resolve: finish };
    const timer = setTimeout(() => {
      const idx = pending.indexOf(job);
      if (idx >= 0) pending.splice(idx, 1);
      inFlight.delete(id);
      const who = relays.get(job.takenBy ?? target ?? '');
      if (who) who.fails++;
      finish({ ok: false, error: `relay ${who?.label ?? target ?? ''} sin respuesta en ${Math.round(timeoutMs / 1000)}s (¿equipo dormido / sin red?)` });
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
  // Prioridad: PC → celular. Con respaldo disponible, el relay actual tiene menos tiempo (30 s): si no
  // responde, el siguiente intento va al respaldo sin que el reporte espere de más.
  const tried = new Set<string>();
  const MAX = 3;
  for (let i = 1; i <= MAX; i++) {
    const vivos = aliveRelays();
    if (!vivos.length) { log('ningún relay vivo (PC ni celular) → FISE no disponible'); break; }
    const relay = vivos.find((x) => !tried.has(x.id)) ?? vivos[0]!;
    const hayRespaldo = vivos.some((x) => x.id !== relay.id && !tried.has(x.id));
    const tope = hayRespaldo ? Math.min(timeoutMs, 30_000) : timeoutMs;
    let token = '';
    try { token = await solver.solveRecaptchaV3(FISE_SITEKEY, FISE_PAGE_URL, 'consulta'); }
    catch (e) { log(`intento ${i}/${MAX}: captcha falló (${(e as Error).message})`); continue; }
    log(`intento ${i}/${MAX}: token v3 listo → relay "${relay.label}" (prioridad ${relay.prio}, tope ${Math.round(tope / 1000)}s)`);
    const out = await relayEnqueue(plate, token, tope, relay.id);
    if (!out.ok) {
      log(`intento ${i}/${MAX}: ${out.error ?? `${relay.label} reportó fallo`}`);
      tried.add(relay.id); // el siguiente intento prueba el respaldo (si lo hay)
      continue;
    }
    let j: { status?: number; rows?: Array<Record<string, unknown>> } | null = null;
    try { j = JSON.parse(out.bodyText ?? ''); } catch { /* HTML / no-JSON (token rechazado) */ }
    if (!j || j.status !== 0 || !Array.isArray(j.rows)) {
      log(`intento ${i}/${MAX}: respuesta no válida (http ${out.httpStatus ?? '?'}, status=${j?.status ?? '?'}) → token fresco`);
      continue;
    }
    return parseFiseSaldo(j.rows[0] ?? null, base, t0);
  }
  return { ...base, status: 'ERROR', summary: fiseRelayAlive() ? 'relay residencial sin resultado (token v3 rechazado o el equipo no respondió)' : 'relay residencial (PC y celular) sin señal — FISE bloquea la IP del VPS', ms: Date.now() - t0 };
}

/* ───────────── FISE DIRECTO desde el VPS (nov-2026: el dominio nuevo no bloquea al VPS) ───────────── */

interface HttpRes { status: number; headers: Record<string, string | string[] | undefined>; text: string }

/** HTTPS con tiempo límite. rejectUnauthorized:false igual que el worker (FISE ha servido certificados
 *  sin cadena intermedia); los datos son públicos y no viaja ningún secreto. */
function fiseHttp(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}): Promise<HttpRes> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: opts.method ?? 'GET', headers: opts.headers ?? {}, rejectUnauthorized: false, timeout: opts.timeoutMs ?? 20_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** GET de la página de consulta siguiendo redirecciones y juntando cookies (JSESSIONID, cookiesession1). */
async function fiseSession(): Promise<{ cookies: string[]; consultaId: string; pageUrl: string }> {
  const cookies: string[] = [];
  let url = FISE_PAGE_URL;
  let page: HttpRes | null = null;
  for (let hop = 0; hop < 4; hop++) {
    page = await fiseHttp(url, { headers: cookies.length ? { Cookie: cookies.join('; ') } : {} });
    const sc = page.headers['set-cookie'];
    for (const c of Array.isArray(sc) ? sc : sc ? [sc] : []) cookies.push(c.split(';')[0]!);
    const loc = page.headers.location;
    if (page.status >= 300 && page.status < 400 && typeof loc === 'string') { url = new URL(loc, url).href; continue; }
    break;
  }
  if (!page || page.status !== 200) throw new Error(`página FISE HTTP ${page?.status ?? '?'}`);
  const consultaId = /id="consultaId"[^>]*value="([^"]*)"/.exec(page.text)?.[1] ?? /name="consultaId"[^>]*value="([^"]*)"/.exec(page.text)?.[1] ?? '';
  return { cookies, consultaId, pageUrl: url };
}

/**
 * FISE directo desde el VPS: sesión + POST buscarSaldo con el token v3 (CapSolver). Devuelve null si la RED
 * falla (bloqueo/timeout) para que el llamador pase a los relays; un ERROR de captcha también cae al relay.
 */
export async function runFiseDirect(plate: string, solver: CaptchaSolver, log: (m: string) => void): Promise<OperatorSourceResult | null> {
  const t0 = Date.now();
  const base = { source: 'FISE_GNV', label: 'FISE · Deuda de conversión GNV', category: 'GNV' };
  let sess: { cookies: string[]; consultaId: string; pageUrl: string };
  try { sess = await fiseSession(); }
  catch (e) { log(`directo: el VPS no alcanza FISE (${(e as Error).message}) → relays`); return null; }
  for (let i = 1; i <= 3; i++) {
    let token = '';
    try { token = await solver.solveRecaptchaV3(FISE_SITEKEY, FISE_PAGE_URL, 'consulta'); }
    catch (e) { log(`directo ${i}/3: captcha falló (${(e as Error).message})`); continue; }
    let res: HttpRes;
    try {
      res = await fiseHttp(FISE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', Referer: sess.pageUrl, Cookie: sess.cookies.join('; ') },
        body: JSON.stringify({ placaVehiculo: plate, consultaId: sess.consultaId, codigoVerificacion: token, tiempoSession: 8, countBusqueda: i }),
      });
    } catch (e) { log(`directo ${i}/3: red (${(e as Error).message}) → relays`); return null; }
    let j: { status?: number; rows?: Array<Record<string, unknown>> } | null = null;
    try { j = JSON.parse(res.text); } catch { /* HTML / redirección */ }
    if (j && j.status === 0 && Array.isArray(j.rows)) {
      log(`directo ${i}/3: respuesta OK desde el VPS`);
      return parseFiseSaldo(j.rows[0] ?? null, base, t0);
    }
    log(`directo ${i}/3: respuesta no válida (HTTP ${res.status}${res.headers.location ? ` → ${String(res.headers.location)}` : ''}, status=${j?.status ?? '?'})`);
  }
  return { ...base, status: 'ERROR', summary: 'FISE rechazó la verificación anti-robot (3 intentos desde el VPS)', ms: Date.now() - t0 };
}
