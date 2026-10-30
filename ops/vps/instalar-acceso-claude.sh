#!/usr/bin/env bash
# Acceso CONTROLADO de Claude al VPS. Correr como root desde /root/app:
#
#   bash ops/vps/instalar-acceso-claude.sh instalar 'ssh-ed25519 AAAA… claude-vps-access'
#   bash ops/vps/instalar-acceso-claude.sh root-temporal 'ssh-ed25519 AAAA… claude-vps-access' 2   # root por 2 h
#   bash ops/vps/instalar-acceso-claude.sh revocar      # quita TODO acceso de Claude (usuario + root temporal)
#   bash ops/vps/instalar-acceso-claude.sh estado
#
# Qué crea `instalar`:
#  - usuario `claude-ops` SIN contraseña y SIN shell interactiva: su llave tiene `restrict` (sin túneles,
#    sin reenvío, sin pty) y `command=` forzado → solo puede ejecutar /usr/local/sbin/placape-ops
#    (lista blanca de subcomandos, ver `placape-ops help`).
#  - sudoers: claude-ops puede correr SOLO placape-ops como root (validado con visudo).
#  - auditoría: cada comando va a /var/log/placape-ops.log (+ syslog) y el reporte diario lo cuenta.
#  - endurecimiento base que no arriesga tu acceso: fail2ban + parches automáticos de seguridad.
#    NO desactiva el login con contraseña (te dejaría fuera si aún entras con clave): el reporte diario
#    te avisa y el plan dice cuándo hacerlo.
# `root-temporal` agrega la llave a root con `expiry-time` (OpenSSH ≥ 8.2): caduca sola a las N horas.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "correr como root" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
U=claude-ops
SUDOERS=/etc/sudoers.d/placape-ops
LOG=/var/log/placape-ops.log

valid_key() { [[ "$1" =~ ^(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa)\ [A-Za-z0-9+/=]{60,}(\ [A-Za-z0-9._@-]{1,60})?$ ]]; }
accept_keys() { curl -s -m 20 -X POST "http://127.0.0.1:${OPERATOR_PORT:-3010}/api/health/accept-keys" >/dev/null 2>&1 || true; }

case "${1:-}" in
  instalar)
    key="${2:-}"; valid_key "$key" || { echo "llave pública inválida (pásala entre comillas simples)" >&2; exit 1; }
    install -o root -g root -m 0755 "$HERE/placape-ops" /usr/local/sbin/placape-ops
    install -o root -g root -m 0755 "$HERE/placape-ops-ssh" /usr/local/sbin/placape-ops-ssh
    id "$U" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash --comment 'Claude (acceso controlado)' "$U"
    passwd -l "$U" >/dev/null
    install -d -o "$U" -g "$U" -m 0700 "/home/$U/.ssh"
    printf 'restrict,command="/usr/local/sbin/placape-ops-ssh" %s\n' "$key" > "/home/$U/.ssh/authorized_keys"
    chown "$U:$U" "/home/$U/.ssh/authorized_keys"; chmod 0600 "/home/$U/.ssh/authorized_keys"
    tmp=$(mktemp)
    printf 'Defaults:%s !requiretty\n%s ALL=(root) NOPASSWD: /usr/local/sbin/placape-ops\n' "$U" "$U" > "$tmp"
    visudo -cf "$tmp" >/dev/null && install -o root -g root -m 0440 "$tmp" "$SUDOERS"; rm -f "$tmp"
    touch "$LOG"; chmod 0640 "$LOG"
    cat > /etc/logrotate.d/placape-ops <<EOF
$LOG {
  monthly
  rotate 12
  compress
  missingok
  notifempty
}
EOF
    # Si sshd restringe usuarios (AllowUsers), claude-ops debe estar en la lista.
    if sshd -T 2>/dev/null | grep -qi '^allowusers '; then
      echo "AVISO: sshd tiene AllowUsers → agrega '$U' en /etc/ssh/sshd_config y: systemctl reload ssh"
    fi
    export DEBIAN_FRONTEND=noninteractive
    apt-get install -y -qq fail2ban unattended-upgrades >/dev/null 2>&1 || echo "aviso: no pude instalar fail2ban/unattended-upgrades"
    systemctl enable --now fail2ban >/dev/null 2>&1 || true
    echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20auto-upgrades
    accept_keys
    echo "✓ Acceso controlado instalado. Claude entra como '$U' y solo puede ejecutar 'placape-ops'."
    echo "  Prueba desde la PC:  ssh placape-vps status"
    echo "  Ver lo que hizo:     tail -f $LOG"
    echo "  Revocar:             bash $0 revocar"
    ;;
  root-temporal)
    key="${2:-}"; hrs="${3:-2}"
    valid_key "$key" || { echo "llave pública inválida" >&2; exit 1; }
    [[ "$hrs" =~ ^[0-9]{1,2}$ && "$hrs" -ge 1 && "$hrs" -le 24 ]] || { echo "horas: 1..24" >&2; exit 1; }
    exp=$(date -u -d "+$hrs hours" +%Y%m%d%H%M)
    mkdir -p /root/.ssh; chmod 700 /root/.ssh
    sed -i '/claude-root-temporal$/d' /root/.ssh/authorized_keys 2>/dev/null || true
    body=$(echo "$key" | awk '{print $1" "$2}')
    printf 'expiry-time="%sZ",no-port-forwarding,no-agent-forwarding,no-X11-forwarding %s claude-root-temporal\n' "$exp" "$body" >> /root/.ssh/authorized_keys
    chmod 600 /root/.ssh/authorized_keys
    printf '%s user=root args=root-temporal %sh (vence %sZ)\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$hrs" "$exp" >> "$LOG"
    echo "✓ Root temporal para Claude hasta ${exp}Z (UTC). Caduca sola; el reporte diario la mostrará como llave nueva."
    ;;
  revocar)
    sed -i '/claude-root-temporal$/d' /root/.ssh/authorized_keys 2>/dev/null || true
    rm -f "$SUDOERS"
    if id "$U" >/dev/null 2>&1; then pkill -u "$U" 2>/dev/null || true; userdel -r "$U" 2>/dev/null || true; fi
    accept_keys
    printf '%s user=root args=revocar\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOG"
    echo "✓ Acceso de Claude revocado (usuario $U, sudoers y root temporal)."
    ;;
  estado)
    id "$U" >/dev/null 2>&1 && echo "usuario $U: existe" || echo "usuario $U: no existe"
    [[ -f "$SUDOERS" ]] && echo "sudoers: $(tail -1 "$SUDOERS")" || echo "sudoers: no"
    grep -c 'claude-root-temporal$' /root/.ssh/authorized_keys 2>/dev/null | sed 's/^/root temporal (líneas): /' || true
    [[ -f "$LOG" ]] && { echo "últimos comandos:"; tail -5 "$LOG"; }
    ;;
  *)
    sed -n '2,20p' "$0"; exit 1
    ;;
esac
