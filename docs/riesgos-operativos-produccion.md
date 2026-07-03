# Riesgos operativos — fase de producción (PlacaPe)

> **Propósito:** registro vivo de riesgos para el pase a producción y la operación
> continua. Es un documento de **seguimiento**: actualiza el campo **Estado** y la fecha
> cada vez que un riesgo cambie. No borres riesgos cerrados — márcalos `CERRADO` con la
> fecha y cómo se resolvió (sirve de bitácora).
>
> **Última revisión:** 2026-06-28 · **Responsable por defecto:** Operador (José).

## Cómo leer la severidad

`Severidad = Probabilidad × Impacto`

| | Impacto Bajo | Impacto Medio | Impacto Alto | Impacto Crítico |
|---|---|---|---|---|
| **Prob. Alta** | Media | Alta | Crítica | Crítica |
| **Prob. Media** | Baja | Media | Alta | Crítica |
| **Prob. Baja** | Baja | Baja | Media | Alta |

- **Crítica** 🔴 = atender **antes** de cobrar el primer sol en serio.
- **Alta** 🟠 = atender en las primeras semanas de producción.
- **Media** 🟡 = plan a 1–3 meses.
- **Baja** ⚪ = monitorear.

Estados: `ABIERTO` · `MITIGADO` (parcial) · `CONTROLADO` (con plan vivo) · `CERRADO`.

---

## 1. Estado de infraestructura verificado (2026-06-28)

Hechos comprobados en el VPS `149.104.66.122` (LightNode Lima), base de los riesgos de infra:

| Punto | Estado real | Lectura |
|---|---|---|
| pm2 en boot | `pm2-root` **enabled** | ✅ resuelto (sobrevive reinicios) |
| RAM | **3.9 GB** + 3.9 GB swap | ✅ ampliado desde 2 GB |
| Disco | 50 GB, 30 % usado (15 GB) | ✅ holgado |
| Procesos pm2 | `xvfb` online, `operador` online (**8 restarts**), `superbid-delta` **STOPPED** | ⚠️ índice diario detenido; motor con historial de reinicios |
| Puertos públicos | 22, 80, 443; consola `3010` y CDP `9222/9224` **solo en 127.0.0.1** | ✅ superficie acotada; SSH abierto al mundo |
| Firewall host | **ufw inactivo** | ⚠️ sin firewall de host |
| Backups `/root/data` | solo 1 copia **manual** del 2026-06-26; **sin backup automático ni offsite** | 🔴 dato perecible sin respaldo |

---

## 2. Tablero de riesgos (resumen y seguimiento)

