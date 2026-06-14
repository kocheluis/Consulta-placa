# Plan del proyecto — ConsultaPlaca

Estado y hoja de ruta. Última actualización: 2026-06-13.

Producción: **https://consulta-placa-web.vercel.app** · Repo: github.com/kocheluis/Consulta-placa

---

## 1. Estado actual (lo que YA funciona) ✅

### Producto
- **Web pública desplegada** en Vercel (gratis, auto-deploy en cada push).
- **Versión gratuita "Consulta guiada"**: 25 enlaces oficiales por placa, agrupados en 8 categorías
  (registral/transferencias, seguro/SOAT, revisión técnica, GNV, papeletas por región, impuesto
  vehicular, orden de captura, infracciones), con diseño dashboard, copiar placa y notas.
- **Modo PRO gateado**: si no hay backend/cuenta PRO → muestra "próximamente".

### Técnico (monorepo, todo el código existe y compila)
- `apps/web` — Next.js 15 + Tailwind (desplegado).
- `apps/api` — Fastify: consultas, auth (registro/login JWT+bcrypt), gate PRO, reportes, legal,
  solicitudes de datos, rate-limit, helmet. **Compila, no desplegado.**
- `apps/worker` — BullMQ + Playwright + scrapers SUNARP/SBS/APESEG + modo demo. **No desplegado.**
- `packages/shared` — placa, tipos, Zod, ensamblado de reporte, catálogo de enlaces.
- `packages/scrapers` — scrapers + CAPTCHA (CapSolver/2Captcha/OCR local) + descubridor de selectores.
- `packages/db` — Prisma (Vehicle, OwnerRecord, Report, Section, QueryJob, AuditLog, User, DataRequest).
- **26 tests** (unit + contract) en verde; build de producción OK.

### Investigación hecha
- Fuentes de datos oficiales y su anti-bot real (Cloudflare Turnstile en SUNARP, reCAPTCHA v3 en SBS).
- Competencia y precios: Autofact S/24.90, Mi Torito S/15.90, APIs json.pe/PlacaAPI; pago vía Culqi.

---

## 2. Lo que FALTA (pendientes)

### A. Versión gratuita — mejoras (prioridad ALTA, bajo costo)
- [ ] **Verificar uno a uno los 25 enlaces** en navegador real (varios `.gob.pe` no se pueden
      comprobar por programa). Corregir los que fallen.
- [ ] **Prellenar la placa** en los portales que aceptan parámetro por URL (donde se pueda).
- [ ] **SEO**: metadatos, Open Graph, sitemap.xml, robots.txt, títulos por placa → aparecer en Google
      ("consultar placa", "papeletas <región>"). *Sin tráfico, el PRO no vende.*
- [ ] **Analítica** (Vercel Analytics / Plausible) para medir qué consultan los usuarios.
- [ ] Más regiones de papeletas si hace falta (Áncash/Chimbote, Huánuco, Puno, etc.).
- [ ] Pulir textos legales y disclaimer en la consulta guiada.

### B. Versión PRO — backend en producción (prioridad MEDIA, costo bajo/medio)
- [ ] **Desplegar infraestructura** (planes gratis): PostgreSQL (Neon), Redis (Upstash),
      API + worker (Render/Fly/Railway, worker con el Dockerfile que ya existe).
- [ ] Conectar la web al backend: `NEXT_PUBLIC_API_URL` + `NEXT_PUBLIC_PRO_ENABLED=true`.
- [ ] **Pasarela de pago** para activar PRO automáticamente: **Culqi** (tarjeta + Yape) y/o
      Mercado Pago. Webhook que marca `isPro/isActive` tras el pago.
- [ ] Definir el **modelo de cobro**: por reporte (S/ 15–20, bajo Autofact) o por créditos.
- [ ] **Datos reales del reporte PRO** (la parte difícil):
  - Solver de CAPTCHA de pago (CapSolver soporta Turnstile + reCAPTCHA v3).
  - Cablear el flujo real de cada portal (Angular SUNARP, ASP.NET/VIEWSTATE SBS, iframe APESEG)
    usando el descubridor de selectores (`npm run -w @app/worker discover-selectors`).
  - Escribir los parsers contra el HTML real de cada portal.
  - *Alternativa más rápida:* revender una API existente (PlacaAPI.pe / json.pe / Apitude).

### C. App móvil — Play Store (prioridad MEDIA, según objetivo)
- [ ] `apps/mobile` con Expo/React Native reutilizando la API (guía en `docs/mobile.md`).
- [ ] Publicación en Play Store: cuenta de desarrollador (US$ 25 único), Data Safety form,
      Términos/Privacidad. *Ningún competidor tiene app móvil consolidada → oportunidad.*

### D. Legal y cumplimiento (prioridad ALTA antes de monetizar)
- [ ] Revisar Términos y Política de Privacidad con la Ley 29733 / DS 016-2024-JUS.
- [ ] Confirmar el tratamiento del nombre del propietario en el PRO (minimización ya diseñada).
- [ ] Para la app: completar el formulario de seguridad de datos de Google Play.

### E. Operación y mantenimiento (continuo)
- [ ] Monitoreo de scrapers (los portales cambian → el health-check ya existe, falta alertas).
- [ ] Constitución del proyecto (`/speckit-constitution`) si se formaliza el equipo.
- [ ] CI (GitHub Actions) que corra tests/typecheck en cada push.
- [ ] Dominio propio (opcional, ~US$ 10/año) y URL corta.

---

## 3. Roadmap sugerido (orden recomendado)

| Fase | Objetivo | Incluye | Costo |
|------|----------|---------|-------|
| **1. Validar y captar** | Que la versión gratis traiga usuarios | A (verificar enlaces, SEO, analítica) | ~0 |
| **2. Decidir negocio** | Precio y pasarela del PRO | Definir modelo + B (Culqi) | ~0 setup |
| **3. PRO en producción** | Reporte automático funcionando | B (deploy + datos reales o reventa API) | CAPTCHA/API por consulta |
| **4. Móvil** | App en Play Store | C | US$ 25 (Play) |
| **5. Escalar** | Crecimiento y mantenimiento | D + E | variable |

**Recomendación:** empezar por **Fase 1** (la web gratis ya está viva; sin tráfico el PRO no
tiene a quién venderle). En paralelo, decidir precio/pasarela (Fase 2). El PRO con datos reales
(Fase 3) es lo más costoso y frágil — evaluar reventa de API vs. scraping propio.

---

## 4. Decisiones abiertas (requieren tu definición)
1. **Modelo de cobro PRO**: ¿pago por reporte o créditos? ¿precio?
2. **Datos PRO**: ¿scraping propio (CapSolver, más control, más mantenimiento) o revender API
   (más rápido, dependes de un tercero)?
3. **App móvil**: ¿prioridad ahora o después de validar la web?
4. **Dominio propio**: ¿usamos `*.vercel.app` gratis o compramos dominio?
