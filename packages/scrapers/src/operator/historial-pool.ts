import { chromium, type Browser } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { runHistorialRegistral } from './historial.js';
import { sprlSlots, type SprlSlot } from './sprl-slots.js';
import { findChrome, chromeFlags } from './chrome-path.js';

/**
 * POOL de historial registral: corre el historial (SUNARP→SPRL→Síguelo) de MUCHAS placas
 * con un worker por cuenta SPRL (slot). Cada worker abre SU Chrome CDP UNA vez y REUSA la
 * sesión entre placas → **un login por cuenta en todo el lote, no uno por placa** (el bucle
 * de re-logins es lo que dispara el lockout por IP; ver memoria sprl-keepalive-lockout).
 *
 * - Los N workers corren en PARALELO (2 cuentas → 2 hilos). SUNARP se serializa solo
 *   (acquirePortLock :9222); SPRL/Síguelo van en paralelo (:9224 / :9225).
 * - Cola compartida (JS mono-hilo → un contador basta, sin locks).
 * - Si SUNARP bloquea una cuenta, ESE worker se detiene; los demás siguen con el resto.
 *
 * Es la base de los "2 hilos de historial" del motor por lotes. `openBrowser`/`runOne` son
 * inyectables para poder probar la distribución de trabajo sin Chrome ni SPRL reales.
 */
const INGRESO = 'https://sprl.sunarp.gob.pe/sprl/ingreso';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export type HistorialResult = Awaited<ReturnType<typeof runHistorialRegistral>>;

export interface PoolResult {
  plate: string;
  slot: number;
  ms: number;
  result: HistorialResult;
  logs: string[];
}

export interface HistorialPoolOpts {
  /** Nº de workers (default = nº de slots con credenciales). */
  concurrency?: number;
  /** Pausa + jitter (ms) entre placas del MISMO worker. Default sin pausa. */
  spacingMs?: [number, number];
  /** Callback por placa terminada (para actualizar UI / entregar apenas lista). */
  onResult?: (r: PoolResult) => void;
  /** Log por slot (progreso). */
  log?: (slot: number, m: string) => void;
  /** Abre el Chrome CDP de un slot (inyectable para tests). */
  openBrowser?: (slot: SprlSlot) => Promise<{ browser: Browser | null; close: () => Promise<void> }>;
  /** Ejecuta el historial de UNA placa reusando el browser del slot (inyectable para tests). */
  runOne?: (plate: string, slot: SprlSlot, browser: Browser | null, log: (m: string) => void) => Promise<HistorialResult>;
}

/**
 * Obtiene el Chrome CDP de un slot SPRL. CONECTAR-PRIMERO: si ya hay un Chrome en el puerto
 * (p. ej. el keep-alive del VPS con la sesión SPRL CALIENTE), se conecta y NO lo cierra (matarlo
 * perdería la sesión y forzaría re-login → lockout). Solo si nadie escucha, hace spawn propio (y
 * sí lo cierra al terminar el lote). Evita chocar con el keep-alive por el mismo perfil/puerto.
 */
async function openSprl(slot: SprlSlot): Promise<{ browser: Browser | null; close: () => Promise<void> }> {
  const url = `http://localhost:${slot.port}`;
  try {
    const browser = await chromium.connectOverCDP(url);
    return { browser, close: async () => { /* no cerrar: la sesión la mantiene el keep-alive */ } };
  } catch { /* nadie escuchando en el puerto → lo abrimos nosotros */ }

  const chrome = findChrome();
  if (!chrome) return { browser: null, close: async () => {} };
  const proc: ChildProcess = spawn(
    chrome,
    [`--remote-debugging-port=${slot.port}`, `--user-data-dir=${slot.profile}`, ...chromeFlags(), INGRESO],
    { detached: false, stdio: 'ignore' },
  );
  let browser: Browser | null = null;
  for (let i = 0; i < 25 && !browser; i++) {
    await sleep(700);
    try { browser = await chromium.connectOverCDP(url); } catch { /* retry */ }
  }
  return {
    browser,
    close: async () => {
      try { await browser?.close(); } catch { /* */ }
      try { proc.kill(); } catch { /* */ }
    },
  };
}

