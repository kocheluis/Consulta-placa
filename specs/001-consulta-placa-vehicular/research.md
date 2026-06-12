# Research & Technical Decisions: Consulta de Historial Vehicular por Placa

**Feature**: `001-consulta-placa-vehicular` | **Date**: 2026-06-12

Este documento consolida las decisiones técnicas (Fase 0). Se apoya en la investigación de fuentes de datos realizada para la spec (sin API oficial peruana; obtención por scraping de portales con CAPTCHA).

---

## D1. Stack y estructura de proyecto

- **Decisión**: Monorepo TypeScript con **pnpm workspaces + Turborepo**. Apps: `web` (Next.js), `api` (Fastify), `worker` (BullMQ + Playwright). Packages: `shared`, `scrapers`, `db`, `config`.
- **Rationale**: TypeScript end-to-end permite compartir tipos, validación Zod y la lógica de normalización de placa entre web, API y la futura app Expo (FR-061). El monorepo evita duplicar contratos. Turborepo da builds incrementales y cacheados.
- **Alternativas consideradas**:
  - *Next.js full-stack (API routes, sin backend separado)*: más simple al inicio, pero los workers de scraping de larga duración con Playwright no encajan en funciones serverless/route handlers; se necesita un proceso worker persistente. Rechazado.
  - *Python (FastAPI + Playwright)*: Python tiene buen tooling de scraping, pero rompería el código compartido con el frontend/móvil y exigiría mantener dos lenguajes. Rechazado por FR-061.
  - *Nx en lugar de Turborepo*: más potente pero más pesado; YAGNI para este tamaño. Turborepo es suficiente.

## D2. Frontend web

- **Decisión**: **Next.js 15 (App Router)** + React 19 + Tailwind CSS + **shadcn/ui** + TanStack Query.
- **Rationale**: SSR/SEO para captar tráfico de búsquedas ("consultar placa"), componentes accesibles listos (shadcn/ui), y TanStack Query maneja el polling del estado del job de consulta de forma limpia. Responsive para reutilizar patrones visuales en la app móvil.
- **Alternativas**: Vite + React SPA (pierde SEO/SSR); Remix (válido, pero Next tiene mayor ecosistema shadcn). Rechazados.

## D3. API y patrón de cola

- **Decisión**: **Fastify 5** como API REST (productor), **BullMQ sobre Redis** como cola, **app `worker` separada** (consumidor) ejecutando los scrapers.
- **Rationale**: El scraping con resolución de CAPTCHA tarda segundos y falla con frecuencia; debe correr asíncrono. La API encola y responde un `jobId` de inmediato (no bloquea, SC-001/UI responsiva); los workers procesan, reintentan y se escalan por separado. Fastify es liviano, rápido y con validación Zod nativa vía esquemas.
- **Patrón de respuesta**: la API primero consulta la **caché** (Redis); si hay hit vigente, responde el reporte directamente; si no, encola y devuelve `jobId` para polling.
- **Alternativas**: NestJS (más estructura/DI pero más boilerplate; YAGNI); cola casera con `setInterval` (frágil, sin reintentos/observabilidad). Rechazados.

## D4. Scraping de las fuentes oficiales

- **Decisión**: **Playwright (Chromium headless)** con un **pool de navegadores** en el worker. Una interfaz uniforme `Scraper<Input, SourceResult>` por fuente (`sunarp`, `sbs`, `apeseg`). Parsers separados de la navegación, probados contra **fixtures HTML**.
- **Rationale**: Los portales usan ASP.NET ViewState (SUNARP), reCAPTCHA (SBS) y CAPTCHAs de imagen; un navegador real es la forma más robusta de manejar JS, sesiones y tokens dinámicos frente a peticiones HTTP crudas (que se rompen al rotar el ViewState/MachineKey, como demostraron los proyectos open-source russbellc/sunarp-vehiculos y martinsam16/consulta-peru). Aislar el parser permite testear sin red y adaptar rápido cuando el portal cambie.
- **Resiliencia**: timeouts por fuente, reintentos con backoff (BullMQ), y degradación a **reporte parcial** marcando la sección como "no disponible" (FR-034, SC-006). Health-check periódico por scraper que alerta si un portal cambió.
- **Alternativas**: Peticiones HTTP + parseo de ViewState (más rápido/barato pero extremadamente frágil); reutilizar APIs de terceros (PlacaAPI.pe/Apitude) — descartado para el MVP por dependencia/costo/zona gris, aunque se deja como posible fallback futuro detrás de la misma interfaz `Scraper`.

## D5. Resolución de CAPTCHA

