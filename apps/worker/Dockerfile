# Worker (BullMQ + Playwright) — consume la cola y ejecuta los scrapers.
# Imagen oficial de Playwright (trae Chromium + dependencias del sistema).
FROM mcr.microsoft.com/playwright:v1.49.1-noble AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npx prisma generate --schema packages/db/prisma/schema.prisma \
  && npx tsc --build packages/shared packages/scrapers packages/db \
  && npm run -w @app/worker build

FROM mcr.microsoft.com/playwright:v1.49.1-noble AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