const failResult = (error: string): HistorialResult =>
  ({ ok: false, sede: '', vehiculo: null, titulos: [], timeline: [], flags: { aseguradora: false, remate: false, financiera: false, gravamen: false, embargo: false }, error }) as HistorialResult;

const defaultRunOne = (plate: string, slot: SprlSlot, browser: Browser | null, log: (m: string) => void): Promise<HistorialResult> =>
  runHistorialRegistral(plate, {
    browser: browser ?? undefined, sprlUser: slot.user, sprlPass: slot.pass, port: slot.port, profile: slot.profile, log,
    // Síguelo en paralelo (conc. 2 por placa) si HISTORIAL_PARALLEL=1 → ~2× en autos con varios títulos.
    parallel: process.env.HISTORIAL_PARALLEL === '1',
  });

/**
 * Corre el historial de `plates` con un pool de workers (uno por cuenta SPRL). Devuelve un
 * mapa placa→resultado. Las placas que ningún worker alcanzó a atender (p. ej. todos los
 * slots se bloquearon) NO aparecen en el mapa → el llamador las marca como ERROR de historial.
 */
export async function runHistorialPool(plates: string[], opts: HistorialPoolOpts = {}): Promise<Map<string, PoolResult>> {
  const results = new Map<string, PoolResult>();
  const withCreds = sprlSlots().filter((s) => s.user && s.pass);
  const conc = Math.max(1, Math.min(opts.concurrency ?? withCreds.length, withCreds.length));
  const slots = withCreds.slice(0, conc);
  if (!slots.length || !plates.length) return results;

  const openBrowser = opts.openBrowser ?? openSprl;
  const runOne = opts.runOne ?? defaultRunOne;
  const [smin, smax] = opts.spacingMs ?? [0, 0];
  const slog = opts.log ?? (() => {});

  let next = 0;
  const take = (): string | null => (next < plates.length ? plates[next++]! : null);

  async function worker(slot: SprlSlot): Promise<void> {
    slog(slot.index, `abriendo Chrome SPRL :${slot.port}`);
    const { browser, close } = await openBrowser(slot);
    try {
      for (;;) {
        const plate = take();
        if (!plate) break;
        const logs: string[] = [];
        const plog = (m: string): void => { logs.push(m); slog(slot.index, m); };
        const t0 = Date.now();
        let result: HistorialResult;
        try { result = await runOne(plate, slot, browser, plog); }
        catch (e) { result = failResult((e as Error).message); }
        const r: PoolResult = { plate, slot: slot.index, ms: Date.now() - t0, result, logs };
        results.set(plate, r);
        opts.onResult?.(r);
        if ((result as { locked?: boolean }).locked) { slog(slot.index, `slot ${slot.index} BLOQUEADO por IP → worker se detiene`); break; }
        if (smax > 0) await sleep(Math.round(smin + Math.random() * Math.max(0, smax - smin)));
      }
    } finally {
      await close();
      slog(slot.index, `worker slot${slot.index} cerrado`);
    }
  }

  await Promise.all(slots.map(worker));
  return results;
}

/** Una placa a procesar por el pool continuo (el `outDir` es para el screenshot del historial). */
export interface HistorialTask { plate: string; outDir?: string }