| ID | Riesgo | Categoría | Prob. | Impacto | Severidad | Estado |
|----|--------|-----------|-------|---------|-----------|--------|
| L-01 | Protección de datos personales (Ley 29733) — PII de terceros | Legal | Alta | Crítico | 🔴 Crítica | ABIERTO |
| L-02 | ToS de SUNARP: automatizar/revender SPRL y boletas | Legal | Media | Crítico | 🔴 Crítica | ABIERTO |
| L-03 | Responsabilidad por información errónea (decisión de compra) | Legal | Media | Crítico | 🔴 Crítica | ABIERTO |
| L-04 | Tributario/SUNAT: comprobantes de pago, RUC, Yape personal | Legal | Alta | Alto | 🟠 Alta | ABIERTO |
| L-05 | Consumidor/INDECOPI: libro de reclamaciones, publicidad, reembolsos | Legal | Media | Medio | 🟡 Media | ABIERTO |
| S-01 | Bloqueo de IP / Turnstile de SUNARP en el VPS único | Scraping | Media | Crítico | 🔴 Crítica | CONTROLADO |
| S-02 | Cuenta SPRL = punto único (ban / sesión única / saldo) — gap de creds RESUELTO | Scraping | Media | Crítico | 🔴 Crítica | MITIGADO |
| S-03 | Saldo CapSolver se agota → fuentes con captcha caen | Scraping | Alta | Alto | 🟠 Alta | ABIERTO |
| S-04 | Cambios de DOM/API/cifrado en los portales rompen scrapers | Scraping | Alta | Alto | 🟠 Alta | ABIERTO |
| S-05 | Índice Superbid (cron diario): verificar que dispare cada día | Scraping | Baja | Medio | ⚪ Baja | CONTROLADO |
| S-06 | Errores de OCR / datos de baja calidad (249 boletas sin texto) | Scraping | Media | Medio | 🟡 Media | ABIERTO |
| I-01 | VPS único = punto único de falla (sin redundancia) | Infra | Media | Crítico | 🔴 Crítica | ABIERTO |
| I-02 | Sin backup automático ni offsite de DB + boletas | Infra | Media | Crítico | 🔴 Crítica | ABIERTO |
| I-03 | Capacidad: 1 vCPU, ~3–5 min/reporte, SPRL serializa | Infra | Alta | Alto | 🟠 Alta | CONTROLADO |
| I-04 | Dependencia de Supabase (límites/pausa de plan, cuota) | Infra | Media | Alto | 🟠 Alta | ABIERTO |
| I-05 | Caddy/TLS/sslip.io para la consola; Basic Auth únicamente | Infra | Baja | Medio | ⚪ Baja | MITIGADO |
| P-01 | Confirmación manual de Yape no escala / depende del operador | Pagos | Alta | Alto | 🟠 Alta | ABIERTO |
| P-02 | Fraude de pago (captura Yape falsa / pago no verificable) | Pagos | Media | Alto | 🟠 Alta | ABIERTO |
| P-03 | Sin reembolso automático si el reporte falla tras el pago | Pagos | Media | Medio | 🟡 Media | ABIERTO |
| P-04 | Margen: costo por reporte (CapSolver + SPRL) erosiona ganancia | Pagos | Media | Medio | 🟡 Media | CONTROLADO |
| Q-01 | Falso positivo/negativo en el reporte (confianza del producto) | Calidad | Alta | Alto | 🟠 Alta | CONTROLADO |
| Q-02 | Datos en caché/obsoletos presentados como vigentes | Calidad | Media | Medio | 🟡 Media | MITIGADO |
| Q-03 | Reporte incompleto (una fuente cae) pero el cliente pagó "completo" | Calidad | Alta | Medio | 🟡 Media | ABIERTO |
| Q-04 | Falla de entrega (WhatsApp/correo) | Calidad | Media | Medio | 🟡 Media | ABIERTO |
| O-01 | Operador único (bus factor): vacaciones/enfermedad = caída | Operación | Media | Alto | 🟠 Alta | ABIERTO |
| O-02 | Sin monitoreo/alertas proactivas (caídas, cola, saldo, cron) | Operación | Alta | Alto | 🟠 Alta | ABIERTO |
| O-03 | Despliegue manual frágil (pull+build+restart; historial EADDRINUSE) | Operación | Media | Medio | 🟡 Media | MITIGADO |
| SEC-01 | Compromiso del VPS = todos los secretos + PII | Seguridad | Baja | Crítico | 🟠 Alta | ABIERTO |
| SEC-02 | Sin firewall de host (ufw); SSH abierto al mundo | Seguridad | Media | Medio | 🟡 Media | ABIERTO |
| SEC-03 | Fuga de `OPERATOR_PREVIEW_TOKEN` → reportes gratis sin candado | Seguridad | Baja | Medio | ⚪ Baja | MITIGADO |
| SEC-04 | Acceso al panel /admin/pagos (confirma pagos, ve PII) | Seguridad | Baja | Alto | 🟡 Media | MITIGADO |

---

## 3. Detalle de cada riesgo

> Formato: **Causa → Impacto → Mitigación → Disparador/Indicador → Estado**.

### L — Legal / Cumplimiento / Tributario

#### L-01 · Protección de datos personales (Ley N° 29733) 🔴
- **Causa:** los reportes y las boletas almacenadas contienen **PII de terceros** (nombre,
  dirección, DNI/CE del propietario, participantes de gravámenes). Se almacenan 6,559+
  boletas con nombre y dirección, y se **vende información sobre el vehículo/dueño de un
  tercero** a un comprador que no es el titular.
