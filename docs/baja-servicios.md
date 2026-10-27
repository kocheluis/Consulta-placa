# Mapa de servicios, pagos y BAJA del proyecto (teardown)

Registro de TODOS los servicios externos de PlacaPe: para qué sirve cada uno, si tiene método de
pago registrado, y cómo darlo de baja. Mantener al día **cada vez que se contrata o se registra una
tarjeta en algo nuevo**.

> ⚠️ Repo PÚBLICO: aquí NO van números de tarjeta, correos de cuenta ni credenciales. Los campos
> "(completar)" se llenan en el gestor de contraseñas del dueño, no en este archivo.

## Inventario de servicios

| # | Servicio | Para qué | Plan / costo | 💳 ¿Pago registrado? | Baja: qué hacer |
|---|---|---|---|---|---|
| 1 | **VPS (LightNode)** | Motor del operador (pm2: operador/xvfb/sprl-keepalive), consola, relay FISE | prepago por crédito | Sí — crédito recargable (completar tarjeta usada) | Respaldar `/root/placape.env` y `/root/out` si interesa → destruir instancia → **retirar/borrar la tarjeta del panel** → cerrar cuenta |
| 2 | **Cloudflare** | DNS de placape.pe · Email Routing (admin@→Gmail) · **Zero Trust Free** (login consola) · **Tunnel** (consola.placape.pe) | $0 (Free) | **Sí — tarjeta registrada para Zero Trust Free (oct-2026)** | Borrar Access app + Tunnel → downgrade/salir de Zero Trust → **quitar la tarjeta en Billing** → (el DNS se migra con el dominio) |
| 3 | **Vercel** | Hosting de la web (apps/web) + env vars de producción | Hobby $0 (confirmar si Pro) | (completar — Pro requiere tarjeta) | Borrar el proyecto → desvincular dominio → quitar tarjeta si hay |
| 4 | **Supabase** | Auth + Postgres: `pedidos`, `reportes`, `purchases`, `profiles`, `consulta_hits`, `bot_users` | Free (confirmar si Pro $25) | (completar) | **ANTES de borrar: dump de la BD** (datos de clientes/compras — obligación tributaria/contable) → borrar proyecto → quitar tarjeta |
| 5 | **CapSolver** | Captchas del scraping (~S/0.025/reporte) | prepago por saldo | Sí — recargas (completar método) | Gastar/abandonar saldo (no reembolsan) → borrar tarjeta guardada → cerrar cuenta |
| 6 | **Resend** | Correo transaccional (entrega de reportes, OTP del bot) | Free 3k/mes | (completar — solo si se subió de plan) | Borrar API keys y dominio verificado → cerrar cuenta |
| 7 | **Dominios: placape.pe / .com** | Marca + web + correo | renovación anual | Sí — renovación anual (completar registrador .pe y tarjeta) | Decidir: dejar vencer o vender; si vence, ANTES migrar/cerrar el correo admin@ |
| 8 | **API de IA (OPENAI_API_KEY)** | Análisis IA del reporte ULTRA | por consumo | Sí — (completar proveedor: OpenAI/Anthropic y tarjeta) | Revocar API key → quitar tarjeta → cerrar facturación |
| 9 | **iProyal** (proxy residencial) | Egress de ATU/otros (si sigue en uso) | prepago | (completar — ¿saldo/tarjeta activa?) | Borrar tarjeta guardada → cerrar cuenta |
| 10 | **2Captcha** (legado, migrado a CapSolver) | — ya no se usa | prepago | (confirmar si quedó tarjeta/saldo) | Cerrar cuenta y borrar tarjeta si sigue registrada |
| 11 | **Zoho Mail** | Buzón soporte@placape.pe (reply-to) | Free (confirmar) | (completar) | Exportar correos → cerrar buzón antes de soltar el dominio |
| 12 | **Meta WhatsApp Business** (bot, pendiente de activar) | Canal del bot n8n | $0 + plantillas por mensaje | ⚠️ Al activarlo pedirá tarjeta para plantillas — **anotar aquí cuando pase** | Borrar número/WABA → quitar método de pago en Business Manager |
| 13 | **n8n** (pendiente: self-host $0 o Cloud ~$24/mes) | Orquestación del bot | — | ⚠️ Solo si se elige n8n Cloud — anotar | Cancelar suscripción / apagar contenedor |
| 14 | **GitHub** | Código (repo público) | $0 | No | Archivar o privatizar el repo |
| 15 | **Cuentas SPRL (SUNARP)** | Historial registral — saldo PREPAGO (no tarjeta) | recargas de saldo | No (se recarga manual) | Gastar el saldo restante; no hay tarjeta que quitar |
| 16 | **Yape / Izipay** (cobro a clientes) | Recepción de pagos | comisión por venta | No es tarjeta nuestra; Izipay tiene contrato (si se llegó a firmar) | Confirmar compras pendientes → cerrar contrato Izipay si existe; Yape personal no requiere baja |

## Orden de apagado recomendado (si se da de baja el proyecto)

1. **Dejar de vender**: desactivar checkout/cupo en la web (o banner de cierre) y el bot.
2. **Atender lo pagado**: entregar reportes pendientes de `pedidos` y reembolsar `purchases` en estado `pending`.
3. **Respaldar**: dump de Supabase (clientes/compras — conservar por obligaciones tributarias), export de correos, `/root/placape.env` a un lugar seguro.
4. **Apagar el motor**: `pm2 delete all` → destruir el VPS → borrar tarjeta del proveedor.
5. **Apagar la web**: borrar proyecto en Vercel.
6. **Cerrar servicios de consumo**: CapSolver, IA, iProyal, Resend, 2Captcha — revocar keys y **borrar tarjetas**.
7. **Cloudflare**: borrar Tunnel + Access + Zero Trust, quitar tarjeta; Email Routing al final.
8. **Dominios al último** (sostienen correo y redirecciones mientras se cierra todo).
9. **Repasar esta tabla completa**: cada fila con 💳 debe terminar en "tarjeta eliminada" ✓.

## Regla de mantenimiento

Cada vez que un chat/sesión agregue un servicio nuevo o registre un pago, **agregar la fila aquí en
el mismo commit**. Este archivo es el checklist maestro; los datos sensibles van al gestor de
contraseñas con el mismo numeral (#1–#16) para cruzarlos rápido.