export interface HistorialPoolLiveOpts {
  /** Nº de workers (default = nº de slots con credenciales). Tope físico = nº de cuentas SPRL. */
  concurrency?: number;
  /** Pausa + jitter (ms) entre placas del MISMO worker. Default sin pausa. */
  spacingMs?: [number, number];
  /** Callback por placa terminada (para entregar apenas lista). */
  onResult?: (r: PoolResult) => void;
  log?: (slot: number, m: string) => void;
  /** Log POR TAREA (placa) → deja escribir cada línea al archivo `historial.log` de esa placa (logs en vivo). */
  onLog?: (task: HistorialTask, m: string) => void;
  /** Log de eventos del POOL (no ligados a una placa): heartbeat, enfriamiento, failover. Va a stdout/pm2. */
  onEngineLog?: (m: string) => void;
  /** Heartbeat (ms) para mantener CALIENTE la sesión SPRL del worker parqueado (0 = off). El worker tiene
   *  el perfil tomado (:9224 sale `perfil-en-uso` para el keep-alive), así que es el ÚNICO que puede
   *  refrescarla → sin esto la sesión se enfría entre pedidos y cada historial hace cold-login (→ lockout).
   *  Default env `HISTORIAL_HEARTBEAT_MS` o 6 min. */
  heartbeatMs?: number;
  /** Enfriamiento (ms) tras bloquear TODAS las cuentas por IP: en vez de MATAR el carril (return), espera
   *  y repone los slots (la IP se libera sola). 0 = comportamiento viejo. Default env
   *  `HISTORIAL_LOCKOUT_COOLDOWN_MS` o 30 min. */
  cooldownMs?: number;
  openBrowser?: (slot: SprlSlot) => Promise<{ browser: Browser | null; close: () => Promise<void> }>;
  runOne?: (plate: string, slot: SprlSlot, browser: Browser | null, log: (m: string) => void) => Promise<HistorialResult>;
}

const PARTIDA_URL = 'https://sprl.sunarp.gob.pe/sprl/main/partidas-base-grafica-registral';
const RX_VIVA = /SALDO|BUSCAR SERVICIOS|CERRAR SESI|HOLA/;

/**
 * HEARTBEAT: refresca la sesión SPRL del browser YA ABIERTO (SIN login), navegando a PARTIDA para que
 * el re-auth OAuth mantenga vivo el token mientras el worker está IDLE. Es lo mismo que hace el
 * keep-alive, pero DESDE el motor — el único que puede, porque tiene el perfil tomado (para el
 * keep-alive el puerto sale `perfil-en-uso` y lo salta). Espera CORTA (~8s): solo dispara el re-auth,
 * no bloquea un historial entrante. Nunca lanza: un heartbeat fallido no debe tumbar el pool.
 */
