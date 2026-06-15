# Estado actual y cambios de alcance — PlacaPe

**Feature:** `001-consulta-placa-vehicular` · **Actualizado:** junio 2026

Este documento es la **fuente de verdad del estado vigente** del proyecto. Los demás
specs (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `design-system.md`,
`contracts/api.md`, `quickstart.md`) describen el diseño original; donde discrepen con
este documento, **manda este documento**.

> El proyecto nació como "ConsultaPlaca / Consulta Vehicular" (consulta gratis, guiada,
> sin cuentas, API Fastify + Prisma + Redis). Desde entonces giró hacia un **producto
> con marca, niveles de pago, cuentas y reporte automático**. Aquí están los virajes.

---

## 1. Marca

- **Nombre:** **PlacaPe** (antes ConsultaPlaca / Consulta Vehicular).
- **Dominios:** `placape.pe` (héroe, comprado en punto.pe, propagación/configuración
  pendiente) + `placape.com`. Producción temporal en **`placape.vercel.app`**.
- **Identidad:** wordmark "placa**pe**" (azul + teal), logos en `apps/web/public/brand/`,
  favicons/OG recoloreados. Ver `design-system.md` (reescrito a la marca PlacaPe).

## 2. Modelo de producto — 3 niveles (antes: único reporte gratis)

| Nivel | Precio | Qué incluye |
|------|--------|-------------|
| **BASIC** | Gratis | Identidad del vehículo, semáforo de riesgo, N° de propietarios. |
| **PRO** | **S/ 15.90** / reporte | Reporte completo de ~10 fuentes + PDF (SOAT, papeletas, RT, siniestralidad, captura, propietarios). |
| **ULTRA** | **S/ 19.90** / reporte | Todo PRO + gravámenes, multas electorales (ONPE), odómetro, **valorización de mercado** y **análisis con IA**. |

- **Packs por volumen (Empresas/concesionarias):** 10 / 25 / 50 reportes, Pro hasta
  S/ 9.90 c/u, Ultra hasta S/ 12.90 c/u; vigencia 12 meses. (Precios de lanzamiento.)
- **Score 0–100** determinista (función pura, **no IA**): general + por concepto
  (legal / seguros / deudas / uso), letra A–F. Señal crítica (robo) fuerza veredicto
  malo. Dato faltante = UNKNOWN (no penaliza). Implementado en `packages/shared/src/score.ts`.
- **IA solo en ULTRA** (recomendación + valor de compra). Fuentes de precio objetivo:
  Neoauto, Mercado Libre Perú, Autocosmos, Facebook Marketplace.

## 3. Cuentas, autenticación y base de datos — **Supabase** (antes: JWT propio en Fastify)

- **Supabase Auth + Postgres** para login/cuentas. Integrado en `apps/web` con un patrón
  de **fachada** (`lib/account.ts`): usa Supabase si hay envs, si no cae al backend de
  prueba (`lib/auth.ts`). Detalle y pasos en `SUPABASE.md` (raíz) y `[[consulta-placa-auth-db]]`.
- **Esquema:** `supabase/migrations/0001_init.sql` → tabla `profiles` (1:1 con
  `auth.users`) con **`tier` BASIC/PRO/ULTRA**, RLS, trigger de perfil automático y
  guardia para que el `tier` solo lo cambie el `service_role` (nadie se auto-otorga PRO/ULTRA).
- **Confirmación de correo:** flujo SSR `app/auth/confirm` → `app/auth/confirmado`, con
  template de correo de marca (`supabase/templates/confirm-signup.html`). **Envío de
  correos pendiente de conectar SMTP propio (Zoho)**; mientras tanto "Confirm email"
  desactivado para pruebas.
- **Nota de arquitectura:** Vercel hostea **solo la web**. La DB y la auth viven en
  Supabase; la **API Fastify + worker** (Playwright/BullMQ) irán en **Render/Fly**
  (procesos largos, no serverless). El modelo `profiles`/tier se definió en **SQL directo
  en Supabase**, no en Prisma (el `data-model.md` original asume Prisma).

## 4. Pagos — por reporte, billeteras locales (antes: producto gratis, sin pagos)

- **Modelo:** pago **por reporte** (sin suscripción). Pasarela **IziPay** + **Yape/Plin**.
- **Estado:** pantalla de checkout construida como **vista previa** (`/planes`): avisa que
  la pasarela está **en integración** y **no procesa cobros reales**; sin QR escaneable ni
  número Yape pagable (integridad). Webhook de pago → subirá el `tier` vía `service_role`.
- Tributación: RUC + Nuevo RUS (~S/20/mes) — ver `[[consulta-placa-monetizacion]]`.

## 5. Resolución de CAPTCHA — **Cloudflare Turnstile** (antes: CAPTCHA de imagen)

