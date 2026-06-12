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

## Puesta en marcha real de los scrapers (pasos 4 y 5)

El código de scraping está completo; para que devuelva datos reales (en vez de degradar a
"no disponible") faltan dos cosas que dependen de tu entorno:

### 4. Clave del servicio de CAPTCHA — **integración ya implementada**

Los solvers de **CapSolver** y **2Captcha** están implementados en
`packages/scrapers/src/captcha/`. Solo necesitas una cuenta y su clave:

```bash
# en .env
CAPTCHA_PROVIDER=capsolver   # o "2captcha"
CAPTCHA_API_KEY=tu_clave
```

Sin clave, `createCaptchaSolver` devuelve un Noop y los scrapers degradan a reporte parcial.

### 5. Selectores reales de los portales — **descubrimiento asistido**

Los portales (SUNARP/SBS/APESEG) son SPAs con JS y protegidos; su DOM real no es público.
Los selectores viven centralizados en
[`packages/scrapers/src/selectors.ts`](packages/scrapers/src/selectors.ts) con valores
**tentativos**. Para capturar los reales, ejecuta una vez:

```bash
npx playwright install chromium
npm run -w @app/worker discover-selectors
```

Esto abre cada portal en un navegador real y vuelca por consola sus inputs, botones, iframes y el
`data-sitekey` del reCAPTCHA. Copia los selectores verdaderos a `selectors.ts` (un solo lugar) y
los tres scrapers los toman automáticamente. Tras eso, ajusta los parsers
(`packages/scrapers/src/*/parser.ts`) si la estructura del resultado difiere de los fixtures.

## Cumplimiento de datos

El nombre del titular es dato registral público de SUNARP pero también dato personal (Ley 29733 /
DS 016-2024-JUS): se almacena con retención corta, sin búsqueda inversa por nombre, con auditoría y
un canal de solicitudes de datos. Ver [research.md](specs/001-consulta-placa-vehicular/research.md).
