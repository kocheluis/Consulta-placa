import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Backoff COMPARTIDO del re-login de SPRL. Lo usan DOS actores que pueden re-loguear una sesión caída:
 *  - el keep-alive (`sprl-keepalive.ts`), que actúa cuando el slot está libre; y
 *  - el heartbeat del motor continuo (`historial-pool.ts` warmSession), que es el ÚNICO que alcanza el
 *    slot cuando el pool tiene el puerto tomado (el keep-alive lo salta por `portBusy`).
 *
 * Ambos leen/escriben el MISMO archivo de estado → a lo sumo UN login por slot cada `BACKOFF_MS`,
 * sin importar quién lo intente. Esto evita el "storm" de re-logins que dispara el lockout por IP.
 * Se comparten los mismos env que ya usaba el keep-alive (compatibilidad).
 */
const STATE_FILE = (): string => process.env.SPRL_KEEPALIVE_STATE ?? '/root/out/sprl-login-state.json';
const BACKOFF_MS = (): number => Math.max(0, Number(process.env.SPRL_KEEPALIVE_LOGIN_BACKOFF_MS ?? 60 * 60_000)); // 1 h

/** ¿El auto-login acotado está habilitado? (default ON; apagar con SPRL_KEEPALIVE_LOGIN=0). */
export const sprlLoginEnabled = (): boolean => process.env.SPRL_KEEPALIVE_LOGIN !== '0';

function load(): Record<string, number> {
  try { return JSON.parse(readFileSync(STATE_FILE(), 'utf8')) as Record<string, number>; } catch { return {}; }
}

/** ¿Pasó el backoff para volver a intentar login en este slot? (persistido → sobrevive reinicios/cron). */
export function loginBackoffOk(idx: number): boolean {
  return Date.now() - (load()[String(idx)] ?? 0) >= BACKOFF_MS();
}

/** Marca el instante del intento ANTES de intentar → respeta el backoff aunque el proceso muera a mitad. */
export function recordLoginAttempt(idx: number): void {
  const a = load(); a[String(idx)] = Date.now();
  try { writeFileSync(STATE_FILE(), JSON.stringify(a)); } catch { /* disco RO / dev → no-op */ }
}
