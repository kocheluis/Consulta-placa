# Pagos — IziPay (pago por reporte)

**Feature:** `001-consulta-placa-vehicular` · **Actualizado:** junio 2026

Scaffolding del cobro. Modelo: **pago por reporte** — cada compra desbloquea UN
reporte (placa) a nivel **PRO/ULTRA** para un usuario. Hoy opera en **modo mock**
(aprobación inmediata) hasta tener cuenta IziPay; el código real ya está cableado
detrás de las variables de entorno.

## Piezas
- **Tabla `purchases`** — [`supabase/migrations/0002_purchases.sql`](../../supabase/migrations/0002_purchases.sql):
  `user_id, plate, tier, amount, status (pending|paid|failed), provider_ref, paid_at`.
  RLS: el usuario **lee** sus compras; INSERT/UPDATE solo por `service_role`.
- **Cliente admin** [`lib/supabase/admin.ts`](../../apps/web/lib/supabase/admin.ts) — `service_role`, server-only, salta RLS.
- **Abstracción IziPay** [`lib/izipay.ts`](../../apps/web/lib/izipay.ts) — `createPaymentSession` + `verifyWebhookSignature` (HMAC-SHA256). Mock si faltan llaves.
- **Lógica** [`lib/payments.ts`](../../apps/web/lib/payments.ts) — `createPendingPurchase`, `markPurchasePaid/Failed`, `getPaidTier(plate)`.
- **Route handlers** (Vercel):
  - `POST /api/checkout` — crea la compra pending + abre la sesión de pago.
  - `POST /api/webhooks/izipay` — IPN: verifica firma → marca pagada/fallida.

## Flujo
```
Checkout (UI) → POST /api/checkout
  → crea purchase 'pending' (service_role)
  → IziPay.createPaymentSession
      · mock  → status 'paid' → markPurchasePaid → reporte desbloqueado
      · real  → redirige a IziPay → (usuario paga) → IziPay llama al webhook
                → POST /api/webhooks/izipay → verifica firma → markPurchasePaid
```
El reporte consulta `getPaidTier(plate)` para saber el nivel desbloqueado (BASIC si
no hay compra pagada). El **tier de un reporte se concede solo por una compra pagada**,
verificada server-side — el cliente nunca puede auto-otorgárselo.

## Puesta en marcha (cuando haya cuenta)
1. Correr `0002_purchases.sql` en el SQL Editor de Supabase.
2. Envs **server-only** (local en `.env.local`, en Vercel sin `NEXT_PUBLIC_`):
   - `SUPABASE_SERVICE_ROLE_KEY` = secret key de Supabase (`sb_secret_...`).
   - `IZIPAY_SHOP_ID`, `IZIPAY_SECRET_KEY` = back-office IziPay/Lyra.
3. En IziPay configurar la **URL de notificación (IPN)**:
   `https://placape.vercel.app/api/webhooks/izipay`.
4. Completar `createPaymentSession` (formToken de IziPay) en `lib/izipay.ts`.

## Probar el webhook en mock
```
curl -X POST https://placape.vercel.app/api/webhooks/izipay \
  -H 'kr-hash: mock' -H 'content-type: application/json' \
  -d '{"orderId":"<uuid-de-una-purchase>","orderStatus":"PAID","transactionId":"t1"}'
```

## Pendiente
- Wirear el checkout de `/planes` (hoy vista previa) a `POST /api/checkout` desde un
  reporte real con sesión iniciada.
- Packs por volumen (créditos para empresas) — extender `purchases` con `credits`.
- Completar la integración real de IziPay (formToken + firma del IPN).
