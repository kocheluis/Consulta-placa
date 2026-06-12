# Implementation Plan: Consulta de Historial Vehicular por Placa (Perú)

**Branch**: `001-consulta-placa-vehicular` | **Date**: 2026-06-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-consulta-placa-vehicular/spec.md`

## Summary

App web (lanzamiento inicial) y app Android posterior (Play Store) para consultar el historial de un vehículo peruano por placa. El usuario ingresa una placa y obtiene un **reporte consolidado** con datos registrales (SUNARP), seguros/SOAT y siniestralidad (SBS/APESEG), con secciones "Próximamente" para lo que aún no tiene fuente automatizable, y un disclaimer legal.

**Enfoque técnico**: Monorepo TypeScript. Frontend web en **Next.js 15** (App Router) + Tailwind + shadcn/ui. Backend **API REST (Fastify)** que encola consultas en **BullMQ/Redis**; **workers Playwright** scrapean los portales oficiales (protegidos con CAPTCHA/reCAPTCHA) resolviendo los desafíos vía un servicio externo de CAPTCHA. Resultados por placa se **cachean en Redis con TTL** y se persisten en **PostgreSQL (Prisma)** junto con un log de auditoría y la política de minimización del nombre del propietario. La lógica de scraping, los tipos/contratos y la normalización de placa viven en **packages compartidos** para que una futura app **Expo/React Native** reutilice el mismo backend sin reimplementar nada. MVP **sin autenticación** (consulta anónima con rate-limit), preparado para freemium/créditos a futuro.

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 20 LTS; React 19.

**Primary Dependencies**:
- Web: Next.js 15 (App Router), React 19, Tailwind CSS, shadcn/ui, TanStack Query, Zod.
- API: Fastify 5, Zod (validación + contratos), BullMQ.
- Workers: Playwright (Chromium headless), BullMQ, cliente de servicio CAPTCHA (2Captcha/CapSolver).
- Persistencia/ORM: Prisma + PostgreSQL; ioredis (cache + cola).
- Compartido: paquetes `shared` (tipos, esquemas Zod, normalización de placa) y `scrapers`.
- Móvil (fase posterior): Expo / React Native (solo scaffolding en este alcance).

**Storage**: PostgreSQL (reportes persistidos, metadatos de jobs, auditoría, solicitudes de datos personales). Redis (caché de reportes por placa con TTL + backend de la cola BullMQ).

**Testing**: Vitest (unit: normalización de placa, parsers de scrapers con fixtures HTML, lógica de caché). Pruebas de contrato de la API (Zod + supertest/inject de Fastify). Playwright Test (e2e web). Los scrapers se prueban contra **fixtures HTML guardadas**, no contra los portales en vivo (evita fragilidad y dependencia de red en CI).

**Target Platform**: Web (navegadores modernos, responsive) en el lanzamiento; servidor Linux (contenedores Docker) para API + workers; Android (Play Store vía Expo) en fase posterior.

**Project Type**: Aplicación web multi-app en monorepo (web + api + worker + packages compartidos), que evoluciona a móvil + API.

**Performance Goals**: Primera consulta sin caché < 30 s incluyendo resolución de CAPTCHA (SC-001); consulta cacheada < 3 s (SC-002); ≥90% de placas válidas existentes devuelven sección registral completa (SC-003); reporte parcial ante caída de fuente en ≥95% de esos casos (SC-006).

**Constraints**:
- Fuentes externas protegidas con CAPTCHA/reCAPTCHA y sesiones ASP.NET ViewState → scraping frágil, requiere reintentos y mantenimiento.
- Sin API oficial; dependencia de portales públicos que pueden cambiar sin aviso → scrapers aislados y versionados, con health-checks.
- Legal: nombre del propietario es dato personal (Ley 29733 / DS 016-2024-JUS) → minimización de almacenamiento, retención corta, auditoría, canal de solicitudes.
- Rate-limiting propio para no ser usado como agregador masivo ni saturar las fuentes.

**Scale/Scope**: MVP dimensionado para miles de consultas/día con caché agresiva reduciendo scraping real. Concurrencia de workers limitada por costo de CAPTCHA y para evitar bloqueos de las fuentes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

El archivo `.specify/memory/constitution.md` aún es la plantilla sin ratificar (placeholders), por lo que **no hay principios vinculantes formalizados**. Se aplican principios por defecto y se verifica su cumplimiento:

| Principio por defecto | Cumplimiento en este plan |
|-----------------------|---------------------------|
| Simplicidad / YAGNI | Se evita complejidad innecesaria: una sola base de datos relacional + Redis; sin microservicios más allá de la separación api/worker que el patrón de cola exige. App móvil solo se scaffoldea, no se construye aún. |
| Testabilidad | Scrapers con interfaz uniforme y pruebas contra fixtures HTML; lógica pura (normalización, mapeo) unit-testeable sin red. |
| Separación de responsabilidades | `packages/scrapers` aísla la fragilidad externa detrás de un contrato estable (`SourceResult`), de modo que un cambio en un portal no se filtra a la API ni a la UI. |
| Minimización de datos (legal) | Modelado explícito de retención del nombre del propietario y log de auditoría (FR-050/052/053). |
| Reutilización multiplataforma | Contratos y tipos compartidos → la app Expo consume la misma API (FR-061). |

**Resultado**: PASS (sin violaciones; no requiere Complexity Tracking). Recomendación: ratificar una constitución real con `/speckit-constitution` más adelante para fijar estas reglas.

## Project Structure

### Documentation (this feature)

```text
specs/001-consulta-placa-vehicular/
├── plan.md              # Este archivo (/speckit-plan)
├── research.md          # Fase 0 — decisiones técnicas
├── data-model.md        # Fase 1 — entidades y esquema
├── quickstart.md        # Fase 1 — guía de validación end-to-end
├── contracts/           # Fase 1 — contratos de la API REST
│   ├── api.md
│   └── openapi.yaml
├── design-system.md     # Sistema de diseño de la web (ui-ux-pro-max)
├── checklists/
│   └── requirements.md  # Checklist de calidad de la spec
└── tasks.md             # Fase 2 (/speckit-tasks — NO lo crea /speckit-plan)
```

### Source Code (repository root)

Monorepo con **pnpm workspaces + Turborepo**. La capa de datos y los contratos se comparten entre web y la futura app móvil.

```text
package.json                 # raíz del workspace (pnpm + turbo)
pnpm-workspace.yaml
turbo.json
docker-compose.yml           # Postgres + Redis para desarrollo local