- **Matiz importante — "fuente accesible al público" (analizado 2026-06-28):** SUNARP está
  **calificada por ley como fuente accesible al público** → el Art. 14 de la Ley 29733
  **exime del CONSENTIMIENTO** del propietario. **Pero eso es lo único que exime.** El dato
  sigue siendo dato personal y, al **descargarlo, organizarlo, almacenarlo y revenderlo**,
  PlacaPe se vuelve **titular de un banco de datos personales** y queda sujeto a **todos los
  demás principios**. La ley es explícita: *"el tratamiento de los datos obtenidos a través
  de fuentes de acceso público deberá respetar los principios establecidos en la Ley."*
  Lo que **sigue obligando** pese a ser fuente pública:
  - **Finalidad:** SUNARP publica para *publicidad registral* (seguridad jurídica de la
    transacción); usarlo para un **producto comercial / perfilado** es un fin **distinto**
    → debe ser legítimo y declarado. La excepción cubre el consentimiento, **no** el cambio
    de finalidad.
  - **Proporcionalidad / minimización:** solo lo necesario (reforzado por el nuevo reglamento).
  - **Seguridad:** debes proteger TU base → conecta con [I-02] (sin backup) y [SEC-01/02];
    son también **incumplimiento del deber de seguridad**, no solo riesgo de infra.
  - **Calidad** (dato exacto/actualizado → conecta con [Q-01/Q-02]), **confidencialidad**,
    **derechos ARCO** y **notificación de brechas en 48 h** (DS 016-2024-JUS).
  - **Efecto mosaico:** cruzar SUNARP+SAT+Superbid+SBS crea un perfil que es **más** que
    cualquier dato público aislado — es lo que el regulador vigila.
  - Diferencia que mira la ley: **una consulta puntual** de un ciudadano (para eso existe la
    publicidad registral) ≠ **extracción + agregación + reventa a escala** (= tratamiento de
    banco de datos con todas las obligaciones).
- **Impacto:** sanciones de la **ANPD**; con el régimen vigente (DS 016-2024-JUS, en vigor
  desde 30-mar-2025) las faltas graves por falta de medidas de seguridad llegan a **100 UIT
  (~S/ 550,000 con la UIT 2026)**; orden de cese; daño reputacional. Riesgo legal de mayor severidad.
- **Mitigación:**
  - **Enmascarar la PII del tercero** en el reporte al comprador: mostrar el **estado del
    vehículo** (limpio/gravado, N° de dueños, siniestro) **sin** exponer nombre/DNI/dirección
    del propietario salvo lo indispensable. *(la mitigación más barata y de mayor impacto)*
  - Documentar la **finalidad legítima** del tratamiento y publicar **política de privacidad**.
  - **Retención por TTL** y borrado real (ya hay `REPORT_TTL_*`/`OWNER_RETENTION_DAYS` en `.env`).
  - Cerrar los deberes de **seguridad** (backup [I-02], firewall [SEC-02], usuario no-root [SEC-01]).
  - Canal de **derechos ARCO**; evaluar **inscripción del banco** y **DPO** al escalar;
    procedimiento de **notificación de brechas (48 h)**.
  - **Asesoría legal peruana** antes del lanzamiento comercial (confirma finalidad,
    inscripción/DPO y el alcance del enmascarado).
- **Indicador:** primer reclamo de un titular; consulta de la ANPD; incidente de seguridad.
- **Estado:** ABIERTO — **bloqueante para lanzamiento comercial**. (La condición de fuente
  pública **atenúa** vía consentimiento, pero **no cierra** el riesgo: queda abierto por
  finalidad, seguridad, minimización y ARCO.)

#### L-02 · ToS de SUNARP: automatizar y revender SPRL/boletas 🔴
- **Causa:** se usa una cuenta SPRL **de pago** para descargar boletas en masa y se
  automatiza el flujo (SPRL/Síguelo); revender ese contenido puede violar los términos de
  uso de SUNARP. Ya fue el motivo del pivote a "concierge".
- **Impacto:** **baneo de la cuenta SPRL** (mata el historial de propietarios), reclamo
  legal de SUNARP, fin de la fuente más valiosa.
- **Mitigación:** revisar los ToS vigentes; mantener **volumen bajo y humano en el medio**;
  no exponer públicamente que se automatiza; evaluar acuerdo/figura formal con SUNARP;
  preferir las fuentes públicas/gratuitas donde alcance; no revender el PDF de la boleta
  como documento oficial (dice "COPIA INFORMATIVA, sin validez").
