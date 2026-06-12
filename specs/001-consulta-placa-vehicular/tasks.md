---
description: "Task list for Consulta de Historial Vehicular por Placa (Perú)"
---

# Tasks: Consulta de Historial Vehicular por Placa (Perú)

**Input**: Design documents from `/specs/001-consulta-placa-vehicular/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, design-system.md

**Tests**: INCLUDED — el plan define una estrategia de testing explícita (Vitest para unit/parsers contra fixtures, contract tests de la API con `fastify.inject`, Playwright e2e). Las tareas de test acompañan a cada historia.

**Organization**: Tareas agrupadas por historia de usuario para implementación y prueba independientes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede correr en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: US1, US2, US3, US4 (mapea a las historias de spec.md)
- Rutas exactas incluidas en cada tarea

## Path Conventions (monorepo)

`apps/web` (Next.js), `apps/api` (Fastify), `apps/worker` (BullMQ+Playwright), `packages/shared`, `packages/scrapers`, `packages/db`, `packages/config`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Inicialización del monorepo y estructura base.

- [X] T001 Inicializar monorepo con pnpm workspaces + Turborepo en la raíz (`package.json`, `pnpm-workspace.yaml`, `turbo.json`)
- [X] T002 [P] Crear `packages/config` con tsconfig base, ESLint y Prettier compartidos
- [X] T003 [P] Crear `docker-compose.yml` con servicios PostgreSQL y Redis para desarrollo local
- [X] T004 [P] Scaffold de `apps/web` (Next.js 15 App Router + TypeScript)
- [X] T005 [P] Scaffold de `apps/api` (Fastify 5 + TypeScript) con entrypoint `apps/api/src/server.ts`
- [X] T006 [P] Scaffold de `apps/worker` (TypeScript) con entrypoint `apps/worker/src/index.ts`
- [X] T007 [P] Inicializar paquetes vacíos `packages/shared`, `packages/scrapers`, `packages/db` con sus `package.json` y `tsconfig`
- [X] T008 [P] Configurar Vitest en la raíz del workspace para todos los paquetes/apps
- [X] T009 Crear `.env.example` con las variables de [quickstart.md](./quickstart.md) (DATABASE_URL, REDIS_URL, CAPTCHA_*, TTLs, RATE_LIMIT_*)

**Checkpoint**: Monorepo instalable (`pnpm install`) y servicios locales arriba.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Infraestructura compartida que TODAS las historias necesitan.

**⚠️ CRITICAL**: Ninguna historia puede comenzar hasta completar esta fase.

### Tipos, validación y dominio compartido (`packages/shared`)
- [X] T010 [P] Implementar normalización y validación de placa peruana (formatos vigentes e históricos) en `packages/shared/src/plate.ts`
- [X] T011 [P] Test unitario de normalización/validación de placa en `packages/shared/src/plate.test.ts` (casos válidos, históricos, inválidos)
- [X] T012 [P] Definir enums (`SourceId`, `SectionKind`, `SectionStatus`, `JobStatus`, `ReportStatus`, `DataRequestType/Status`) en `packages/shared/src/enums.ts` per [data-model.md](./data-model.md)
- [X] T013 [P] Definir tipos `Report`, `SectionResult`, `Vehicle`, `SourceResult`, payloads (`InsurancePolicy`, `SiniestroIndicator`) en `packages/shared/src/report.ts`
- [X] T014 Definir esquemas Zod de request/response (ConsultaRequest, ConsultaResponse, Report, DataSubjectRequest) en `packages/shared/src/schemas.ts` per [contracts/api.md](./contracts/api.md) (depende de T012, T013)

### Persistencia (`packages/db`)
- [X] T015 Definir el esquema Prisma completo (Vehicle, OwnerRecord, Report, SectionResult, QueryJob, AuditLog, DataSubjectRequest) en `packages/db/prisma/schema.prisma` per [data-model.md](./data-model.md)
- [X] T016 Generar el cliente Prisma y crear la migración inicial; exportar cliente en `packages/db/src/index.ts` (depende de T015)

### Scrapers e infraestructura externa (`packages/scrapers`)
- [X] T017 [P] Definir la interfaz `Scraper<Input, SourceResult>` y el contrato de resultado en `packages/scrapers/src/types.ts`
- [X] T018 [P] Implementar cliente intercambiable de CAPTCHA (proveedor 2Captcha/CapSolver, soporta reCAPTCHA v2 e imagen) en `packages/scrapers/src/captcha/index.ts` con interfaz mockeable
- [X] T019 Implementar pool de navegadores Playwright (Chromium headless) reutilizable en `packages/scrapers/src/browser/pool.ts`

### Cola y caché (api ↔ worker)
- [X] T020 [P] Configurar conexión Redis y definir la cola BullMQ (`consultas`) compartida en `packages/shared/src/queue.ts`
- [X] T021 [P] Implementar utilidades de caché Redis con TTL por sección (claves `report:` / `section:`) en `apps/api/src/services/cache.ts` per [data-model.md](./data-model.md)

### API base (`apps/api`)
- [X] T022 Configurar servidor Fastify con plugins: validación Zod, manejo de errores uniforme, y rate-limiting por origen (FR-003) en `apps/api/src/server.ts` y `apps/api/src/plugins/`
- [X] T023 [P] Implementar endpoint `GET /api/v1/health` (servicio + estado de scrapers) en `apps/api/src/routes/health.ts`
- [X] T024 Implementar servicio de orquestación base (recibe placa validada → encola job → persiste `QueryJob`; SIN caché todavía, siempre scrapea) en `apps/api/src/services/consulta.ts` (depende de T014, T016, T020)
- [X] T025 Implementar `POST /api/v1/consultas` y `GET /api/v1/consultas/{jobId}` (modelo encolar + polling) en `apps/api/src/routes/consultas.ts` (depende de T024)

### Worker base (`apps/worker`)
- [X] T026 Configurar el consumidor BullMQ con reintentos/backoff y ensamblado de `Report` a partir de los `SourceResult` de los processors registrados, en `apps/worker/src/index.ts` y `apps/worker/src/assemble.ts` (depende de T013, T016, T020)

### Web base (`apps/web`)
- [X] T027 [P] Configurar Tailwind con los tokens de [design-system.md](./design-system.md) (paleta navy+semánticos, fuentes Lexend/Source Sans 3/JetBrains Mono) en `apps/web/tailwind.config.ts` y `apps/web/app/globals.css`
- [X] T028 [P] Inicializar shadcn/ui y crear layout base con header/footer institucional en `apps/web/app/layout.tsx` y `apps/web/components/layout/`
- [X] T029 [P] Implementar cliente de API y hook de polling de job (TanStack Query) en `apps/web/lib/api.ts` y `apps/web/lib/use-consulta.ts`
- [X] T030 [P] Implementar componentes UI compartidos del design system: `SourceBadge`, `StatusPill`, `SectionCard` (estados AVAILABLE/UNAVAILABLE), skeletons, en `apps/web/components/report/`

**Checkpoint**: Pipeline encolar→worker→reporte funciona end-to-end con un processor dummy; la web puede buscar y hacer polling. Listo para historias.

---

## Phase 3: User Story 1 - Datos registrales del vehículo (Priority: P1) 🎯 MVP

**Goal**: Consultar una placa y obtener datos registrales SUNARP (titular, marca/modelo/año/color, serie/VIN/motor) con alerta de robo, sello de fuente y fecha.

**Independent Test**: Ingresar una placa válida y verificar que la web muestra los campos registrales y la alerta de robo cuando aplica; placa inválida → 400; placa sin registro → "sin resultados".

### Tests for User Story 1 ⚠️
- [X] T031 [P] [US1] Test unitario del parser SUNARP contra fixtures HTML en `packages/scrapers/src/sunarp/parser.test.ts` (incluye fixture con anotación de robo)
- [X] T032 [P] [US1] Contract test de `POST /consultas` + `GET /consultas/{jobId}` devolviendo sección REGISTRAL en `apps/api/tests/consultas.registral.test.ts`
- [ ] T033 [P] [US1] e2e Playwright: búsqueda → reporte registral en `apps/web/tests/registral.spec.ts`

### Implementation for User Story 1
- [X] T034 [US1] Guardar fixtures HTML de SUNARP (resultado normal y con robo) en `packages/scrapers/src/sunarp/__fixtures__/`
- [X] T035 [US1] Implementar parser SUNARP (HTML → `SourceResult` registral + `stolenAlert`) en `packages/scrapers/src/sunarp/parser.ts` (depende de T017, T013)
- [X] T036 [US1] Implementar navegación/scraper SUNARP (ViewState + resolución de CAPTCHA de imagen) en `packages/scrapers/src/sunarp/index.ts` (depende de T018, T019, T035)
- [X] T037 [US1] Implementar processor `sunarp` en el worker en `apps/worker/src/processors/sunarp.ts` y registrarlo en el ensamblado (depende de T026, T036)
- [X] T038 [US1] Persistir `Vehicle` y `OwnerRecord` con `expiresAt` (retención corta, sin índice por nombre) al ensamblar el reporte, en `apps/worker/src/assemble.ts` (FR-050) (depende de T016)
- [X] T039 [US1] Registrar entrada en `AuditLog` cuando el reporte expone el nombre del titular, en `apps/api/src/services/consulta.ts` (FR-053)
- [X] T040 [P] [US1] Implementar `PlateInput` con validación cliente y página de búsqueda en `apps/web/app/page.tsx` y `apps/web/components/PlateInput.tsx` (FR-002)
- [X] T041 [P] [US1] Implementar `StolenAlert` (banner danger, `role="alert"`) en `apps/web/components/report/StolenAlert.tsx`
- [X] T042 [US1] Implementar página de reporte con la sección registral (DataRows, identificadores en mono, titular minimizado) en `apps/web/app/reporte/[placa]/page.tsx` (depende de T030, T041)
- [X] T043 [US1] Manejar estados vacío ("sin resultados en SUNARP") y de error en la página de reporte

**Checkpoint**: US1 funcional — MVP demostrable de consulta registral con alerta de robo.

---

## Phase 4: User Story 2 - Seguros (SOAT) y siniestralidad (Priority: P2)

**Goal**: Mostrar si el vehículo tiene SOAT/seguro vigente (aseguradora, póliza, vigencia) e indicador de siniestralidad, vía SBS y APESEG.

**Independent Test**: Consultar una placa con SOAT vigente → sección SEGUROS con aseguradora/póliza/vigencia; placa con accidente → indicador de siniestro; cada uno con fuente y fecha.

### Tests for User Story 2 ⚠️
- [ ] T044 [P] [US2] Test unitario del parser SBS (seguros + siniestralidad) contra fixtures en `packages/scrapers/src/sbs/parser.test.ts`
- [ ] T045 [P] [US2] Test unitario del parser APESEG (SOAT) contra fixtures en `packages/scrapers/src/apeseg/parser.test.ts`
- [ ] T046 [P] [US2] Contract test de `POST /consultas` devolviendo secciones SEGUROS y SINIESTRALIDAD en `apps/api/tests/consultas.seguros.test.ts`

### Implementation for User Story 2
- [ ] T047 [P] [US2] Guardar fixtures HTML de SBS y APESEG en `packages/scrapers/src/sbs/__fixtures__/` y `packages/scrapers/src/apeseg/__fixtures__/`
- [ ] T048 [P] [US2] Implementar parser SBS (SOAT/seguros últimos 5 años + siniestralidad → `InsurancePolicy`/`SiniestroIndicator`) en `packages/scrapers/src/sbs/parser.ts`
- [ ] T049 [P] [US2] Implementar parser APESEG (estado SOAT) en `packages/scrapers/src/apeseg/parser.ts`
- [ ] T050 [US2] Implementar scraper SBS con resolución de reCAPTCHA v2 en `packages/scrapers/src/sbs/index.ts` (depende de T018, T019, T048)
- [ ] T051 [US2] Implementar scraper APESEG en `packages/scrapers/src/apeseg/index.ts` (depende de T019, T049)
- [ ] T052 [P] [US2] Implementar processor `sbs` en `apps/worker/src/processors/sbs.ts` y registrarlo (depende de T026, T050)
- [ ] T053 [P] [US2] Implementar processor `apeseg` en `apps/worker/src/processors/apeseg.ts` y registrarlo (depende de T026, T051)
- [ ] T054 [US2] Implementar `SegurosSectionCard` y la presentación de siniestralidad (StatusPill success/danger) en `apps/web/components/report/SegurosSection.tsx` (depende de T030)
- [ ] T055 [US2] Integrar las secciones SEGUROS y SINIESTRALIDAD en la página de reporte `apps/web/app/reporte/[placa]/page.tsx`

**Checkpoint**: US1 + US2 funcionan de forma independiente.

---

## Phase 5: User Story 3 - Reporte consolidado, "Próximamente" y disclaimer (Priority: P2)

**Goal**: Un reporte único que consolida las secciones, muestra las capacidades futuras como "Próximamente", el disclaimer legal, y maneja reportes parciales.

**Independent Test**: Generar un reporte y verificar secciones "Próximamente" (no error), disclaimer visible, y que una fuente caída produce reporte PARCIAL sin invalidar el resto.

### Tests for User Story 3 ⚠️
- [ ] T056 [P] [US3] Contract test: el reporte siempre incluye secciones COMING_SOON + disclaimer, y `status=PARTIAL` ante sección UNAVAILABLE, en `apps/api/tests/consultas.consolidado.test.ts`
- [ ] T057 [P] [US3] e2e Playwright: reporte muestra "Próximamente", disclaimer y degradación parcial en `apps/web/tests/consolidado.spec.ts`

### Implementation for User Story 3
- [X] T058 [US3] Asegurar que el ensamblado del reporte añade siempre las secciones COMING_SOON (PAPELETAS, GNV, DEUDA_BANCARIA, PNP) y marca `status=PARTIAL` si alguna sección MVP queda UNAVAILABLE, en `apps/worker/src/assemble.ts` (FR-032, FR-034)
- [X] T059 [US3] Incluir el texto de `disclaimer` en la respuesta del reporte en `apps/api/src/services/consulta.ts` (FR-033)
- [ ] T060 [P] [US3] Implementar `ComingSoonSection` (tarjeta atenuada) y la grilla de "Próximamente" en `apps/web/components/report/ComingSoonSection.tsx`
- [ ] T061 [P] [US3] Implementar `Disclaimer` y el encabezado de estado del reporte (COMPLETE/PARTIAL) en `apps/web/components/report/Disclaimer.tsx` y el header de la página
- [ ] T062 [US3] Implementar el botón "Reintentar" en secciones UNAVAILABLE en la página de reporte (FR-034)
- [ ] T063 [P] [US3] Implementar páginas legales `GET /legal/terms` y `/legal/privacy` (API) y vistas en `apps/web/app/legal/` (FR-051)
- [ ] T064 [US3] Implementar `POST /api/v1/solicitudes-datos` + persistencia `DataSubjectRequest` y formulario en `apps/web/app/legal/solicitar-datos/` (FR-052)

**Checkpoint**: US1 + US2 + US3 — reporte consolidado completo y honesto sobre su alcance.

---

## Phase 6: User Story 4 - Resultados rápidos mediante caché (Priority: P3)

**Goal**: Reutilizar resultados recientes desde caché (<3 s), mostrando antigüedad y permitiendo forzar actualización.

**Independent Test**: Consultar la misma placa dos veces → 2ª respuesta <3 s, marcada con antigüedad; `forceRefresh` vuelve a scrapear.

### Tests for User Story 4 ⚠️
- [ ] T065 [P] [US4] Test de la lógica de caché read-through y TTL por sección en `apps/api/src/services/cache.test.ts`
- [ ] T066 [P] [US4] Contract test: 2ª consulta devuelve `200 cached:true` con `ageSeconds`; `forceRefresh` ignora caché, en `apps/api/tests/consultas.cache.test.ts`

### Implementation for User Story 4
- [ ] T067 [US4] Añadir el camino read-through en la orquestación: cache-hit vigente → responder `200` con reporte; miss → encolar, en `apps/api/src/services/consulta.ts` (FR-042) (depende de T021, T024)
- [ ] T068 [US4] Escribir en caché las secciones/reporte tras el ensamblado con TTL por tipo, en `apps/worker/src/assemble.ts`
- [ ] T069 [US4] Implementar `forceRefresh` (invalida claves de la placa antes de encolar) en `apps/api/src/services/consulta.ts` (FR-043)
- [ ] T070 [US4] Implementar `GET /api/v1/reportes/{placa}` (último reporte cacheado, sin scraping) en `apps/api/src/routes/reportes.ts`
- [ ] T071 [P] [US4] Mostrar antigüedad del dato y botón "Actualizar" en la web `apps/web/components/report/SourceBadge.tsx` y la página de reporte

**Checkpoint**: Las 4 historias funcionan de forma independiente.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Cumplimiento, robustez y validación final.

- [X] T072 [P] Implementar job programado de purga de `OwnerRecord` vencidos (`expiresAt < now()`) en `apps/worker/src/jobs/purge-owners.ts` (FR-050, SC-007)
- [ ] T073 [P] Implementar health-check periódico por scraper que detecta cambios/caídas de portales y lo refleja en `GET /health`
- [ ] T074 [P] Endurecer rate-limiting (límites diferenciados cache-hit vs scraping) y cabeceras de seguridad en `apps/api/src/plugins/`
- [ ] T075 [P] Auditoría de accesibilidad del design system (contraste, foco, `prefers-reduced-motion`, responsive 375/768/1024/1440) en `apps/web`
- [ ] T076 [P] Configurar Dockerfiles de `apps/api` y `apps/worker` (con Chromium) para despliegue
- [ ] T077 [P] Documentar el scaffolding de `apps/mobile` (Expo) que reutiliza la API, en `docs/mobile.md` (FR-061, fuera de alcance de implementación)
- [ ] T078 Ejecutar la validación completa de [quickstart.md](./quickstart.md) (escenarios V1–V8)
- [ ] T079 [P] README raíz con setup, arquitectura y comandos

---

## Dependencies & Execution Order

### Phase Dependencies
- **Setup (Phase 1)**: sin dependencias.
- **Foundational (Phase 2)**: depende de Setup. BLOQUEA todas las historias.
- **US1 (Phase 3)**: depende de Foundational. Sin dependencias de otras historias. = **MVP**.
- **US2 (Phase 4)**: depende de Foundational. Independiente de US1 (comparte componentes base, no lógica).
- **US3 (Phase 5)**: depende de Foundational; consolida lo que exista (mejor con US1/US2 presentes, pero testeable con cualquier sección).
- **US4 (Phase 6)**: depende de Foundational; añade caché sobre la orquestación existente.
- **Polish (Phase 7)**: depende de las historias deseadas.

### User Story Dependencies
- US1, US2, US3, US4 son independientes entre sí tras Foundational. US3 y US4 envuelven/extienden la orquestación pero no rompen US1/US2.

### Within Each User Story
- Tests primero (deben fallar) → fixtures → parser → scraper → processor → API → UI.
- Modelos/tipos antes que servicios; servicios antes que endpoints; core antes que integración.

### Parallel Opportunities
- Setup: T002–T008 en paralelo.
- Foundational: T010–T013, T017–T018, T020–T021, T027–T030 en paralelo (archivos distintos).
- Tras Foundational: US1, US2, US3, US4 pueden repartirse entre desarrolladores.
- Dentro de cada historia: los `[P]` (parsers, fixtures, componentes UI) corren en paralelo.

---

## Parallel Example: User Story 1

```bash
# Tests de US1 juntos:
Task: "Test parser SUNARP contra fixtures (T031)"
Task: "Contract test consultas registral (T032)"
Task: "e2e Playwright búsqueda→reporte (T033)"

# Componentes UI de US1 en paralelo:
Task: "PlateInput + página de búsqueda (T040)"
Task: "StolenAlert (T041)"
```

---

## Implementation Strategy

### MVP First (solo US1)
1. Phase 1 Setup → 2. Phase 2 Foundational (CRÍTICO) → 3. Phase 3 US1 → **VALIDAR US1** → demo MVP (consulta registral + robo).

### Incremental Delivery
1. Setup + Foundational → base lista.
2. + US1 → MVP (registral). 3. + US2 → seguros/siniestralidad. 4. + US3 → consolidado + legal. 5. + US4 → caché/velocidad.
6. Polish → cumplimiento (purga, health, a11y) y validación quickstart.

### Parallel Team Strategy
Tras Foundational: Dev A → US1, Dev B → US2, Dev C → US3/US4. Integran de forma independiente.

---

## Notes
- [P] = archivos distintos, sin dependencias pendientes.
- Los scrapers se prueban contra **fixtures HTML**, nunca contra portales en vivo en CI.
- El nombre del titular: retención corta, sin búsqueda inversa, auditado (cumplimiento legal transversal).
- Commit tras cada tarea o grupo lógico; detenerse en cada checkpoint para validar la historia.
