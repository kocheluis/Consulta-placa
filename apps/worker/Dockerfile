# Worker (BullMQ + Playwright) — consume la cola y ejecuta los scrapers.
# Usa la imagen oficial de Playwright que ya trae Chromium y sus dependencias.
FROM mcr.microsoft.com/playwright:v1.49.1-noble AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN npm ci

FROM deps AS build
RUN npx prisma generate --schema packages/db/prisma/schema.prisma \
  && npx tsc --build packages/shared packages/scrapers \
  && npm run -w @app/worker build

FROM base AS runtime
COPY --from=build /app /app
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