- SUNARP usa **Cloudflare Turnstile** (confirmado), no CAPTCHA de imagen.
- Cliente de solver **intercambiable**: `local` (OCR, NO resuelve Turnstile) →
  **CapSolver** (producción) → 2Captcha (alterno). Método `solveTurnstile(sitekey, url)`
  en `packages/scrapers/src/captcha/*`. Scraper SUNARP reescrito al flujo Turnstile.
  Probablemente requiera proxies residenciales. **Pendiente verificación en vivo con clave CapSolver.**

## 6. Fuentes de datos — cambios

- **Agregadas:** **ATU** (taxi/transporte Lima-Callao, `TRANSPORTE`), **SUTRAN
  cinemómetro** (papeletas por exceso de velocidad en carreteras, `PAPELETAS`).
- **Quitada:** SAT Ica "orden de captura" (backend roto).
- **Multas electorales (ONPE):** son **por DNI** (no por placa, no se heredan). Se diseñan
  como módulo opcional de "verificación del vendedor" dentro de PRO/ULTRA (consentido),
  no se jalan automáticamente.
- **Enlaces guiados ocultos:** los botones a portales oficiales se mantienen **en
  background** (server-side), no visibles para el usuario final. Catálogo en
  `packages/shared/src/links.ts`.

## 7. Diseño — design system PlacaPe implementado (antes: navy/sky institucional)

- Se aplicó un design system completo (handoff de Claude Design): **azul `#14506B` +
  teal `#16B5A3`**, semáforo verde/ámbar/rojo, fuentes **Sora / Plus Jakarta Sans /
  JetBrains Mono**, íconos **Material Symbols Rounded**. Reemplaza la propuesta original
  (navy `#1E3A8A` / sky, Lexend/Source Sans 3, Lucide). Ver `design-system.md` (reescrito).

## 8. Rutas implementadas en `apps/web` (estado)

| Ruta | Estado |
|------|--------|
| `/` landing de marketing | ✅ |
| `/planes` (planes → checkout → confirmación, vista previa de pago) | ✅ |
| `/cuenta` (login/registro/recuperar + cuenta, Supabase) | ✅ |
| `/onboarding` (OTP preview → intención → primera búsqueda) | ✅ |
| `/empresas` (landing B2B + vista previa de panel de flota) | ✅ |
| `/ayuda` (centro de ayuda / FAQ) | ✅ |
| `/reporte/ejemplo` (dashboard de reporte con datos de demostración) | ✅ |
| `/auth/confirm` + `/auth/confirmado` (confirmación de correo) | ✅ |
| `not-found` (404) + `error` (error boundary) | ✅ |
| `/reporte/[placa]` y `/guiada/[placa]` (flujo original) | ✅ existentes, adoptarán el nuevo dashboard cuando el pipeline esté vivo |
| `/legal/*`, `sitemap`, `robots`, OG images | ✅ |

> Los dashboards "de app" (panel personal con historial, panel Empresas con flota) se
> muestran hoy como **vistas de ejemplo/preview rotuladas**; el historial real se
> construye cuando haya datos (post-pipeline + Supabase).

## 9. Despliegue

- **Web:** Vercel (auto-deploy en push a `main`), dominio `placape.vercel.app` (→ `placape.pe`).
- **Auth/DB:** Supabase (proyecto creado, ref `ozadkkokrpbtejbxwscw`). Usa las **nuevas
  API keys** (`sb_publishable_…` = anon pública; `sb_secret_…` = service_role, solo server).
- **API/worker:** pendientes de desplegar en Render/Fly.
- **Correo:** Zoho SMTP pendiente (requiere dominio activo).

## 10. Pendientes (orden sugerido)

1. **Pipeline de datos BASIC** en vivo: SUNARP/Turnstile con CapSolver → reporte real (deja de ser ejemplo).
2. **Zoho SMTP** en Supabase → reactivar confirmación de correo de marca.
3. **API/worker** en Render/Fly + webhook de pago (IziPay) → activa cobro y sube `tier`.
4. **Panel "Mis reportes"** logueado con historial real (Supabase).
5. Dominio `placape.pe` apuntando a Vercel + correo `@placape.pe`.

---

### Lo que NO cambió (sigue vigente del diseño original)
- Principios de **integridad de datos**: cada dato dice su **fuente** y **cuándo** se
  obtuvo; nunca se muestran veredictos fabricados sobre una placa real (los demos van
  rotulados). Alerta de robo = máxima jerarquía.
- **Minimización de datos** y cumplimiento (retención por TTL, solicitudes de eliminación).
- **Accesibilidad WCAG AA**, light-first, sin emojis como íconos, sin gradientes "IA".
- Arquitectura base monorepo (npm workspaces + Turborepo): `apps/web`, `apps/api`,
  `apps/worker`, `packages/{shared,scrapers,db}`.