async function warmSession(browser: Browser): Promise<string> {
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(PARTIDA_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  let body = '';
  for (let i = 0; i < 8; i++) {
    body = (await page.locator('body').innerText().catch(() => '')).toUpperCase();
    if (RX_VIVA.test(body)) break;
    await sleep(1000);
  }
  return RX_VIVA.test(body) ? 'VIVA' : (/PASSWORD|USERNAME|INGRESAR/.test(body) ? 'CAIDA' : 'DESCONOCIDO');
}

/** setTimeout cancelable (para no dejar timers colgando que retrasen el apagado del motor). */
function delayHandle(ms: number): { p: Promise<void>; cancel: () => void } {
  let t: ReturnType<typeof setTimeout>;
  const p = new Promise<void>((r) => { t = setTimeout(r, ms); });
  return { p, cancel: () => clearTimeout(t) };
}

/**
 * Espera la próxima tarea del canal MANTENIENDO CALIENTE la sesión: cada `everyMs` sin tarea hace un
 * heartbeat (`warmSession`). En cuanto llega la tarea, corta y espera a que el heartbeat en curso
 * termine (no arranca un historial con la sesión a medio refrescar). `take()` se llama UNA sola vez
 * (no se consume de más). Sin browser o `everyMs<=0` → espera normal, sin heartbeat.
 */
async function takeWarm(
  take: () => Promise<HistorialTask | null>,
  browser: Browser | null,
  everyMs: number,
  onBeat: (state: string) => void,
): Promise<HistorialTask | null> {
  if (!browser || everyMs <= 0) return take();
  const taskP = take();
  let resolved = false;
  void taskP.then(() => { resolved = true; }, () => { resolved = true; });
  for (;;) {
    const d = delayHandle(everyMs);
    const winner = await Promise.race([taskP.then(() => 'task'), d.p.then(() => 'beat')]);
    d.cancel();
    if (winner === 'task' || resolved) return taskP;
    try { onBeat(await warmSession(browser)); } catch { /* un heartbeat fallido nunca tumba el pool */ }
  }
}

/**
 * POOL de historial CONTINUO (motor streaming): idéntico a `runHistorialPool` pero, en vez de un
 * array FIJO de placas, jala de un canal (`take`) que el dispatcher va llenando en caliente. Cada
 * worker abre su Chrome SPRL UNA vez y REUSA la sesión entre placas mientras el canal siga vivo →
 * un login por cuenta para TODO el turno, no por lote (evita el re-login que dispara el lockout).
 *
 * `take()` devuelve la siguiente placa o `null` cuando el canal se cierra (apagado) → el worker
 * cierra su Chrome y termina. Si SUNARP bloquea un slot por IP, ESE worker se detiene (como el pool
 * por lotes); los demás siguen atendiendo el canal. (Auto-recuperar el slot tras cooldown = Fase 2.)
 */
export async function runHistorialPoolLive(
  take: () => Promise<HistorialTask | null>,
  opts: HistorialPoolLiveOpts = {},
): Promise<void> {
  const withCreds = sprlSlots().filter((s) => s.user && s.pass);
  if (!withCreds.length) return;
  // DEFAULT 1: UN historial a la vez sobre el slot CALIENTE (el que mantiene el keep-alive), con
  // FAILOVER al siguiente slot solo si SUNARP bloquea el actual. Correr 2 en paralelo NO duplica el
  // throughput (misma IP del VPS) y obliga a un cold-login en la 2ª cuenta en CADA pedido → inunda de
  // logins → lockout de ambas cuentas. Subir HISTORIAL_CONCURRENCY solo si cada cuenta tiene su propio
  // keep-alive. Ver memoria consulta-placa-sprl-keepalive-lockout.
  const conc = Math.max(1, Math.min(opts.concurrency ?? 1, withCreds.length));
  const openBrowser = opts.openBrowser ?? openSprl;
  const runOne = opts.runOne ?? defaultRunOne;
  const [smin, smax] = opts.spacingMs ?? [0, 0];
  const slog = opts.log ?? (() => {});
  const elog = opts.onEngineLog ?? (() => {});
  // Heartbeat: mantiene caliente la sesión del worker parqueado → mata el cold-login que dispara el
  // bloqueo por IP. Solo aplica cuando el worker está IDLE (esperando placa); durante un historial no corre.
  const heartbeatMs = opts.heartbeatMs ?? Number(process.env.HISTORIAL_HEARTBEAT_MS ?? 6 * 60_000);
  // Enfriamiento tras bloquear TODAS las cuentas por IP: en vez de matar el carril, espera y repone los
  // slots (la IP se libera sola). 0 = comportamiento viejo (el worker termina → historial muerto hasta reiniciar).
  const cooldownMs = opts.cooldownMs ?? Number(process.env.HISTORIAL_LOCKOUT_COOLDOWN_MS ?? 30 * 60_000);

  // Pool COMPARTIDO de slots libres: un worker que se queda sin slot por lockout toma el siguiente
  // (failover). Con concurrencia 1 → 1 slot activo + failover (el modelo del motor viejo, sin cold-login spam).
  const freeSlots = [...withCreds];

  async function worker(): Promise<void> {
    let pending: HistorialTask | null = null; // placa a REINTENTAR en el próximo slot tras un lockout
    let lockedUntil = 0; // epoch ms; mientras now < lockedUntil TODA la IP está en enfriamiento (fail-fast)
    for (;;) {
      // Fin del enfriamiento → repone TODOS los slots (idempotente entre workers) y reanuda normal.
      if (lockedUntil && Date.now() >= lockedUntil) {
        lockedUntil = 0;
        if (freeSlots.length === 0) { freeSlots.push(...withCreds); elog('enfriamiento terminado → slots repuestos, historial reanudado'); }
      }
      // Durante el enfriamiento: seguimos consumiendo el canal pero FALLAMOS RÁPIDO (reintentar SPRL
      // agravaría el bloqueo por IP). El carril sigue VIVO → al vencer el cooldown vuelve a atender.
      if (lockedUntil) {
        const task: HistorialTask | null = pending ?? (await take());
        pending = null;
        if (!task) return; // canal cerrado → salida limpia (el apagado no cuelga)
        if (Date.now() >= lockedUntil) { pending = task; continue; } // venció mientras esperábamos → procesar normal
        const mins = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60_000));
        opts.onResult?.({ plate: task.plate, slot: -1, ms: 0, result: failResult(`SUNARP bloqueó la IP del VPS (límite de intentos de login); historial en enfriamiento ~${mins} min. Reintentá luego.`), logs: [] });
        continue;
      }
      const slot = freeSlots.shift();
      if (!slot) { // no quedan cuentas libres → todas bloqueadas por IP
        // NO matamos el carril: entramos en enfriamiento y al vencer reponemos los slots (auto-recuperación,
        // "Fase 2"). La placa pendiente (si hay) cae en el fail-fast de arriba. cooldownMs=0 → comportamiento viejo.
        if (cooldownMs <= 0) {
          if (pending) { opts.onResult?.({ plate: pending.plate, slot: -1, ms: 0, result: failResult('todas las cuentas SPRL bloqueadas por IP'), logs: [] }); pending = null; }
          return;
        }
        lockedUntil = Date.now() + cooldownMs;
        elog(`todas las cuentas SPRL bloqueadas por IP → enfriamiento ${Math.round(cooldownMs / 60_000)} min (el carril sigue vivo)`);
        continue;
      }
      slog(slot.index, `abriendo Chrome SPRL :${slot.port} (pool continuo)`);
      const { browser, close } = await openBrowser(slot);
      let failover = false;
      try {
        for (;;) {
          // Espera la próxima tarea manteniendo CALIENTE la sesión (heartbeat) → evita el cold-login.
          const task: HistorialTask | null = pending ?? (await takeWarm(take, browser, heartbeatMs, (st) => elog(`heartbeat slot${slot.index} sesión=${st}`)));
          pending = null;
          if (!task) return; // canal cerrado → apagado limpio (sale del worker por completo)
          const logs: string[] = [];
          const plog = (m: string): void => { logs.push(m); slog(slot.index, m); opts.onLog?.(task, m); };
          const t0 = Date.now();
          let result: HistorialResult;
          try { result = await runOne(task.plate, slot, browser, plog); }
          catch (e) { result = failResult((e as Error).message); }
          if ((result as { locked?: boolean }).locked) {
            slog(slot.index, `slot ${slot.index} BLOQUEADO por IP → failover al siguiente slot (reintenta ${task.plate})`);
            elog(`slot ${slot.index} bloqueado por IP → failover (reintenta ${task.plate})`);
            pending = task;   // REINTENTAR esta placa en el próximo slot (aún no se reporta)
            failover = true;
            break;            // cierra este slot y el for exterior toma el siguiente
          }
          opts.onResult?.({ plate: task.plate, slot: slot.index, ms: Date.now() - t0, result, logs });
          if (smax > 0) await sleep(Math.round(smin + Math.random() * Math.max(0, smax - smin)));
        }
      } finally {
        await close();
        slog(slot.index, `worker slot${slot.index} cerrado (pool continuo)`);
      }
      if (!failover) return; // salida no-lockout → terminar (el canal cerrado ya hizo return arriba)
    }
  }

  await Promise.all(Array.from({ length: conc }, worker));
}
