import { join } from 'node:path';

/**
 * Slots de cuenta SPRL = fuente ÚNICA de verdad de las cuentas disponibles para el
 * historial registral. Cada slot tiene su PROPIO perfil de Chrome y puerto CDP para
 * que las sesiones no choquen (keep-alive y motor).
 *
 *  - Slot 1: `SPRL_USER`/`SPRL_PASS`  → perfil `.cdp-sprl-profile`  · puerto 9224.
 *  - Slot 2: `SPRL_USER_2`/`SPRL_PASS_2` → perfil `.cdp-sprl-profile-2` · puerto 9225.
 *
 * Se usan como slots para **failover** (si SUNARP bloquea una cuenta por IP, el motor
 * usa la otra) y **concurrencia** (2 historiales en paralelo si la RAM aguanta).
 * ⚠️ Misma IP del VPS → el límite POR IP no se parte a la mitad; el valor real es
 * failover + repartir logins. Ver memoria `consulta-placa-sprl-keepalive-lockout`.
 *
 * El keep-alive NO necesita credenciales (no hace login); por eso el slot 1 se incluye
 * SIEMPRE aunque falten las env de creds (para poder refrescar el perfil ya logueado).
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
  return slots;
}