- **Indicador:** captcha/Turnstile más estricto, bloqueos de la cuenta, avisos de SUNARP.
- **Estado:** ABIERTO.

#### L-03 · Responsabilidad por información errónea 🔴
- **Causa:** el comprador toma una **decisión de compra** con el reporte. Si decimos
  "limpio" y el auto tiene embargo/orden de captura (o al revés), hay daño económico.
  Riesgo real y demostrado: la data de SUNARP es **lagging** (el siniestro recién aparece
  tras la adjudicación; caso BZI234 limpio en SUNARP pero siniestrado en subasta), y la
  detección de anotaciones tiene matices (orden de captura aparece en notas de subasta,
  no en la sección registral).
- **Impacto:** demanda civil/consumidor, reembolsos, pérdida de confianza.
- **Mitigación:** **disclaimer claro** en cada reporte (ya existe `DISCLAIMER_TEXT`): fuente
  + fecha de cada dato, "informativo, no sustituye la verificación oficial". **Limitación
  de responsabilidad** en los Términos. Marcar explícitamente datos **faltantes/parciales**
  (UNKNOWN no penaliza). No fabricar veredictos. Banda de confianza por fuente.
- **Indicador:** reclamos por dato incorrecto; discrepancia reporte vs realidad.
- **Estado:** ABIERTO (principios de integridad ya en diseño → CONTROLADO en producto, pero
  falta el blindaje legal en T&C).

#### L-04 · Tributario / SUNAT 🟠
- **Causa:** cobro por reporte sin **comprobante de pago electrónico**; uso de **Yape
  personal** (930261260) para ingresos del negocio; RUC + Nuevo RUS pendientes de formalizar.
- **Impacto:** contingencia tributaria, multas SUNAT, el banco puede marcar el Yape personal
  por uso comercial.
- **Mitigación:** RUC + Nuevo RUS (~S/20/mes, ya planificado); migrar a **Yape negocio**
  o pasarela con comprobante; emitir boleta electrónica por venta; separar cuentas.
- **Indicador:** volumen de ingresos al Yape personal sube; primera fiscalización.
- **Estado:** ABIERTO.

#### L-05 · Protección al consumidor / INDECOPI 🟡
- **Causa:** venta a consumidores sin **Libro de Reclamaciones**, política de reembolso ni
  reglas de publicidad ("reporte completo", "todas las fuentes").
- **Impacto:** sanción INDECOPI, reclamos.
- **Mitigación:** Libro de Reclamaciones (físico/virtual obligatorio), precios y alcance
  claros, política de reembolso/repetición publicada, no prometer fuentes que a veces fallan.
- **Estado:** ABIERTO.

### S — Scraping / Fuentes de datos

#### S-01 · Bloqueo de IP / Turnstile de SUNARP en el VPS único 🔴
- **Causa:** SUNARP tiene **firewall geo (solo Perú)** + Turnstile. El VPS de Lima pasa hoy,
  pero si esa **IP única** se marca por volumen, **todo el scraping SUNARP cae** y no hay
  IP de respaldo (los proxies residenciales **censuran `.gob.pe`**).
- **Impacto:** caída total de SUNARP/SPRL/Síguelo = el núcleo del producto.
- **Mitigación:** throttle (no en ráfaga), perfil stealth persistente que reusa clearance,
  CapSolver como respaldo de captcha; **plan B de IP peruana** identificado (mini-PC
  residencial + Tailscale, o segundo VPS peruano en otro proveedor); tener el procedimiento
  de migración de IP listo.
- **Indicador:** Turnstile deja de pasar pasivo; `getDatosVehiculo` falla en cadena.
- **Estado:** CONTROLADO (funciona; falta el plan B de IP **ejecutable ya**).

#### S-02 · Cuenta SPRL = punto único de falla 🔴
- **Causa:** una sola cuenta SPRL de pago (sesión probablemente **única/no concurrente**),
  con **saldo** que se agota; el login automático puede romperse si SUNARP cambia el flujo.
- **Impacto:** sin historial de propietarios (la fuente diferencial); además **serializa**
  la concurrencia de reportes (no se pueden 2 historiales a la vez).
