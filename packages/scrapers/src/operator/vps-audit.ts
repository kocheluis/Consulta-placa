/**
 * AUDITORÍA DE SEGURIDAD DEL VPS — lógica PURA. El server corre comandos fijos (sin entrada del
 * usuario) y entrega su salida cruda aquí; esto la convierte en chequeos ok/warn/fail para el reporte
 * diario. Pensado para Ubuntu (sshd, ufw, fail2ban, apt, pm2).
 */
import type { InfraCheck } from './health.js';

export interface SecurityRaw {
  /** `sshd -T` (config EFECTIVA, no el archivo). */
  sshdT?: string;
  /** `ufw status`. */
  ufw?: string;
  /** `systemctl is-active fail2ban`. */
  fail2ban?: string;
  /** Líneas "Failed password"/"Invalid user" del journal de ssh en 24 h. */
  failedSsh24h?: number;
  /** IPs distintas con login exitoso en 24 h (`Accepted publickey|password for USER from IP`). */
  acceptedLogins?: Array<{ user: string; ip: string; method: string }>;
  /** `ss -tlnH` (puertos TCP escuchando). */
  listening?: string;
  /** Puertos que SÍ pueden escuchar en todas las interfaces. */
  allowedPublicPorts?: number[];
  /** Huellas de las llaves autorizadas ahora (root + claude-ops), formato `usuario:SHA256:… comentario`. */
  keysNow?: string[];
  /** Huellas aceptadas por el dueño (línea base). null = primera vez (se adopta sin alarma). */
  keysBaseline?: string[] | null;
  /** `df -P /` → % usado. */
  diskPct?: number;
  /** Paquetes con actualización de seguridad pendiente. */
  securityUpdates?: number;
  /** `systemctl is-enabled unattended-upgrades`. */
  unattended?: string;
  /** /var/run/reboot-required existe. */
  rebootRequired?: boolean;
  /** Permisos octales de /root/placape.env (p. ej. "600"). */
  envMode?: string;
  /** Reinicios de pm2 desde el último reporte, por proceso. */
  pm2RestartsDelta?: Record<string, number>;
  /** Procesos pm2 que no están `online`. */
  pm2Down?: string[];
  /** Comandos de placape-ops (acceso de Claude) en 24 h. */
  opsCalls24h?: number;
}

const val = (sshdT: string, key: string): string =>
  (sshdT.split('\n').find((l) => l.toLowerCase().startsWith(`${key} `)) ?? '').split(/\s+/)[1]?.toLowerCase() ?? '';

/** Puertos que escuchan en 0.0.0.0 / [::] / * (accesibles desde fuera si el firewall lo deja). */
export function publicPorts(ss: string): number[] {
  const out = new Set<number>();
  for (const line of ss.split('\n')) {
    const cols = line.trim().split(/\s+/);
    const local = cols.find((c) => /:\d+$/.test(c) && /^(0\.0\.0\.0|\*|\[::\]|::):/.test(c));
    if (local) out.add(Number(local.split(':').pop()));
  }
  return [...out].sort((a, b) => a - b);
}

