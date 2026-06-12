# ConsultaPlaca — Historial vehicular por placa (Perú)

Aplicación web (y futura app Android) para consultar el historial de un vehículo peruano por su
placa: datos registrales (SUNARP), seguro SOAT y siniestralidad (SBS), con alerta de robo. La
información es referencial y proviene de portales públicos oficiales.

> Estado: **MVP en construcción**. Implementada la US1 (datos registrales SUNARP) sobre una base
> compartida completa. Ver [specs/001-consulta-placa-vehicular/](specs/001-consulta-placa-vehicular/)
> para spec, plan, diseño y tareas.

## Arquitectura (monorepo)

| Workspace | Rol |
|-----------|-----|
| `apps/web` | Frontend Next.js 15 (App Router) + Tailwind |
| `apps/api` | API REST Fastify (productor de la cola) |
| `apps/worker` | Workers BullMQ + Playwright (scrapers) |
| `packages/shared` | Tipos, validación de placa, esquemas Zod, ensamblado del reporte |
| `packages/scrapers` | Scrapers por fuente (SUNARP/…) + cliente CAPTCHA |
| `packages/db` | Esquema Prisma + cliente PostgreSQL |
| `packages/config` | tsconfig/ESLint/Prettier compartidos |

> Nota: el monorepo usa **npm workspaces** (en este entorno no se pudo instalar pnpm por permisos);
> el diseño original contemplaba pnpm + Turborepo. Es intercambiable.

## Requisitos

- Node.js 20+ y npm
- Docker (PostgreSQL + Redis locales)
- Navegador Chromium para Playwright: `npx playwright install chromium`
- Clave de un servicio de CAPTCHA (CapSolver/2Captcha) solo para scraping real

## Setup

```bash
cp .env.example .env
npm install
docker compose up -d                 # Postgres + Redis
npm run -w @app/db prisma:migrate    # crea las tablas
npx playwright install chromium
```

## Desarrollo (3 procesos)

```bash
npm run -w @app/api dev       # API  → http://localhost:3001
npm run -w @app/worker dev    # workers (scrapers)
npm run -w @app/web dev       # web  → http://localhost:3000
```

## Pruebas

```bash
npm test                      # Vitest: placa, parser SUNARP, ensamblado, contrato API
npm run -w @app/web build     # build de producción de la web
```

Los scrapers se prueban contra **fixtures HTML** (`packages/scrapers/src/**/__fixtures__/`), nunca
contra los portales en vivo, para mantener CI determinista.

## Cumplimiento de datos

El nombre del titular es dato registral público de SUNARP pero también dato personal (Ley 29733 /
DS 016-2024-JUS): se almacena con retención corta, sin búsqueda inversa por nombre, con auditoría y
un canal de solicitudes de datos. Ver [research.md](specs/001-consulta-placa-vehicular/research.md).
