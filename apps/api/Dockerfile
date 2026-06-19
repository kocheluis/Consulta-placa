# API REST (Fastify) — productor de la cola BullMQ.
# Build con devDependencies (tsc/prisma); runtime con NODE_ENV=production.
FROM node:20-slim AS build
WORKDIR /app
# Contexto = raíz del monorepo (.dockerignore excluye node_modules/dist/.env).
COPY . .
RUN npm ci
RUN npx prisma generate --schema packages/db/prisma/schema.prisma \
  && npx tsc --build packages/shared packages/db \
  && npm run -w @app/api build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
