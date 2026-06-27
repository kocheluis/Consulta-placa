# Runbook — Motor del operador en el VPS

Procedimiento para **desplegar cambios y reiniciar el motor** que corre los scrapers
y publica los reportes a Supabase. Este motor vive en el **VPS** (IP residencial/Perú),
no en Vercel ni en la PC de desarrollo.

> Cuando Claude diga "haz el deploy / reinicia el operador en el VPS", sigue la
> sección **"Deploy + reinicio"**.

---

## Acceso

- Conéctate por **SSH** al VPS (usuario `root`).
- El panel del operador está **bindeado a `127.0.0.1`** (no expuesto). Para abrirlo en
  tu navegador, usa un túnel SSH:
  ```
  ssh -L 8090:127.0.0.1:8090 root@TU_VPS
  ```
  (ajusta el puerto al que use `operator-server`) y abre `http://127.0.0.1:8090`.

## Procesos pm2 en el VPS

| id | name | qué es | estado normal |
|----|------|--------|----------------|
| 1 | **operador** | el motor (`tsx packages/scrapers/src/operator-server.ts`): consume la cola `pedidos` de Supabase y publica reportes | **online** |
| 2 | **superbid-delta** | job de escaneo incremental del índice de subastas (Superbid) | stopped salvo cuando corre el scan |
| 0 | **xvfb** | framebuffer X virtual para el Chrome headless (CDP) | **online** |

Ver estado: `pm2 list` · Logs del motor: `pm2 logs operador`

---

## Deploy + reinicio (tras un `git push`)

Pega **línea por línea** (sin comentarios, sin `<...>` — bash interpreta `<` como
redirección y falla con *"syntax error near unexpected token newline"*).

**1. Ubica la raíz del repo** (solo la primera vez; anótala):
```
find ~ -name operator-server.ts -path '*scrapers*' 2>/dev/null
```
La raíz es lo que va antes de `/packages`. **En este VPS es `/root/app`** (confirmado 2026-06-27).

**2. Deploy + reinicio:**
```
cd /root/app
git pull origin main
npm run build -w @app/shared
pm2 restart operador
pm2 logs operador --lines 30
```

### Por qué cada paso
- `git pull origin main` → baja el último commit.
- **`npm run build -w @app/shared` → CRÍTICO.** El motor importa `@app/shared` desde
  `dist/` (compilado), no desde el código fuente. Si no recompilas, usa los tipos
  viejos y rompe lo nuevo (p. ej. `SectionKind.HISTORIAL` quedaría `undefined`).
- `pm2 restart operador` → reinicia el motor con el código nuevo.
- `pm2 logs operador` → confirma que arrancó y quedó esperando pedidos (Ctrl+C para salir).

### Notas
- **No** hace falta `npm install` salvo que el commit cambie dependencias
  (`package-lock.json`). Si las cambia: `npm install` antes del build.
- **No** hace falta compilar `packages/scrapers`: corre con `tsx` desde el fuente.
- El `.env` del VPS **no se versiona**; si `git pull` se queja por cambios locales en
  `.env`, es normal (no lo toques). El cargador de env del operador prioriza el archivo
  `.env` sobre las variables de pm2.

---

## Re-generar una placa

Tras reiniciar, vuelve a generar el reporte de una placa para que se republique con el
código nuevo (los reportes cacheados en Supabase **no** se regeneran solos):

- Desde el **panel del operador** (túnel SSH), o
- Encolando un pedido en la cola `pedidos` de Supabase como lo hagas habitualmente.

El job automático corre estas fuentes (`AUTO_SOURCES` en `operator-server.ts`, override
por env `AUTO_SOURCES`):
`sunarp, historial, superbid, sat-captura, sat-papeletas, callao-papeletas, mtc-citv, sbs-soat, atu`.

---

## Escaneo del índice de subastas (opcional)

Para refrescar el índice Superbid/VMC (señal de siniestro/remate) que consulta el motor:
```
cd /root/app/packages/scrapers
npm run superbid:scan -- --delta
npm run vmc:scan
```
(El proceso pm2 `superbid-delta` automatiza el `--delta` de Superbid.)

---

## El repo del VPS está divergido (git pull abortado)

