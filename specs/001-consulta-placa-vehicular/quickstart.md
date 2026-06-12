# Quickstart & Validation Guide: Consulta de Historial Vehicular

**Feature**: `001-consulta-placa-vehicular` | **Date**: 2026-06-12

Guía para levantar el proyecto localmente y validar end-to-end que la feature funciona. Los detalles de implementación viven en `tasks.md` (generado por `/speckit-tasks`).

---

## Prerrequisitos

- Node.js 20 LTS y **pnpm** 9+
- Docker + Docker Compose (Postgres + Redis locales)
- Navegador Chromium para Playwright (`pnpm exec playwright install chromium`)
- Cuenta/clave de un servicio de CAPTCHA (2Captcha o CapSolver) para pruebas reales contra fuentes; en CI/local los scrapers usan fixtures.

## Variables de entorno (resumen)

```bash
DATABASE_URL=postgresql://app:app@localhost:5432/placas
REDIS_URL=redis://localhost:6379
CAPTCHA_PROVIDER=capsolver
CAPTCHA_API_KEY=...            # solo para scraping real
RATE_LIMIT_PER_MINUTE=10
REPORT_TTL_REGISTRAL_DAYS=7
REPORT_TTL_SEGUROS_HOURS=24
OWNER_RETENTION_DAYS=7
```

## Setup

```bash
pnpm install
docker compose up -d                 # Postgres + Redis
pnpm --filter @app/db prisma migrate dev
pnpm exec playwright install chromium
```

## Levantar el sistema (3 procesos)

```bash
pnpm --filter @app/api dev           # API REST (productor)  → http://localhost:3001
pnpm --filter @app/worker dev        # Workers BullMQ (scrapers)
pnpm --filter @app/web dev           # Web Next.js            → http://localhost:3000
```

---

## Escenarios de validación

### V1 — Consulta registral end-to-end (US1 / SC-001, SC-003)
1. Abrir `http://localhost:3000`, ingresar una placa válida de prueba, buscar.
2. **Esperado**: la web muestra estado "consultando…", luego el reporte con marca/modelo/año/color/serie y, si aplica, alerta de robo. Cada sección muestra fuente (SUNARP) y fecha/hora.
3. **Verificación API**: `POST /api/v1/consultas {placa}` responde `202` con `jobId`; `GET /api/v1/consultas/{jobId}` evoluciona a `COMPLETED`/`PARTIAL` con `report`.

### V2 — Validación de placa (FR-002)
1. Ingresar una placa con formato inválido.
2. **Esperado**: la UI rechaza antes de consultar; la API responde `400 INVALID_PLATE`.

### V3 — Seguros y siniestralidad (US2 / SC-004)
1. Consultar una placa con SOAT vigente.
2. **Esperado**: sección SEGUROS muestra `hasActiveSoat: true`, aseguradora, póliza y vigencia; sección SINIESTRALIDAD indica si registra accidentes. Ambas con fuente (SBS) y fecha.

### V4 — Reporte consolidado, "Próximamente" y disclaimer (US3 / SC-005)
1. Generar cualquier reporte.
2. **Esperado**: secciones PAPELETAS, GNV, DEUDA_BANCARIA, PNP aparecen como "Próximamente"; el disclaimer legal es visible.

### V5 — Reporte parcial ante fuente caída (FR-034 / SC-006)
1. Simular caída de una fuente (mock del scraper devolviendo timeout en el worker).
2. **Esperado**: `Report.status = PARTIAL`; la sección afectada muestra "no disponible"; el resto del reporte se entrega.

### V6 — Caché y antigüedad (US4 / SC-002)
1. Consultar la misma placa dos veces seguidas.
2. **Esperado**: la 2ª respuesta llega en < 3 s, marcada como cacheada con su antigüedad. `forceRefresh: true` vuelve a scrapear.

### V7 — Rate limiting (FR-003)
1. Superar el límite de consultas configurado desde un mismo origen.
2. **Esperado**: la API responde `429 RATE_LIMITED` con `retryAfter`.

### V8 — Minimización y solicitudes de datos (FR-050/052 / SC-007)
1. Verificar que `OwnerRecord` tiene `expiresAt` y que el job de purga elimina los vencidos.
2. `POST /api/v1/solicitudes-datos` registra una solicitud y devuelve `201 RECEIVED`.
3. Confirmar que no existe endpoint ni índice de búsqueda por nombre del titular.

---

## Pruebas automatizadas

```bash
pnpm test                 # Vitest: normalización de placa, parsers (fixtures), caché/TTL
pnpm --filter @app/api test   # contrato API (Zod + fastify.inject)
pnpm --filter @app/web test   # Playwright e2e (mockeando la API)
```

Los scrapers se validan contra `packages/scrapers/src/__fixtures__/*.html` (no contra portales en vivo) para mantener CI determinista.

---

## Criterios de aceptación cubiertos

| Escenario | Requisitos / Success Criteria |
|-----------|-------------------------------|
| V1 | US1, FR-010/011, SC-001, SC-003 |
| V2 | FR-002 |
| V3 | US2, FR-020/021/022, SC-004 |
| V4 | US3, FR-030/032/033, SC-005 |
| V5 | FR-034, SC-006 |
| V6 | US4, FR-042/043, SC-002 |
| V7 | FR-003 |
| V8 | FR-050/052/053, SC-007 |
