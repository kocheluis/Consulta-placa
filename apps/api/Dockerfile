# API REST (Fastify) — productor de la cola.
FROM node:20-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# Dependencias del workspace (se copia todo el monorepo para resolver @app/*).
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm ci

# Build de la API y sus paquetes.
FROM deps AS build
RUN npx prisma generate --schema packages/db/prisma/schema.prisma \
  && npx tsc --build packages/shared packages/scrapers \
  && npm run -w @app/api build

FROM base AS runtime
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/server.js"]
