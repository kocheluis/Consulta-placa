/* eslint-disable no-console */
/**
 * BATCH de tipificación: corre SOLO SUNARP + SPRL/Síguelo (historial registral) para MUCHAS
 * placas (p. ej. las de las boletas de Superbid) y vuelca el resultado a una tabla + dumps crudos,
 * para tipificar casuísticas del historial de asientos.
 *
 *   npx tsx packages/scrapers/src/batch-historial.ts --n 200 --spacing-min 4 --spacing-max 9
 *   npx tsx packages/scrapers/src/batch-historial.ts --plates CDK293,CHP605 --spacing-min 4 --spacing-max 8
 *
 * Anti-bloqueo (memoria consulta-placa-sprl-keepalive-lockout):
 *  - UN worker por cuenta SPRL (slot). Cada worker abre SU Chrome CDP UNA vez y lo mantiene
 *    caliente: `runHistorialRegistral({ browser })` REUSA la sesión → **un login por cuenta en
 *    todo el lote, NO uno por placa** (el bucle de re-logins es lo que dispara el lockout por IP).
 *  - Los 2 workers corren en PARALELO (usa las 2 cuentas a la vez). SUNARP se serializa solo
 *    (acquirePortLock en :9222); SPRL/Síguelo van en paralelo (:9224 / :9225).
 *  - Spacing + jitter entre placas del mismo worker; si SUNARP bloquea una cuenta, ese worker para.
 *
 * Credenciales: carga el .env local (SPRL_USER/PASS[_2], CAPTCHA_API_KEY). Corre desde la PC
 * (IP residencial) para NO tocar la IP del VPS.
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser } from 'playwright';
import { runHistorialRegistral } from './operator/historial.js';
import { agruparAsientos, type AsientoGrupo } from './operator/asiento-parser.js';
import { sprlSlots, type SprlSlot } from './operator/sprl-slots.js';
import { findChrome, chromeFlags } from './operator/chrome-path.js';

const ROOT = 'd:/Jose/Proyecto_Consulta_placa';
const INGRESO = 'https://sprl.sunarp.gob.pe/sprl/ingreso';
const CHROME = findChrome();
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── carga .env local (KEY=VALUE; no sobreescribe lo ya presente en el entorno) ──
function loadEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const k = m[1]!;
    let v = (m[2] ?? '').trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnv(join(ROOT, '.env'));
process.env.SIGUELO_DEBUG = process.env.SIGUELO_DEBUG ?? '1'; // capturar el texto crudo de cada asiento

// ── args ──
const argv = process.argv.slice(2);
const arg = (name: string, def: string): string => { const i = argv.indexOf(name); return i >= 0 ? (argv[i + 1] ?? def) : def; };
const N = Number(arg('--n', '10'));
const START = Number(arg('--start', '0'));
const SPACING_MIN = Number(arg('--spacing-min', '4')) * 1000;
const SPACING_MAX = Number(arg('--spacing-max', '9')) * 1000;
const platesArg = arg('--plates', '');
const CONCURRENCY = Number(arg('--concurrency', '2'));

// ── placas: de --plates, o de los nombres de las boletas (más recientes primero) ──
function boletaPlates(): string[] {
  const dir = join(ROOT, 'boletas');
  if (!existsSync(dir)) return [];
  const rows = readdirSync(dir)
    .filter((f) => /\.pdf$/i.test(f))
    .map((f) => ({ p: basename(f, '.pdf').toUpperCase().replace(/[^A-Z0-9]/g, ''), t: statSync(join(dir, f)).mtimeMs }))
    .filter((x) => /^[A-Z0-9]{5,8}$/.test(x.p))
    .sort((a, b) => b.t - a.t);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of rows) if (!seen.has(x.p)) { seen.add(x.p); out.push(x.p); }
  return out;
}
const all = platesArg ? platesArg.split(',').map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean) : boletaPlates();
const plates = all.slice(START, START + N);

// ── salida ──
const OUT = join(ROOT, 'validacion-fuentes', 'tipificacion');
mkdirSync(join(OUT, 'raw'), { recursive: true });
mkdirSync(join(OUT, 'parsed'), { recursive: true });
const CSV = join(OUT, 'resultados.csv');
const HEADER = 'idx;placa;ok;slot;marca;modelo;anio;titulos;asientos;acciones;maxAccAsiento;multiCompraVenta;actos;flags;ms;error\n';
if (!existsSync(CSV)) writeFileSync(CSV, HEADER, 'utf8');
const csvEsc = (s: unknown): string => `"${String(s ?? '').replace(/"/g, '""')}"`;
const vget = (v: Record<string, unknown> | null, ...keys: string[]): string => {
  for (const k of keys) { const x = v?.[k]; if (x != null && String(x).trim()) return String(x).trim(); }
  return '';
};

const slots = sprlSlots().filter((s) => s.user && s.pass);
if (!slots.length) { console.error('No hay credenciales SPRL en el .env (SPRL_USER/SPRL_PASS).'); process.exit(1); }
if (!CHROME) { console.error('No encontré chrome.exe.'); process.exit(1); }
if (!process.env.CAPTCHA_API_KEY) console.warn('⚠️ Sin CAPTCHA_API_KEY (SUNARP/Síguelo pueden fallar si piden captcha).');
const workers = slots.slice(0, Math.max(1, CONCURRENCY));
console.log(`Workers (cuentas): ${workers.map((s) => s.index).join(',')} · placas: ${plates.length} (de ${all.length}, start=${START}) · spacing ${SPACING_MIN / 1000}-${SPACING_MAX / 1000}s`);
console.log(`Salida: ${CSV}\n`);

// ── cola compartida (JS mono-hilo: un contador basta, sin locks) ──
let nextIdx = 0;
let done = 0;
const takeJob = (): { plate: string; idx: number } | null => (nextIdx < plates.length ? { plate: plates[nextIdx]!, idx: nextIdx++ } : null);

async function openSprl(port: number, profile: string): Promise<{ browser: Browser | null; proc: ChildProcess }> {
  const proc = spawn(CHROME!, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...chromeFlags(), INGRESO], { detached: false, stdio: 'ignore' });
  let browser: Browser | null = null;
  for (let i = 0; i < 25 && !browser; i++) { await sleep(700); try { browser = await chromium.connectOverCDP(`http://localhost:${port}`); } catch { /* retry */ } }
  return { browser, proc };
}

