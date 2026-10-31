#!/data/data/com.termux/files/usr/bin/sh
# Instalador del relay FISE para el celular (Termux/Android) — PlacaPe. Un solo comando:
#
#   curl -fsSL https://raw.githubusercontent.com/kocheluis/Consulta-placa/main/tools/fise-relay-setup.sh | sh -s -- http://IP-DEL-VPS:3011 TOKEN
#
# Qué hace (se puede correr de nuevo cuantas veces quieras; reemplaza la instalación anterior):
#   1. instala node + termux-api
#   2. descarga la última versión del worker y del supervisor desde GitHub (main)
#   3. guarda VPS_URL/TOKEN en ~/.fise-relay.conf (solo lectura para ti)
#   4. deja el arranque automático para Termux:Boot (vuelve solo tras reiniciar el celular)
#   5. detiene cualquier relay viejo (p. ej. apuntando a otro VPS) y arranca el nuevo en segundo plano
#   6. prueba que esta red alcance FISE y que el VPS vea latir al celular
set -e
VPS_URL="${1:-}"
TOKEN="${2:-}"
RAW=https://raw.githubusercontent.com/kocheluis/Consulta-placa/main/tools
if [ -z "$VPS_URL" ] || [ -z "$TOKEN" ]; then
  echo "Uso: sh fise-relay-setup.sh http://IP-DEL-VPS:3011 TOKEN" >&2
  exit 1
fi
VPS_URL=$(echo "$VPS_URL" | sed 's:/*$::')

echo "== 1/6 actualizando Termux y paquetes (node, termux-api)… (puede tardar unos minutos)"
# ACTUALIZACIÓN COMPLETA primero: un `pkg install` suelto puede subir libcurl sin subir openssl y deja
# curl roto ("CANNOT LINK EXECUTABLE curl: cannot locate symbol SSL_…", visto 31-oct).
export DEBIAN_FRONTEND=noninteractive
yes | pkg upgrade -y -o Dpkg::Options::=--force-confnew >/dev/null 2>&1 || yes | pkg upgrade -y
yes | pkg install -y nodejs-lts termux-api curl openssl >/dev/null 2>&1 || pkg install -y nodejs-lts termux-api curl openssl
curl --version >/dev/null 2>&1 || { echo "curl sigue roto tras actualizar: corre 'pkg upgrade' a mano y vuelve a intentar" >&2; exit 1; }

echo "== 2/6 descargando worker y supervisor…"
curl -fsSL "$RAW/fise-relay-celular.mjs" -o "$HOME/fise-relay-celular.mjs"
curl -fsSL "$RAW/fise-relay-boot.sh" -o "$HOME/fise-relay-boot.sh"
chmod +x "$HOME/fise-relay-boot.sh"

echo "== 3/6 configuración → ~/.fise-relay.conf"
umask 077
printf 'VPS_URL=%s\nTOKEN=%s\n' "$VPS_URL" "$TOKEN" > "$HOME/.fise-relay.conf"
umask 022

echo "== 4/6 arranque automático (Termux:Boot)…"
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/fise-relay" <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
nohup sh "$HOME/fise-relay-boot.sh" >/dev/null 2>&1 &
EOF
chmod +x "$HOME/.termux/boot/fise-relay"
rm -f "$HOME/.termux/boot/fise-relay-boot.sh"   # instalación vieja (bloqueaba el arranque)

echo "== 5/6 deteniendo relays viejos y arrancando el nuevo…"
pkill -f fise-relay-boot.sh 2>/dev/null || true
pkill -f fise-relay-celular.mjs 2>/dev/null || true
sleep 1
termux-wake-lock 2>/dev/null || true
: > "$HOME/fise-relay.log"
nohup sh "$HOME/fise-relay-boot.sh" >/dev/null 2>&1 &

echo "== 6/6 pruebas"
echo "-- ¿esta red alcanza FISE?"
node "$HOME/fise-relay-celular.mjs" test || true
echo "-- ¿el VPS ve latir al celular? (espero 10 s)"
sleep 10
STATUS=$(curl -s -m 10 "$VPS_URL/api/fise-relay/status" || true)
echo "   VPS: ${STATUS:-sin respuesta}"
echo "-- log del worker:"
tail -n 5 "$HOME/fise-relay.log"
case "$STATUS" in
  *'"alive":true'*) echo; echo "✅ LISTO: el VPS ve al celular. Deja Termux abierto en segundo plano." ;;
  *) echo; echo "⚠ El VPS aún no ve al celular. Revisa el log (tail -f ~/fise-relay.log): 'token RECHAZADO' = token mal copiado; 'VPS inalcanzable' = IP/puerto mal o sin internet." ;;
esac
cat <<'EOF'

Para que NO se caiga (una sola vez en el celular):
  • Instala la app "Termux:Boot" desde F-Droid y ábrela una vez.
  • Instala la app "Termux:API" desde F-Droid (para el wake-lock).
  • Ajustes → Batería → Termux (y Termux:Boot) → "Sin restricciones".
  • Celular enchufado y con Wi-Fi o datos encendidos.
Ver el log en vivo:  tail -f ~/fise-relay.log      Detener:  pkill -f fise-relay
EOF
