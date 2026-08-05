# FISE por relay residencial (celular) — guía del operador

## Por qué existe

El portal FISE (`fise.minem.gob.pe:23308`) **no es alcanzable desde el VPS** — doble bloqueo
probado con Chrome real (31-jul-2026):

1. El **MINEM filtra IPs datacenter**: el VPS ni recibe respuesta (`ERR_CONNECTION_TIMED_OUT`,
   SYN descartado).
2. El **proxy residencial (iProyal) rechaza el CONNECT** a puertos no estándar como `:23308`,
   por HTTP y por SOCKS5 (`ERR_TUNNEL_CONNECTION_FAILED` en <1s).

Desde una **IP residencial peruana** (casa / datos móviles) el portal carga al instante
(validado desde la PC y el celular del operador). El relay usa esa IP: un worker en el celular
hace **polling saliente** al VPS (funciona detrás de CGNAT — el celular nunca acepta conexiones
entrantes), ejecuta la consulta y devuelve el JSON. El captcha (reCAPTCHA v3) lo resuelve el
**VPS** con CapSolver: al celular no viaja ningún secreto aparte del token del relay.

```
Motor (VPS)                                Celular (Termux)
───────────                                ────────────────
placa GNV → token v3 (CapSolver)           GET /api/fise-relay/next?token=…  (cada 4s)
→ encola job, espera ≤45s          ←────── recibe {id, plate, captchaToken}
                                           GET inicio + POST buscarSaldo (IP residencial)
← parsea montos y publica          ←────── POST /api/fise-relay/result {id, bodyText}
```

Si el celular no da señales de vida (>2 min sin poll), la fuente FISE **falla al instante** con
un mensaje claro — el reporte no se cuelga ni pierde tiempo. Cuando el worker vuelve, FISE se
reactiva solo (sin reiniciar nada).

## Setup — VPS (una vez)

1. Generar un token y guardarlo en `/root/placape.env`:
   ```bash
   echo "FISE_RELAY_TOKEN=$(openssl rand -hex 16)" >> /root/placape.env
   grep FISE_RELAY_TOKEN /root/placape.env   # cópialo para el celular
   ```
2. Reiniciar el motor: `pm2 restart operador`
3. Verificar: `curl -s http://localhost:3010/api/fise-relay/status`
   → `{"enabled":true,"alive":false,...}` (alive pasa a `true` cuando el celular haga su primer poll).

Sin `FISE_RELAY_TOKEN` los endpoints del relay quedan **deshabilitados** (403 siempre).

**Puertos:** la consola (`:3010`) bindea a **loopback** (sin login; se entra por túnel SSH) y NO se
toca. Con `FISE_RELAY_TOKEN` configurado, el motor abre un **listener público aparte** en
`0.0.0.0:3011` (`FISE_RELAY_PORT`) que sirve **únicamente** `/api/fise-relay/*` con token — a eso
apunta el celular. Verificar que escucha: `ss -tlnp | grep 3011`. Si el proveedor del VPS
(LightNode) o `ufw` filtran puertos entrantes, abrir el 3011/tcp.

## Setup — Celular (Android + Termux, una vez)

1. Instalar **Termux** (F-Droid recomendado; la versión de Play está desactualizada).
2. En Termux:
   ```bash
   pkg install nodejs-lts termux-api
   curl -O https://raw.githubusercontent.com/kocheluis/Consulta-placa/main/tools/fise-relay-celular.mjs
   curl -O https://raw.githubusercontent.com/kocheluis/Consulta-placa/main/tools/fise-relay-boot.sh
   ```
3. Prueba rápida a mano (puerto **3011** — el listener público del relay — + el token del paso VPS-1):
   ```bash
   node fise-relay-celular.mjs http://IP-DEL-VPS:3011 EL_TOKEN   # debe imprimir "worker FISE encendido"
   ```

### Mantenerlo vivo DE VERDAD (obligatorio — si no, se cae)

El worker en sí es robusto (reintenta la red para siempre). Lo que lo tumba es **el sistema
operativo**: Android congela el proceso en *Doze* o lo mata por batería, y al reiniciar el celular no
vuelve solo. Por eso el `RESULTADO ERROR · relay residencial (celular) sin señal` NO es un bug del
scraper — es el proceso del celular que murió. Blíndalo con las tres capas:

1. **Wake-lock + auto-reinicio (supervisor `fise-relay-boot.sh`)** — reinicia el worker si se cae y
   toma el wake-lock:
   ```bash
   printf 'VPS_URL=http://IP-DEL-VPS:3011\nTOKEN=EL_TOKEN\n' > ~/.fise-relay.conf
   sh fise-relay-boot.sh        # déjalo corriendo; log en ~/fise-relay.log
   ```
2. **Termux:Boot (sobrevive reinicios del celular)** — instala la app *Termux:Boot* (F-Droid), ábrela
   una vez, y deja el supervisor como script de arranque:
   ```bash
   mkdir -p ~/.termux/boot && cp fise-relay-boot.sh ~/.termux/boot/ && chmod +x ~/.termux/boot/fise-relay-boot.sh
   ```
3. **Batería**: Ajustes Android → Batería → Termux → *Sin restricciones*. Celular enchufado y con
   Wi-Fi que no se duerma. Ideal: un equipo viejo dedicado.

El worker deja un latido `sigo vivo (polling OK, sin trabajos)` cada ~5 min en el log: si el log dejó
de crecer, el SO lo durmió → revisa wake-lock y batería.

### Redundancia (recomendado): un 2º poller en la PC

La cola del VPS acepta **varios pollers a la vez** (el que pide primero se lleva el job). Corre el
MISMO worker también en la PC del operador (IP residencial, Node ≥ 18) como respaldo: si el celular
muere, la PC cubre las consultas sin que FISE falle.
```bash
node fise-relay-celular.mjs http://IP-DEL-VPS:3011 EL_TOKEN
```

## Knobs (env del VPS)

| Variable | Default | Qué hace |
|---|---|---|
| `FISE_RELAY_TOKEN` | *(vacío = relay OFF)* | Token compartido VPS↔celular. |
| `FISE_RELAY_PORT` | `3011` | Puerto del listener público (solo `/api/fise-relay/*`). |
| `FISE_RELAY_TIMEOUT_MS` | `45000` | Tope de espera por job (VPS). |
| `FISE_RELAY_ALIVE_MS` | `120000` | Ventana del heartbeat: sin poll en este lapso → celular "caído". |
| `FISE_CHAIN_FALLBACK` | *(off)* | `1` = volver a la vieja cadena de egresos headless (hoy inútil). |

## Diagnóstico

- `GET /api/fise-relay/status` → `{enabled, alive, lastSeenAgoS, pending, inFlight, served, done}`.
- Worker dice `token RECHAZADO` → el token no coincide con `FISE_RELAY_TOKEN` del VPS.
- FISE sale `relay residencial (celular) sin señal` en el reporte → el worker no está corriendo (el
  SO lo mató/durmió o el celular reinició). Fix permanente: correrlo bajo `fise-relay-boot.sh`
  (wake-lock + auto-reinicio) y con Termux:Boot; revisar la exclusión de batería. Ver arriba
  "Mantenerlo vivo DE VERDAD". `curl -s http://localhost:3010/api/fise-relay/status` muestra
  `alive` y `lastSeenAgoS` para confirmar desde el VPS.
- FISE sale `token v3 rechazado` → CapSolver devolvió un token de score bajo; el motor ya
  reintenta 1 vez con token fresco. Si persiste en todas las placas, revisar saldo CapSolver.