async function runWorker(slot: SprlSlot): Promise<void> {
  console.log(`  · worker slot${slot.index}: abriendo Chrome SPRL :${slot.port}…`);
  const { browser, proc } = await openSprl(slot.port, slot.profile);
  if (!browser) { console.error(`  ✗ worker slot${slot.index}: no conecté al Chrome :${slot.port}`); try { proc.kill(); } catch { /* */ } return; }
  try {
    for (;;) {
      const job = takeJob();
      if (!job) break;
      const { plate, idx } = job;
      const logs: string[] = [];
      const log = (m: string): void => { logs.push(m); };
      const t0 = Date.now();
      let res: Awaited<ReturnType<typeof runHistorialRegistral>>;
      try {
        res = await runHistorialRegistral(plate, { browser, sprlUser: slot.user, sprlPass: slot.pass, port: slot.port, profile: slot.profile, log });
      } catch (e) {
        res = { ok: false, sede: '', vehiculo: null, titulos: [], timeline: [], flags: { aseguradora: false, remate: false, financiera: false, gravamen: false, embargo: false }, error: (e as Error).message };
      }
      const ms = Date.now() - t0;

      const grupos: AsientoGrupo[] = agruparAsientos(res.timeline ?? []);
      const acciones = grupos.reduce((n, g) => n + g.acciones.length, 0);
      const maxAcc = grupos.reduce((m, g) => Math.max(m, g.acciones.length), 0);
      const multiCV = grupos.some((g) => g.acciones.filter((a) => /compra\s*-?\s*venta/i.test(a.acto)).length > 1);
      const actos = [...new Set(grupos.flatMap((g) => g.acciones.map((a) => a.acto)))].join(' | ');
      const flags = Object.entries(res.flags ?? {}).filter(([, x]) => x).map(([k]) => k).join(',');
      const v = res.vehiculo;

      const row = [
        START + idx, plate, res.ok ? 'OK' : 'FAIL', slot.index,
        vget(v, 'marca', 'brand'), vget(v, 'modelo', 'model'), vget(v, 'ano', 'anio', 'year'),
        (res.titulos ?? []).length, grupos.length, acciones, maxAcc, multiCV ? 'SI' : '',
        actos, flags, ms, res.error ?? '',
      ];
      appendFileSync(CSV, row.map((x) => (typeof x === 'number' ? x : csvEsc(x))).join(';') + '\n', 'utf8');
      writeFileSync(join(OUT, 'raw', `${plate}.log`), logs.join('\n'), 'utf8');
      writeFileSync(join(OUT, 'parsed', `${plate}.json`), JSON.stringify({ plate, ok: res.ok, error: res.error ?? null, titulos: res.titulos, flags: res.flags, vehiculo: v, grupos }, null, 2), 'utf8');

      done++;
      console.log(`[${done}/${plates.length}] ${plate} s${slot.index} → ${res.ok ? 'OK ' : 'FAIL '}${res.error ? `(${res.error.slice(0, 40)})` : ''} · ${grupos.length}as/${acciones}acc${maxAcc > 1 ? ` max${maxAcc}` : ''}${multiCV ? ' ★multiCV' : ''}${flags ? ` [${flags}]` : ''} · ${(ms / 1000).toFixed(0)}s`);

      if (res.locked) { console.log(`  ⚠️ slot ${slot.index} BLOQUEADO por IP → este worker se detiene`); break; }
      const w = Math.round(SPACING_MIN + Math.random() * Math.max(0, SPACING_MAX - SPACING_MIN));
      await sleep(w);
    }
  } finally {
    try { await browser.close(); } catch { /* */ }
    try { proc.kill(); } catch { /* */ }
    console.log(`  · worker slot${slot.index}: cerrado.`);
  }
}

await Promise.all(workers.map((s) => runWorker(s)));
console.log(`\nFIN. ${done}/${plates.length} procesadas. Tabla: ${CSV}`);
process.exit(0);