- **Mitigación:** monitorear saldo SPRL y recargar con alerta; validar si SPRL permite
  sesiones concurrentes (si no, **2.ª cuenta** para escalar); manejo robusto de expiración
  de sesión (ya hay re-login automático); degradar con elegancia si SPRL no responde.
- ✅ **RESUELTO (2026-06-30):** las credenciales SPRL estaban solo en `/root/sprl.env`, que el
  `operador` **no carga** → al expirar la sesión persistente, el re-login fallaba en prod
  ("no se pudo iniciar sesión en SPRL"). Movidas a `/root/placape.env` (sí lo carga el
  env-loader). Verificado: el historial vuelve a loguearse solo.
- **Indicador:** saldo bajo; fallos de login repetidos; reportes "colgados" en historial.
- **Estado:** MITIGADO (queda el punto único de cuenta/sesión, pero el re-login ya funciona).

#### S-03 · Saldo de CapSolver se agota 🟠
- **Causa:** cada reporte consume CapSolver (SAT/MTC/SBS/ATU/imagen). Saldo histórico ~US$6;
  sin recarga ni alerta automática → al llegar a 0, **todas las fuentes con captcha fallan**
  (`ERROR_KEY...`/sin saldo).
- **Impacto:** reportes parciales o fallidos pese al cobro.
- **Mitigación:** **alerta de saldo bajo** (chequear balance vía API y avisar); auto-recarga
  o tope mensual; preferir el camino gratis (Turnstile pasivo) donde aplique.
- **Indicador:** balance < umbral; aumento de errores de captcha.
- **Estado:** ABIERTO.

#### S-04 · Cambios en los portales rompen los scrapers 🟠
- **Causa:** SUNARP/SAT/MTC/SBS/ATU/Superbid cambian DOM, endpoints, sitekeys de reCAPTCHA
  o el **cifrado** (claves AES de SPRL/Síguelo están **hardcodeadas**). Rotan → rompe sin aviso.
- **Impacto:** una o varias fuentes caen silenciosamente; reportes degradados.
- **Mitigación:** **pruebas de humo** periódicas por fuente (placa de control, p. ej. VAS710,
  **nunca CHU444**) con alerta si una fuente deja de devolver datos; logs por fuente (ya
  existen); aislar las claves/sitekeys en config para cambiarlas rápido.
- **Indicador:** caída de la tasa de éxito de una fuente; cambios de versión del bundle.
- **Estado:** ABIERTO.

#### S-05 · Índice de Superbid — refresco diario ⚪ (corregido 2026-06-30)
- **Corrección:** NO estaba caído. `superbid-delta` es un **cron pm2 `0 6 * * *`** con
  `autorestart:false` → aparece "stopped" ENTRE corridas (normal). Verificado en vivo: corre
  y actualiza `meta.ultimo_scan_at` (último 2026-06-30T09:17Z, índice 6,561). Mi nota previa
  asumió mal que "stopped = caído".
- **Riesgo residual:** sutileza de pm2 — un cron con `autorestart:false` ya salido a veces no
  se vuelve a disparar. **Verificar que dispare a diario** (o pasar a systemd timer). Boletas
  perecibles ~1 mes → un par de días de atraso es tolerable.
- **Indicador:** `meta.ultimo_scan_at` con >48 h de antigüedad.
- **Estado:** CONTROLADO.

#### S-06 · Errores de OCR / datos de baja calidad 🟡
- **Causa:** la tarjeta de SUNARP llega como **imagen → OCR** (errores en VIN/serie). 249
  boletas quedaron **sin capa de texto** (flujo operador) y no son legibles por texto.
- **Impacto:** campos erróneos o faltantes en el reporte.
- **Mitigación:** post-proceso de OCR (VIN suele = serie → validar); reintentos; marcar el
  dato como "baja confianza" cuando el OCR no es claro; OCR de respaldo para las 249.
- **Estado:** ABIERTO.

### I — Infraestructura / Disponibilidad

#### I-01 · VPS único = punto único de falla 🔴
- **Causa:** **un solo** VPS (1 vCPU) corre motor + consola + índice + DB. Sin redundancia
  ni failover. Si el host cae, **todo el backend cae**.