apps/
├── web/                     # Next.js 15 (App Router) — lanzamiento inicial
│   ├── app/
│   │   ├── page.tsx                 # buscador de placa
│   │   ├── reporte/[placa]/page.tsx # vista de reporte consolidado
│   │   └── legal/                   # términos, privacidad, solicitudes de datos
│   ├── components/                  # UI (shadcn/ui): SearchBar, ReportCard, SourceBadge, ComingSoon
│   ├── lib/                         # cliente API, hooks TanStack Query
│   └── tests/                       # Playwright e2e
│
├── api/                     # API REST (Fastify) — productor de la cola
│   ├── src/
│   │   ├── routes/                  # /consultas, /reportes, /legal, /health
│   │   ├── services/                # orquestación: cache → cola → ensamblado de reporte
│   │   ├── plugins/                 # rate-limit, validación Zod, errores
│   │   └── server.ts
│   └── tests/                       # contract + integration
│
└── worker/                  # Workers BullMQ que ejecutan los scrapers Playwright
    ├── src/
    │   ├── processors/              # un processor por fuente (sunarp, sbs, apeseg)
    │   ├── browser/                 # pool de navegadores Playwright
    │   └── index.ts
    └── tests/

packages/
├── shared/                  # tipos + esquemas Zod + normalización de placa + enums de fuente/sección
│   └── src/
│       ├── plate.ts                 # validación/normalización de placa peruana
│       ├── report.ts                # tipos Report, Section, SourceResult, estados
│       └── schemas.ts               # esquemas Zod compartidos (request/response)
├── scrapers/                # módulos de scraping por fuente + cliente CAPTCHA
│   └── src/
│       ├── types.ts                 # interfaz Scraper<Input, SourceResult>
│       ├── sunarp/                  # scraper SUNARP (registral + robo)
│       ├── sbs/                     # scraper SBS (SOAT/seguros + siniestralidad)
│       ├── apeseg/                  # scraper APESEG (SOAT)
│       ├── captcha/                 # cliente del servicio externo de CAPTCHA
│       └── __fixtures__/            # HTML guardado para pruebas de parsers
├── db/                      # Prisma schema + cliente
│   └── prisma/schema.prisma
└── config/                  # tsconfig, eslint, env compartidos

# Fase posterior (solo scaffolding documentado, no implementado en este alcance):
# apps/mobile/              # Expo / React Native consumiendo apps/api
```

**Structure Decision**: Monorepo multi-app (Opción "Mobile + API" del template, adaptada a web-first). La separación **api (productor) / worker (consumidor de cola)** es obligada por el patrón de scraping asíncrono con CAPTCHA: la API responde rápido encolando, y los workers Playwright —lentos y propensos a fallo— se escalan y reintentan de forma independiente sin bloquear la web. Los `packages/` compartidos garantizan que la futura app Expo (FR-061) reutilice tipos, validación y el contrato de la API sin reimplementar la consulta.

## Complexity Tracking

> No aplica — Constitution Check resultó PASS sin violaciones que justificar.