Si `git pull` aborta con *"Your local changes would be overwritten"* y/o *"untracked
working tree files would be overwritten"*, el VPS tiene ediciones locales y/o archivos
sin trackear que chocan con el repo. **No hagas `git reset --hard` ni `git stash` a
ciegas:** el VPS puede tener cambios locales legítimos (binding/proxy/puerto, secretos)
que se perderían y dejarían la consola inaccesible.

> **Caso real (2026-06-27):** el VPS estaba en la rama `feat/operador-historial-superbid`
> con el contenido de `main` puesto como cambios sin commitear. La consola se sirve por
> reverse proxy → `127.0.0.1:3010` (el código bindea a loopback; **no** hay edición de
> binding en el VPS). Solución abajo ("Pasar el VPS a `main`").

**1. Inspecciona primero (no destructivo):**
```
cd /root/app
git status
git diff -- packages/scrapers/src/operator-server.ts
git diff --stat
```

**Pasar el VPS a `main` (respaldando primero):**
```
cd /root/app
cp -a /root/app /root/app.bak.$(date +%F-%H%M)
git fetch origin
git checkout -f -B main origin/main
npm install
npm run build -w @app/shared
pm2 restart operador
pm2 logs operador --lines 30
```
`-f` descarta los cambios locales de trabajo (que eran copia de `main`) y `-B main
origin/main` deja la rama `main` exacta al remoto. El respaldo `/root/app.bak.*` guarda
TODO por si algo era único. El `.env` (gitignored) no se toca. Archivos sueltos no
versionados (p. ej. `cdp-test.mjs`) se conservan.
Revisa especialmente `operator-server.ts` (puerto, `127.0.0.1` vs `0.0.0.0`, exposición).
Si hay cambios locales que importan, pásaselos a Claude para incorporarlos al repo
antes de sobrescribir.

**2. Respalda los cambios locales (tracked + untracked) por si acaso:**
```
git stash push -u -m "vps-local-respaldo"
```
Si el stash falla por algún untracked en conflicto, muévelo a mano:
```
mkdir -p /root/vps-backup && git stash show -u 2>/dev/null
# o copia manual de los archivos en conflicto a /root/vps-backup/ antes del pull
```

**3. Trae el repo y despliega:**
```
git pull origin main
npm run build -w @app/shared
pm2 restart operador
```

**4. (Opcional) Reaplica solo lo necesario** del stash si había un cambio local válido:
`git stash show -p stash@{0}` para verlo; normalmente el repo es la fuente de verdad y
NO se reaplica.

> Causa raíz: en algún momento se editaron archivos directamente en el VPS o se copiaron
> sin pasar por git. Para evitar que vuelva a pasar, todo cambio debe hacerse en el repo
> (local) → commit/push → `git pull` en el VPS. No editar archivos del proyecto en el VPS
> (salvo `.env`, que no se versiona).

## Problemas comunes

- **`git pull` aborta por cambios locales/untracked** → ver "El repo del VPS está
  divergido" arriba. No descartes a ciegas.
- **`EADDRINUSE: address already in use :::3010`** → el proceso viejo no soltó el puerto
  antes de que arranque el nuevo. Desde el commit con apagado ordenado (SIGINT/SIGTERM
  cierran el server y matan Chrome), `pm2 restart operador` debería bastar. Si vienes de
  una instancia colgada que aún ocupa el puerto, haz un reinicio LIMPIO:
  ```
  pm2 stop operador
  sleep 2
  ss -ltnp | grep 3010        # ¿sigue ocupado? mata al intruso:
  fuser -k 3010/tcp           # (o: kill <PID de ss>)
  pm2 start operador
  ss -ltnp | grep 3010        # debe quedar UN solo listener (el de pm2)
  ```

- **"syntax error near unexpected token newline"** → pegaste un `<nombre>`/`<...>` o un
  comentario con caracteres especiales. Usa el nombre literal `operador`.
- **"cd: /ruta/al/repo: No such file or directory"** → pegaste un placeholder; usa la
  ruta real (paso 1).
- **El reporte no muestra lo nuevo** → casi siempre faltó `npm run build -w @app/shared`,
  o no se re-generó la placa después del reinicio.
- **Chrome/CDP no abre** → revisa que `xvfb` esté `online` (`pm2 restart xvfb`).
- **El motor no toma pedidos** → revisa `pm2 logs operador`; valida que el `.env` tenga
  `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (broker) y `CAPTCHA_API_KEY` (CapSolver).
