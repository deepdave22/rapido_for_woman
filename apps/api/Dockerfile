# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f apps/api/Dockerfile .
FROM node:25-alpine AS deps
WORKDIR /app
# Every workspace manifest is needed for the lockfile to resolve.
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/api-client/package.json packages/api-client/
COPY packages/mobile-core/package.json packages/mobile-core/
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/passenger/package.json apps/passenger/
COPY apps/driver/package.json apps/driver/

FROM deps AS build
RUN npm ci --include-workspace-root -w @saheli/api -w @saheli/domain --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY apps/api apps/api
RUN npm run build -w @saheli/domain && npm run build -w @saheli/api

FROM deps AS prod-deps
RUN npm ci -w @saheli/api -w @saheli/domain --omit=dev --ignore-scripts && npm cache clean --force

FROM node:25-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=build /app/packages/domain/dist ./packages/domain/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle
WORKDIR /app/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/health/live || exit 1
# Migrations run as a separate one-off step: node dist/database/migrate.js
CMD ["node", "--enable-source-maps", "dist/main.js"]
