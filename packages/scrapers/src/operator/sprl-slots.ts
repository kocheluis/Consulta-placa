import { join } from 'node:path';

/**
 * Slots de cuenta SPRL = fuente ÚNICA de verdad de las cuentas disponibles para el
 * historial registral. Cada slot tiene su PROPIO perfil de Chrome y puerto CDP para
 * que las sesiones no choquen (keep-alive y motor) → varias cuentas pueden estar
 * ABIERTAS a la vez sin pisarse (Chrome distinto por perfil + puerto).
 *
 *  - Slot 1: `SPRL_USER`/`SPRL_PASS`     → perfil `.cdp-sprl-profile`   · puerto 9224.
 *  - Slot 2: `SPRL_USER_2`/`SPRL_PASS_2` → perfil `.cdp-sprl-profile-2` · puerto 9225.
 *  - Slot 3: `SPRL_USER_3`/`SPRL_PASS_3` → perfil `.cdp-sprl-profile-3` · puerto 9228 (BACKUP).
 *    ⚠️ 9226 (Superbid/ATU) y 9227 (SIGM) YA están tomados → el slot 3 usa 9228 para que
 *    `killEngineChrome` no mate su Chrome caliente al limpiar esas fuentes.
 *
 * Se usan como slots para **concurrencia** (N historiales en paralelo — `HISTORIAL_CONCURRENCY`
 * — si cada cuenta tiene su keep-alive y la RAM aguanta) y **failover** (si SUNARP bloquea una
 * cuenta por IP, el motor toma la siguiente del pool). Con concurrencia 2 + 3 cuentas: 2 activas
 * en paralelo + 1 de reserva para failover.
 * ⚠️ Misma IP del VPS → el límite POR IP no se parte a la mitad; el valor real es repartir logins
 * + failover + solapar 2 historiales. Ver memoria `consulta-placa-sprl-keepalive-lockout`.
 *
 * El keep-alive (`sprl-keepalive.ts`) itera TODOS los slots configurados y refresca cada sesión
 * (perfil/puerto propios) → basta con poner las env de la cuenta para que reciba keep-alive. NO
 * necesita credenciales (no hace login); por eso el slot 1 se incluye SIEMPRE aunque falten las
 * env de creds (para poder refrescar el perfil ya logueado).
 */
export interface SprlSlot {
  /** 1-based, para logs/etiquetas. */
  index: number;
  user: string;
  pass: string;
  port: number;
  profile: string;
}

const defaultProfile = (name: string): string =>
  process.cwd().startsWith('/root') ? `/root/app/${name}` : join(process.cwd(), name);

export function sprlSlots(): SprlSlot[] {
  const slots: SprlSlot[] = [];
  // Slot 1 — siempre presente (aunque el keep-alive no use creds).
  slots.push({
    index: 1,
    user: process.env.SPRL_USER ?? '',
    pass: process.env.SPRL_PASS ?? '',
    port: Number(process.env.CDP_SPRL_PORT ?? 9224),
    profile: process.env.CDP_SPRL_PROFILE ?? defaultProfile('.cdp-sprl-profile'),
  });
  // Slot 2 — solo si hay una 2ª cuenta configurada.
  if (process.env.SPRL_USER_2 && process.env.SPRL_PASS_2) {
    slots.push({
      index: 2,
      user: process.env.SPRL_USER_2,
      pass: process.env.SPRL_PASS_2,
      port: Number(process.env.CDP_SPRL_PORT_2 ?? 9225),
      profile: process.env.CDP_SPRL_PROFILE_2 ?? defaultProfile('.cdp-sprl-profile-2'),
    });
  }
  // Slot 3 — cuenta de BACKUP (reserva de failover). Puerto 9228: 9226/9227 los usan Superbid/ATU/SIGM.
  if (process.env.SPRL_USER_3 && process.env.SPRL_PASS_3) {
    slots.push({
      index: 3,
      user: process.env.SPRL_USER_3,
      pass: process.env.SPRL_PASS_3,
      port: Number(process.env.CDP_SPRL_PORT_3 ?? 9228),
      profile: process.env.CDP_SPRL_PROFILE_3 ?? defaultProfile('.cdp-sprl-profile-3'),
    });
  }
  return slots;
}
