# PlacaPe · Bot de WhatsApp (n8n) — Fase 0

Bot de WhatsApp que **dispara el motor** y **entrega el reporte**, reusando toda la lógica que ya vive
en la web (`apps/web/lib`). n8n solo **orquesta**; nunca habla directo con Supabase ni reimplementa
cupo/pago/paywall.

```
WhatsApp  ──►  n8n (01 inbound)  ──►  POST /api/bot/consulta  ──►  Supabase `pedidos`
 usuario                                                              │
                                                                      ▼
                                                                 VPS motor (pm2)
                                                                 · genera el reporte
                                                                 · publica en `reportes`
 WhatsApp  ◄──  n8n (02 entrega)  ◄── N8N_WEBHOOK_URL ◄────────── · avisa "listo"
   (resumen)         │
                     └── GET /api/bot/reporte?placa=&phone= (resumen + recorte por nivel)
```

## Alcance de la Fase 0

- **Número VINCULADO** a una cuenta con cupo → consume su cupo y genera **PRO/ULTRA**.
- **Número SIN vincular** → genera **BASIC gratis** (el cobro Yape/IziPay y el OTP de vinculación son Fase 1).
- Entrega automática por WhatsApp al quedar el reporte listo (el VPS ya postea a `N8N_WEBHOOK_URL`).

## Variables de entorno

| Dónde | Variable | Valor |
|---|---|---|
| **Web (Vercel)** | `BOT_API_TOKEN` | secreto largo aleatorio; auth de `/api/bot/*` |
| **n8n** | `BOT_API_TOKEN` | **el mismo** valor que en la web |
| **n8n** | `PLACAPE_WEB_URL` | `https://placape.pe` (base de la web) |
| **n8n** | `WHATSAPP_PHONE_ID` | Phone Number ID de tu WhatsApp Business Cloud |
| **VPS** (`/root/placape.env`) | `N8N_WEBHOOK_URL` | URL del webhook del workflow **02** (`https://<n8n>/webhook/placape-listo`) |

> Genera el token: `openssl rand -hex 32`. `BOT_API_TOKEN` debe ser idéntico en la web y en n8n.
> Si n8n bloquea `$env` en nodos, define estos valores como credenciales o como constantes del workflow.

## Contrato de la API (ya probado del lado servidor)

### `POST /api/bot/consulta`
Header `x-bot-token: <BOT_API_TOKEN>` · Body `{ "phone": "51987654321", "placa": "ABC123" }`

Respuesta:
```jsonc
{ "ok": true, "status": "queued", "placa": "ABC123", "tier": "PRO", "remaining": { "hour": 4, "day": 19, "week": 99 } }
// status: queued | generating | ready | exists | cupo_exceeded | invalid
// cupo_exceeded añade: "window": "hora|día|semana", "resetInMin": 37
```

### `GET /api/bot/reporte?placa=ABC123&phone=51987654321`
Header `x-bot-token: <BOT_API_TOKEN>` · `phone` es opcional (recorta el reporte al nivel que ese número
tiene derecho a ver; sin `phone` → BASIC).

Respuesta cuando está listo:
```jsonc
{
  "ok": true, "generating": false, "status": "ready", "tier": "PRO", "plateNotFound": false,
  "url": "https://placape.pe/reporte/ABC123",
  "score": { "overall": 82, "level": "GOOD", "letter": "B" },
  "vehicle": { "brand": "KIA", "model": "CERATO", "year": 2013, "color": "GRIS CARBON" },
  "text": "🚗 *ABC123* — KIA CERATO 2013 · GRIS CARBON\n\n*Score: 82/100* 🟢 Riesgo bajo\n\n• ...\n\n📄 Reporte completo: https://…"
}
// status: ready | generating | not_found | not_registered (placa inexistente en SUNARP)
```
Manda `text` tal cual por WhatsApp (ya viene con *negritas* de WA y con los terceros enmascarados).

## Payload que el VPS postea a `N8N_WEBHOOK_URL` (para el workflow 02)
```jsonc
{ "plate": "ABC123", "whatsapp": "51987654321", "email": "...", "results": [...], "at": "..." }
```

## Puesta en marcha

1. **Migración**: corre `supabase/migrations/0010_bot_users.sql` en el SQL Editor de Supabase.
2. **Token**: define `BOT_API_TOKEN` en Vercel (web) y en n8n (mismo valor). Redeploy de la web.
3. **WhatsApp Business Cloud** en n8n: crea la credencial (App de Meta + Phone Number ID + token) y
   configura el webhook de verificación que te pide el nodo *WhatsApp Trigger*.
4. **Importa** los dos workflows (`01-inbound-consulta.json`, `02-entrega-reporte.json`), revisa que
   los nodos de WhatsApp usen tu credencial y activa ambos.
5. **VPS**: pon `N8N_WEBHOOK_URL=https://<n8n>/webhook/placape-listo` en `/root/placape.env` y
   `pm2 restart operador`.

## Probar (Fase 0)

- **Con cupo** (PRO/ULTRA): vincula tu número a una cuenta con cupo (ver el pie de `0010_bot_users.sql`):
  ```sql
  insert into public.bot_users (phone, user_id, email, verified)
  select '51987654321', id, email, true from auth.users where email = 'tucorreo@ejemplo.com'
  on conflict (phone) do update set user_id = excluded.user_id, verified = true, updated_at = now();
  ```
  Escribe al bot `consulta ABC123` → responde "generando" → al terminar te llega el resumen PRO/ULTRA.
- **Sin vincular**: desde otro número, `consulta ABC123` → genera BASIC gratis y te llega el resumen BASIC.

## Nota
Los `.json` son un **esqueleto**: las versiones de nodo (`typeVersion`) pueden variar según tu n8n y
quizá debas re-seleccionar la credencial de WhatsApp en cada nodo. El contrato HTTP de arriba es la
fuente de verdad — si un nodo no importa limpio, reconstrúyelo con esos datos.
