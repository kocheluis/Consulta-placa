---
name: revision-vps
description: Revisión, depuración y seguridad del VPS de PlacaPe a través del acceso CONTROLADO (ssh placape-vps → placape-ops). Úsala cuando pidan revisar el VPS, por qué falló una fuente o un reporte de cliente, desplegar al VPS, o la revisión diaria. Argumento opcional "diagnostico" (solo lectura, sin deploy) o una PLACA a investigar.
---

# Revisión del VPS (motor de PlacaPe)

Acceso: `ssh placape-vps <comando>` entra como `claude-ops` y SOLO ejecuta la lista blanca de
`placape-ops` (código en `ops/vps/placape-ops`; `ssh placape-vps help` la lista). No hay shell.
Todo queda en `/var/log/placape-ops.log` y el reporte diario lo cuenta. Plan completo:
`docs/seguridad/plan-operacion-seguridad.md` (privado, gitignoreado).

## Reglas (no negociables)
- **Nunca** pedir, imprimir ni copiar valores de `placape.env` (llaves Supabase/Resend/CapSolver, SPRL,
  DNI). `env-keys` muestra solo nombres; `env-set` solo acepta perillas no secretas. Si falta un
  secreto, decírselo al dueño con el nombre exacto de la variable.
- El repo es **público**: nada de IPs, DNI, correos o placas de clientes en commits ni en docs versionadas.
- Ley 29733: en resúmenes al dueño, contacto de clientes siempre enmascarado (ya viene así en `alerts`).
- Cambios de código: SIEMPRE en el repo local → tests (`npx vitest run` desde la raíz) + `tsc --noEmit`
  → commit → push a `main` y a la rama de trabajo → recién `ssh placape-vps deploy`. Nunca editar código
  en el VPS (no se puede: no hay shell, y así debe ser).
- Tras `deploy`: verificar `status` (todo `online`, sin reinicios en bucle). Si algo cae → `rollback`
  de inmediato y avisar.
- Modo `diagnostico` (o corrida programada sin el dueño): solo lectura. Nada de deploy, env-set,
  restart ni enqueue; entregar hallazgos + arreglo propuesto.
- `ssh placape-vps-root` solo existe si el dueño abrió una ventana de root temporal; usarla solo para
  lo que placape-ops no cubre, decir qué se hizo, y nunca para leer placape.env.

## Procedimiento
1. **Panorama**: `status` · `health` · `alerts`. Anotar: procesos caídos o reiniciando, fuentes
   CAÍDAS/intermitentes, clientes con reporte en error o sin reporte, avisos de seguridad.
2. **Clientes primero**: por cada entrega con problema en `alerts`, ¿la fuente sigue fallando?
   (`report <PLACA>`). Si un cliente PAGADO quedó sin reporte → prioridad 1 (reintentar desde la
   consola o `enqueue`, y avisar al dueño para contactar al cliente).
3. **Por cada fuente rota**, distinguir la causa antes de tocar código:
   - `src-log <PLACA> <fuente>` y `grep operador <fuente> 3000`: mensaje real.
   - `probe <url del portal>`: ¿responde a la IP del VPS? (403/timeout = bloqueo de IP o portal caído;
     comparar con un curl desde la PC para separar ambos).
   - Dependencias: fise-gnv/infogas-gnv dependen de historial (combustible); satt-papeletas del DNI del
     historial (o SATT_DNI). Arreglar la raíz, no el síntoma.
   - Errores en 0.0s = falta binario/config (Chromium de Playwright, env). Timeouts largos = sesión
     SPRL, bloqueo o portal lento. HTTP 5xx del propio portal = caído (no es nuestro).
4. **Seguridad** (`health` muestra la sección; `audit` el crudo): llaves SSH nuevas no reconocidas =
   INCIDENTE (avisar ya, no tocar nada); puertos públicos inesperados; login con contraseña; parches
   pendientes; permisos de placape.env; disco.
5. **Arreglar** (fuera de modo diagnóstico): código → tests → commit/push → `deploy` → `status` →
   prueba con una placa testigo (`enqueue <PLACA> PRO`, luego `report <PLACA>`) o `health-run`.
6. **Informe al dueño** (en español, breve): qué estaba mal, a quién afectó (clientes/pagados),
   qué se arregló (commit), qué queda pendiente y qué necesita de él (secretos, decisiones).
