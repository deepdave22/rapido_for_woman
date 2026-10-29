# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f apps/admin/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/api-client/package.json packages/api-client/
COPY packages/mobile-core/package.json packages/mobile-core/
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/passenger/package.json apps/passenger/
COPY apps/driver/package.json apps/driver/
RUN npm ci --include-workspace-root -w @saheli/admin -w @saheli/api-client -w @saheli/domain --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY packages/api-client packages/api-client
COPY apps/admin apps/admin
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @saheli/domain && npm run build -w @saheli/api-client && npm run build -w @saheli/admin

FROM node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
WORKDIR /app
# Next's standalone output contains only the files the server needs.
COPY --from=build /app/apps/admin/.next/standalone ./
COPY --from=build /app/apps/admin/.next/static ./apps/admin/.next/static
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:3001/login >/dev/null || exit 1
CMD ["node", "apps/admin/server.js"]