- **Decisión**: Servicio externo de resolución (**2Captcha / CapSolver**) detrás de un cliente en `packages/scrapers/captcha`, con interfaz intercambiable. Soporta reCAPTCHA v2 (SBS) y CAPTCHA de imagen (SUNARP).
- **Rationale**: Resolver reCAPTCHA de forma confiable y a escala requiere un servicio especializado; implementarlo in-house no es viable. La interfaz intercambiable evita lock-in y permite mockear en tests.
- **Costo/control**: cada resolución tiene costo monetario → refuerza la necesidad de **caché agresiva** (D6) y rate-limiting (D8) para minimizar llamadas reales. El costo de CAPTCHA es el principal driver económico del MVP.
- **Alternativas**: solvers locales con ML (poco fiables para reCAPTCHA, alto mantenimiento); pedir al usuario que resuelva el CAPTCHA (rompe la UX de "ingresa placa y listo"). Rechazados para el MVP.

## D6. Caché y persistencia

- **Decisión**: **Redis** para caché de reportes por placa con **TTL** (clave `report:{placaNormalizada}`); **PostgreSQL + Prisma** para persistir reportes, metadatos de jobs, auditoría y solicitudes de datos.
- **TTL por sección** (las fuentes cambian a ritmos distintos): registral SUNARP ~7 días; SOAT/seguros SBS ~24 h; siniestralidad ~24 h. El reporte muestra la **antigüedad** del dato y permite **forzar actualización** (FR-042/043, US4, SC-002).
- **Rationale**: La caché reduce drásticamente el scraping real y el costo de CAPTCHA, y cumple SC-002 (<3 s). Postgres da consultas estructuradas, auditoría y soporte a la futura monetización (créditos/historial).
- **Alternativas**: cachear solo en Postgres (más lento para hits calientes); sin caché (inviable por costo de CAPTCHA y SC-002). Rechazados.

## D7. Minimización de datos y cumplimiento legal

- **Decisión**: El **nombre del propietario** se trata como dato personal: retención corta (igual o menor al TTL del reporte registral), no se indexa para búsquedas inversas (no se permite "buscar por nombre"), y se registra en un **log de auditoría** quién/qué/cuándo se consultó (FR-050/053). Términos de Uso + Política de Privacidad publicados (FR-051) y endpoint de **solicitudes de datos** del titular (FR-052).
- **Rationale**: Cumple Ley 29733 + DS 016-2024-JUS. La no-indexación por nombre evita convertir la app en un agregador de personas (mitiga el riesgo legal identificado en la investigación). Necesario también para el **Data Safety form de Google Play**.
- **Alternativas**: almacenar todo indefinidamente (riesgo legal alto); no mostrar el nombre (reduce valor del producto y SUNARP igual lo publica). Se opta por mostrarlo en el reporte pero minimizar su persistencia.

## D8. Anti-abuso y rate-limiting

- **Decisión**: Rate-limit por IP/origen en la API (plugin de Fastify), con límites más estrictos para consultas que disparan scraping real vs. hits de caché. CAPTCHA propio de la app (ej. en el buscador) si se detecta abuso. MVP **sin login** (FR-071); el límite es por origen.
- **Rationale**: Protege las fuentes oficiales, controla el costo de CAPTCHA y previene el uso como scraper masivo (FR-003).
- **Alternativas**: sin límites (riesgo de costo y bloqueo de las fuentes). Rechazado.

## D9. Testing

- **Decisión**: **Vitest** (unit: normalización de placa, parsers contra fixtures, lógica de caché/TTL), pruebas de **contrato** de la API (Zod + `fastify.inject`), **Playwright Test** para e2e web. Los scrapers NO se prueban contra portales en vivo en CI (fixtures guardadas).
- **Rationale**: Mantiene CI determinista pese a la fragilidad/red de las fuentes; los parsers son la parte más propensa a romperse y la más barata de cubrir con fixtures.
- **Alternativas**: e2e contra portales reales (no determinista, viola TOS de las fuentes, frágil en CI). Rechazado.

## D10. Despliegue (orientativo, se detalla en tasks)

- **Decisión**: Contenedores Docker; `docker-compose` para desarrollo local (Postgres + Redis). API y worker como servicios separados (escalables de forma independiente). Web desplegable en plataforma con SSR.
- **Rationale**: Los workers Playwright necesitan un entorno con Chromium y escalado propio, distinto del frontend. Docker estandariza el entorno con navegador.
- **Alternativas**: serverless para todo (no apto para Playwright de larga duración). Rechazado para el worker.

---

## Resumen de NEEDS CLARIFICATION resueltos

| Tema | Resolución |
|------|-----------|
| Lenguaje/stack | TypeScript monorepo (D1) |
| Backend vs serverless para scraping | API Fastify + worker BullMQ separado (D3) |
| Cómo manejar CAPTCHA | Servicio externo intercambiable (D5) |
| Cuentas de usuario en MVP | Sin login, anónimo + rate-limit (FR-071, D8) |
| Retención del nombre del propietario | Retención corta ≤ TTL registral, sin búsqueda inversa, auditoría (D7) |
| Reutilización móvil | Packages compartidos + API REST contractual (D1, FR-061) |