- **Impacto:** caída total del servicio de generación de reportes.
- **Mitigación:** plan de **restauración rápida** (imagen/snapshot del VPS, infra como
  script reproducible); contemplar un segundo VPS peruano en standby; comunicar SLA realista.
- **Indicador:** caída del host; sin respuesta en `:443`/consola.
- **Estado:** ABIERTO.

#### I-02 · Sin backup automático ni offsite 🔴
- **Causa:** verificado — solo existe **una copia manual** de `placape.db` (2026-06-26). No
  hay backup programado ni offsite de `/root/data` (DB + **552 MB de boletas perecibles**).
  Falla de disco / borrado accidental = **pérdida total** del índice y la evidencia.
- **Impacto:** pérdida irrecuperable de boletas (no se pueden volver a bajar) e índice.
- **Mitigación:** **backup diario automatizado** de `placape.db` + `boletas/` a **object
  storage offsite** (S3/Backblaze/R2) con retención; snapshot del VPS; probar la restauración.
- **Indicador:** ausencia de backup reciente; alerta de disco.
- **Estado:** ABIERTO — **acción inmediata** (ya hay una copia local en esta PC como respaldo puntual).

#### I-03 · Capacidad / throughput 🟠
- **Causa:** 1 vCPU; reporte completo ~3–5 min (historial SPRL ~170–240 s domina); SPRL
  serializa (1 reporte a la vez). En picos de demanda la **cola se acumula**.
- **Impacto:** tiempos de entrega largos; clientes esperando; timeouts.
- **Mitigación:** mantener concurrencia = 1 (ya por defecto); **ampliar vCPU** para acelerar;
  fijar y comunicar un **tiempo de entrega** (p. ej. "en minutos"); optimizar el flujo SPRL.
- **Indicador:** profundidad de cola creciente; `pendiente` acumulados en Supabase.
- **Estado:** CONTROLADO (RAM ya a 4 GB; falta vCPU para escalar).

#### I-04 · Dependencia de Supabase 🟠
- **Causa:** cola + tabla `reportes` + auth + cuentas viven en Supabase. Límites/pausa del
  plan gratuito, cuotas o caída del servicio detienen el loop.
- **Impacto:** no se encolan pedidos ni se publican reportes; login caído.
- **Mitigación:** monitorear cuotas; plan pago cuando haya ventas; el adaptador de cola es
  **intercambiable** (SQLite local como fallback) — tener el procedimiento de switch.
- **Estado:** ABIERTO.

#### I-05 · Consola del operador (Caddy/TLS/sslip.io + Basic Auth) ⚪
- **Causa:** la consola se expone vía `sslip.io` con Basic Auth; depende de Let's Encrypt y
  del servicio sslip.io.
- **Impacto:** consola inaccesible (no afecta al cliente final, sí a la operación).
- **Mitigación:** dominio propio `ops.placape.pe` listo en el Caddyfile; credenciales fuertes;
  considerar IP allowlist. Puertos sensibles ya en localhost.
- **Estado:** MITIGADO.

### P — Pagos / Ingresos / Fraude

#### P-01 · Confirmación manual de Yape no escala 🟠
- **Causa:** el admin confirma **a mano** cada pago en `/admin/pagos`. Depende de la
  disponibilidad del operador; introduce demora y error humano.
- **Impacto:** clientes esperan la confirmación; cuello de botella; mala experiencia nocturna.
- **Mitigación:** integrar **IziPay** (en curso) para confirmación automática; mientras
  tanto, notificación inmediata de pago pendiente y SLA de confirmación; considerar Yape
  con API/negocio.
- **Estado:** ABIERTO.

#### P-02 · Fraude de pago 🟠
- **Causa:** el cliente puede enviar una **captura de Yape falsa** o decir que pagó sin
  hacerlo; la confirmación manual no verifica la transacción real.
- **Impacto:** reportes entregados sin cobro; pérdida.
- **Mitigación:** verificar contra el **historial real de Yape** antes de confirmar; pasarela
  con webhook (IziPay) elimina la captura manual; monto/код de referencia por pedido.
- **Estado:** ABIERTO.

#### P-03 · Sin reembolso automático ante reporte fallido 🟡
- **Causa:** si el motor falla **después** del pago (fuente caída, timeout), no hay flujo de
  reembolso ni de re-proceso garantizado.
