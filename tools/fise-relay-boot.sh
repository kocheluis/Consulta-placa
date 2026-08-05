#!/data/data/com.termux/files/usr/bin/sh
# Supervisor del relay FISE para Termux/Android (PlacaPe). Mantiene el worker vivo pase lo que pase:
#   - toma el wake-lock (Android NO congela el proceso en Doze — la causa #1 de que "deje de latir")
#   - reinicia el worker si termina por cualquier motivo (crash, OOM, red que mató node)
#   - sirve para Termux:Boot → el relay vuelve solo cuando el celular se reinicia
#
# El fallo típico ("relay residencial (celular) sin señal") NO es un bug del scraper: es que el
# proceso del celular murió o el SO lo durmió. Este supervisor lo evita.
#
# ── Instalar para que arranque SOLO al encender el celular (una vez) ──────────────────────────────
#   1) Instala la app "Termux:Boot" (F-Droid) y ábrela UNA vez (así Android la habilita).
#   2) pkg install termux-api        # provee termux-wake-lock
#   3) mkdir -p ~/.termux/boot
#   4) cp fise-relay-boot.sh ~/.termux/boot/fise-relay-boot.sh
#   5) chmod +x ~/.termux/boot/fise-relay-boot.sh
#   6) Crea ~/.fise-relay.conf con dos líneas (o pásalos como args):
#         VPS_URL=http://IP-DEL-VPS:3011
#         TOKEN=el_valor_de_FISE_RELAY_TOKEN
#   7) Ajustes Android → Batería → Termux → "Sin restricciones" (excluir de la optimización).
#      Celular enchufado y con Wi-Fi que no se duerma. Ideal: un equipo viejo dedicado.
#
# ── Arrancar a mano (sin reiniciar, para probar) ──────────────────────────────────────────────────
#   sh fise-relay-boot.sh                       # lee ~/.fise-relay.conf
#   sh fise-relay-boot.sh http://IP:3011 TOKEN  # o con args

CONF="$HOME/.fise-relay.conf"
[ -f "$CONF" ] && . "$CONF"
VPS_URL="${1:-$VPS_URL}"
TOKEN="${2:-$TOKEN}"
SCRIPT="${FISE_RELAY_SCRIPT:-$HOME/fise-relay-celular.mjs}"
LOG="${FISE_RELAY_LOG:-$HOME/fise-relay.log}"

if [ -z "$VPS_URL" ] || [ -z "$TOKEN" ]; then
  echo "falta VPS_URL/TOKEN — pásalos como args o ponlos en $CONF" >&2
  exit 1
fi
if [ ! -f "$SCRIPT" ]; then
  echo "no encuentro el worker en $SCRIPT (descárgalo con curl, ver docs/fise-relay-celular.md)" >&2
  exit 1
fi

# Wake-lock (best-effort; requiere termux-api). Sin esto Android congela el proceso al apagar pantalla.
termux-wake-lock 2>/dev/null || true

echo "[$(date +%H:%M:%S)] supervisor FISE arrancado → $VPS_URL (log: $LOG)" | tee -a "$LOG"
while true; do
  node "$SCRIPT" "$VPS_URL" "$TOKEN" >> "$LOG" 2>&1
  code=$?
  if [ "$code" = "1" ]; then
    # El worker sale con 1 SOLO si el VPS rechazó el token (config mala): no tiene sentido un
    # bucle rápido — espera 60s por si estás corrigiendo el token en el VPS.
    echo "[$(date +%H:%M:%S)] worker salió (código 1 = ¿token rechazado?) — reintento en 60s" | tee -a "$LOG"
    sleep 60
  else
    echo "[$(date +%H:%M:%S)] worker terminó (código $code) — reinicio en 3s" | tee -a "$LOG"
    sleep 3
  fi
done