export function evaluateSecurity(r: SecurityRaw): InfraCheck[] {
  const out: InfraCheck[] = [];
  const add = (id: string, label: string, severity: InfraCheck['severity'], detail: string) => out.push({ id: `sec-${id}`, label, severity, detail });

  if (r.sshdT != null) {
    const pw = val(r.sshdT, 'passwordauthentication');
    const root = val(r.sshdT, 'permitrootlogin');
    add('ssh-pass', 'SSH: login con contraseña', pw === 'no' ? 'ok' : 'warn',
      pw === 'no' ? 'deshabilitado (solo llaves)' : 'HABILITADO → expuesto a fuerza bruta. Cuando entres con llave: PasswordAuthentication no');
    add('ssh-root', 'SSH: login de root', root === 'yes' ? 'warn' : 'ok',
      root === 'yes' ? 'root entra con contraseña → usar prohibit-password' : `permitrootlogin=${root || '?'}`);
  }
  if (r.ufw != null) add('ufw', 'Firewall (ufw)', /Status: active/i.test(r.ufw) ? 'ok' : 'fail', /Status: active/i.test(r.ufw) ? 'activo' : 'INACTIVO → todos los puertos expuestos');
  if (r.fail2ban != null) add('f2b', 'fail2ban (bloqueo de fuerza bruta)', r.fail2ban.trim() === 'active' ? 'ok' : 'warn', r.fail2ban.trim() === 'active' ? 'activo' : 'no está corriendo → apt install -y fail2ban');
  if (r.failedSsh24h != null) {
    const n = r.failedSsh24h;
    add('ssh-fail', 'Intentos SSH fallidos (24 h)', n > 2000 ? 'warn' : 'ok', `${n}${n > 2000 ? ' → ataque sostenido; confirma fail2ban y login solo con llave' : ''}`);
  }
  if (r.acceptedLogins) {
    const list = r.acceptedLogins.map((l) => `${l.user}@${l.ip} (${l.method})`);
    const viaPass = r.acceptedLogins.filter((l) => l.method === 'password');
    add('ssh-ok', 'Accesos SSH exitosos (24 h)', viaPass.length ? 'warn' : 'ok',
      list.length ? `${[...new Set(list)].slice(0, 6).join(', ')}${viaPass.length ? ' · hubo login con CONTRASEÑA' : ''}` : 'ninguno');
  }
  if (r.listening != null) {
    const allowed = new Set(r.allowedPublicPorts ?? [22]);
    const extra = publicPorts(r.listening).filter((p) => !allowed.has(p));
    add('ports', 'Puertos abiertos a internet', extra.length ? 'warn' : 'ok',
      extra.length ? `inesperados: ${extra.join(', ')} → ¿servicio nuevo? ciérralo en ufw o átalo a 127.0.0.1` : `solo los esperados (${[...allowed].join(', ')})`);
  }
  if (r.keysNow) {
    if (!r.keysBaseline) add('keys', 'Llaves SSH autorizadas', 'ok', `${r.keysNow.length} llave(s) — línea base registrada hoy`);
    else {
      const base = new Set(r.keysBaseline);
      const nuevas = r.keysNow.filter((k) => !base.has(k));
      const quitadas = r.keysBaseline.filter((k) => !r.keysNow!.includes(k));
      add('keys', 'Llaves SSH autorizadas', nuevas.length ? 'fail' : 'ok',
        nuevas.length
          ? `LLAVE NUEVA: ${nuevas.join(' | ')} → si no la agregaste tú, alguien tiene acceso. Si fuiste tú: consola → Salud → "Aceptar llaves"`
          : `${r.keysNow.length} llave(s), sin cambios${quitadas.length ? ` (se quitaron ${quitadas.length})` : ''}`);
    }
  }
  if (r.diskPct != null) add('disk', 'Disco', r.diskPct >= 90 ? 'fail' : r.diskPct >= 80 ? 'warn' : 'ok', `${r.diskPct}% usado${r.diskPct >= 80 ? ' → limpia /root/out o pm2 flush' : ''}`);
  if (r.securityUpdates != null) add('upd', 'Parches de seguridad pendientes', r.securityUpdates > 0 ? 'warn' : 'ok', r.securityUpdates > 0 ? `${r.securityUpdates} → apt upgrade (o activa unattended-upgrades)` : 'al día');
  if (r.unattended != null) add('unatt', 'Parches automáticos', r.unattended.trim() === 'enabled' ? 'ok' : 'warn', r.unattended.trim() === 'enabled' ? 'unattended-upgrades activo' : 'desactivados → apt install -y unattended-upgrades');
  if (r.rebootRequired) add('reboot', 'Reinicio pendiente', 'warn', 'un parche del kernel espera reinicio (pm2 vuelve solo con pm2 startup)');
  if (r.envMode != null) add('env', 'Permisos de placape.env', r.envMode === '600' || r.envMode === '400' ? 'ok' : 'fail', r.envMode === '600' || r.envMode === '400' ? r.envMode : `${r.envMode} → chmod 600 /root/placape.env (tiene las llaves)`);
  if (r.pm2Down) add('pm2', 'Procesos pm2', r.pm2Down.length ? 'fail' : 'ok', r.pm2Down.length ? `caídos: ${r.pm2Down.join(', ')}` : 'todos online');
  if (r.pm2RestartsDelta) {
    const loops = Object.entries(r.pm2RestartsDelta).filter(([, n]) => n >= 5);
    add('pm2-loop', 'Reinicios de pm2 (desde el último reporte)', loops.length ? 'warn' : 'ok',
      loops.length ? loops.map(([k, n]) => `${k}: ${n}`).join(', ') + ' → posible bucle de caídas (revisa pm2 logs)' : 'estables');
  }
  if (r.opsCalls24h != null) add('ops', 'Acceso de Claude (placape-ops, 24 h)', 'ok', `${r.opsCalls24h} comando(s) registrados en /var/log/placape-ops.log`);
  return out;
}

/** Extrae logins exitosos del journal de sshd. */
export function parseAccepted(journal: string): Array<{ user: string; ip: string; method: string }> {
  const out: Array<{ user: string; ip: string; method: string }> = [];
  for (const m of journal.matchAll(/Accepted (\w+) for (\S+) from (\S+)/g)) out.push({ method: m[1]!, user: m[2]!, ip: m[3]! });
  return out;
}