- **Impacto:** cliente paga y no recibe valor → reclamo.
- **Mitigación:** política de **re-proceso/credito** automática; detectar reporte parcial y
  ofrecer repetición o reembolso; el botón "re-generar" ya existe en la consola.
- **Estado:** ABIERTO.

#### P-04 · Margen por costo de reporte 🟡
- **Causa:** cada reporte cuesta CapSolver + (eventual) S/ del SPRL; si el precio no cubre
  costos a volumen, el margen se erosiona.
- **Impacto:** unit economics negativos en algunos reportes.
- **Mitigación:** preferir caminos gratis (Turnstile pasivo, Síguelo); medir costo real por
  reporte; ajustar precio/niveles; cachear lo cacheable por TTL.
- **Estado:** CONTROLADO (camino feliz es casi gratis; vigilar al escalar).

### Q — Calidad del producto / Confianza

#### Q-01 · Falso positivo/negativo en el reporte 🟠
- **Causa:** datos lagging, OCR, detección de anotaciones con matices, fuentes que difieren.
- **Impacto:** pérdida de confianza, reclamos (ligado a L-03).
- **Mitigación:** mostrar **fuente + fecha** por dato; no inventar veredictos; revisar reglas
  de detección (separar afectación registral vs nota de subasta, como se corrigió hoy); QA
  con placas de control.
- **Estado:** CONTROLADO (principios de integridad en diseño; mejora continua).

#### Q-02 · Datos en caché presentados como vigentes 🟡
- **Causa:** TTLs de caché (registral 7 d, seguros/siniestralidad 24 h); un dato viejo puede
  mostrarse como actual.
- **Mitigación:** etiquetar siempre **"obtenido el …"**; respetar TTLs; refrescar bajo demanda.
- **Estado:** MITIGADO (el diseño ya marca fecha por dato).

#### Q-03 · Reporte incompleto pero cobrado como "completo" 🟡
- **Causa:** una fuente cae y el reporte sale parcial; el cliente pagó esperando todo.
- **Mitigación:** definir qué es "completo aceptable"; marcar secciones faltantes; re-proceso
  o crédito; no cobrar tier que no se pudo cumplir.
- **Estado:** ABIERTO.

#### Q-04 · Falla de entrega (WhatsApp/correo) 🟡
- **Causa:** Resend pendiente de conectar; WhatsApp Business API con onboarding manual;
  correos a spam.
- **Mitigación:** conectar Resend + dominio verificado (SPF/DKIM); fallback `wa.me`/link web;
  confirmar entrega y reintentar.
- **Estado:** ABIERTO.

### O — Operación / Personas / Proceso

#### O-01 · Operador único (bus factor) 🟠
- **Causa:** una sola persona opera, monitorea y confirma pagos.
- **Impacto:** vacaciones/enfermedad/imprevisto = servicio degradado o caído.
- **Mitigación:** automatizar lo confirmable (pagos, alertas); documentar runbooks (ya hay
  `vps-operador.md`); un segundo contacto con acceso de emergencia.
- **Estado:** ABIERTO.

#### O-02 · Sin monitoreo/alertas proactivas 🟠
- **Causa:** no hay alertas de caída del VPS, profundidad de cola, saldo CapSolver/SPRL,
  cron de índice detenido, expiración de sesión SPRL. (El `superbid-delta` lleva días
  detenido sin que nadie se entere — evidencia del riesgo.)
- **Impacto:** fallas silenciosas; se descubren por el cliente.
- **Mitigación:** healthcheck del VPS + endpoint `/health`; alertas (Telegram/WhatsApp/correo)
  para: host caído, cola > N, saldo bajo, fuente con 0 % de éxito, cron sin correr en 24 h.
- **Estado:** ABIERTO.

#### O-03 · Despliegue manual frágil 🟡
- **Causa:** pull + build `@app/shared` + `pm2 restart` + re-correr placa; historial de
  divergencia de git y de crash-loop **EADDRINUSE**.
- **Mitigación:** runbook `vps-operador.md` (existe) con recuperación de divergencia y
  reinicio limpio; apagado ordenado ya implementado; idealmente un script de deploy único.
- **Estado:** MITIGADO.

### SEC — Seguridad

