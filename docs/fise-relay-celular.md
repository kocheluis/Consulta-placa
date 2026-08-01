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
   pkg install nodejs-lts
   curl -O https://raw.githubusercontent.com/kocheluis/Consulta-placa/main/tools/fise-relay-celular.mjs
   ```
3. Arrancar el worker (puerto **3011** — el listener público del relay — + el token del paso VPS-1):
   ```bash
   termux-wake-lock
   node fise-relay-celular.mjs http://IP-DEL-VPS:3011 EL_TOKEN
   ```
4. **Mantenerlo vivo**: Ajustes Android → Batería → Termux → *Sin restricciones* (excluir de la
   optimización). Celular enchufado. Ideal: un celular viejo dedicado, en el Wi-Fi de casa.

El worker imprime cada job que ejecuta. Si el VPS se cae o no hay red, reintenta solo cada 4s.

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
- FISE sale `relay residencial (celular) sin señal` en el reporte → el worker no está corriendo
  (o Android lo durmió: revisar wake-lock y optimización de batería).
- FISE sale `token v3 rechazado` → CapSolver devolvió un token de score bajo; el motor ya
  reintenta 1 vez con token fresco. Si persiste en todas las placas, revisar saldo CapSolver.