#### SEC-01 · Compromiso del VPS = todos los secretos + PII 🟠
- **Causa:** `/root/placape.env` tiene SPRL, `service_role` de Supabase (salta RLS) y
  CapSolver; el disco tiene la DB + boletas con PII; Chrome corre como **root** con
  `--no-sandbox`.
- **Impacto:** fuga masiva de PII (Ley 29733) + control de Supabase + cuentas.
- **Mitigación:** endurecer SSH (solo llave — ya), `ufw` (ver SEC-02), usuario no-root para
  el motor, rotación de secretos, mínimos privilegios, actualizaciones del SO; aislar el
  navegador.
- **Estado:** ABIERTO.

#### SEC-02 · Sin firewall de host; SSH abierto al mundo 🟡
- **Causa:** `ufw` inactivo (verificado). Puertos 22/80/443 expuestos (CDP/consola ya en
  localhost, bien). SSH al mundo → fuerza bruta (mitigado por llave).
- **Mitigación:** activar `ufw` (permitir 22/80/443, denegar el resto), `fail2ban`,
  deshabilitar password-auth en SSH, considerar puerto SSH no estándar / allowlist.
- **Estado:** ABIERTO.

#### SEC-03 · Fuga de `OPERATOR_PREVIEW_TOKEN` ⚪
- **Causa:** ese token salta el candado de pago Y el enmascarado de PII (`/api/reporte/[placa]?preview=`).
  Riesgo real = **fuga por logs** (viaja en la URL → queda en access-logs de Vercel/CDN, historial del
  navegador, header `Referer`), no fuerza bruta. Es un secreto **estático y compartido** sin expiración.
- **Hallazgo 3-jul-2026:** el valor desplegado era `op_123456789` (placeholder trivial, adivinable) →
  la "mitigación" no estaba realmente aplicada. Rotado a un aleatorio fuerte (192 bits).
- **Mitigación (reforzada):** (1) la consola del operador ya **NO usa el preview por defecto** — renderiza
  el reporte de forma **nativa desde el `reporte.json` del VPS** (loopback + SSH, sin token ni Vercel); el
  iframe web quedó **opt-in**, así que en uso normal el token no se ejercita. (2) Token fuerte, server-only
  (Vercel + `/root/placape.env`), rotable. **Mejora futura opcional:** reemplazar el token estático por
  **enlaces firmados con expiración** (HMAC de placa+vencimiento) o por **auth de operador** (sesión admin),
  para eliminar el secreto de bearer estático de la URL.
- **Estado:** MITIGADO (reforzado; el preview salió del camino crítico).

#### SEC-04 · Acceso al panel /admin/pagos 🟡
- **Causa:** confirma pagos y ve PII; gateado por `ADMIN_EMAILS` + Supabase Auth.
- **Mitigación:** correo admin con 2FA; lista mínima de admins; auditoría de confirmaciones.
- **Estado:** MITIGADO.

---

## 4. Acciones inmediatas sugeridas (antes/al iniciar producción)

Orden por severidad y esfuerzo:

1. **S-05 / O-02:** reactivar `superbid-delta` y poner una **alerta** si el cron no corre. *(rápido)*
2. **I-02:** backup **diario automatizado y offsite** de `placape.db` + `boletas/`. *(rápido)*
3. **SEC-02:** activar `ufw` + `fail2ban` + SSH solo-llave. *(rápido)*
4. **S-03 / S-02:** alertas de **saldo** CapSolver y SPRL. *(rápido)*
5. **L-04:** formalizar RUC/Nuevo RUS + comprobante + separar el Yape personal. *(legal)*
6. **L-01 / L-03 / L-05:** política de privacidad, Términos con limitación de responsabilidad,
   Libro de Reclamaciones, minimización/enmascarado de PII de terceros. *(legal — bloqueante)*
7. **P-01/P-02:** completar IziPay (o Yape verificado) para cerrar el fraude y la confirmación manual.
8. **S-01 / I-01:** dejar **escrito y probado** el plan B de IP peruana y la restauración del VPS.

> Mantener esta tabla viva: al cerrar una acción, mover el riesgo a `MITIGADO`/`CONTROLADO`
> con fecha y nota. Revisar el tablero al menos **mensualmente** y tras cada incidente.
