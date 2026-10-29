# Saheli Rides

A women-focused ride-hailing platform for India: women passengers booking verified women
drivers, with safety built into the ride lifecycle. _"Saheli Rides" is a working name._

> **Status: pre-pilot.** The full ride journey works end to end through the API:
> driver onboarding, quotes, booking, dispatch, PIN-verified pickup, completion, cancellation
> and live updates. Both mobile apps are built but not yet device-tested. Payments, safety
> workflows and the admin dashboard are in progress. See [docs/TASKS.md](docs/TASKS.md)
> and [docs/LAUNCH_BLOCKERS.md](docs/LAUNCH_BLOCKERS.md).

## Repository layout

```
apps/
  api/            NestJS API (REST + Socket.IO), Drizzle ORM, migrations in drizzle/
  passenger/      Passenger app (Expo SDK 54 / React Native)
  driver/         Driver app (Expo SDK 54 / React Native)
packages/
  domain/         Pure business rules: fares, dispatch ranking, ride lifecycle, money
  api-client/     Typed HTTP client shared by the apps
  mobile-core/    Shared React Native theme, components, sign-in, realtime
infra/            docker compose for local Postgres+PostGIS and Redis
docs/             Architecture, decisions, task checklist, launch blockers
```

Planned: `apps/admin` (Next.js).

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- Docker Desktop

## Local setup

```bash
npm install
npm run infra:up                         # Postgres on localhost:55432, Redis on 6379
cp apps/api/.env.example apps/api/.env   # then replace both secrets (command is in the file)
npm run build -w @saheli/domain -w @saheli/api-client
npm run db:migrate
npm run db:seed                          # synthetic pilot zone + prices (dev only)
npm run dev:api                          # http://localhost:3000, docs at /docs
```

With `OTP_PROVIDER=console`, login codes are printed to the API log. No SMS is sent.

## Mobile apps

```bash
cp apps/passenger/.env.example apps/passenger/.env   # set EXPO_PUBLIC_API_URL
cd apps/passenger && npx expo run:android            # development build (needs Android SDK)
```

The driver app works the same way from `apps/driver`. To approve a test driver before the
admin dashboard exists, see the `approvedDriver` fixture in `apps/api/test/helpers.ts`.

## Tests

```bash
npm test          # unit tests (domain + API)
npm run test:int  # integration tests against Postgres/PostGIS + Redis (needs infra:up)
npm run lint && npm run typecheck && npm run format:check
```

Integration tests use the separate `saheli_test` database, which is rebuilt from
migrations on every run, and Redis db 15.

## Database changes

Edit `apps/api/src/database/schema/*`, then:

```bash
npm run db:generate -w @saheli/api -- --name=describe_change
npm run db:migrate
```

Commit the generated SQL. CI fails if the schema and migrations disagree.

## Principles

- The server decides fares, eligibility and ride state; clients never send amounts to be trusted.
- Money is integer paise. The ledger is double-entry and append-only.
- No fake integrations in deployed environments: a missing provider stops startup.
- Safety features describe exactly what happens. Nothing claims an emergency response
  that doesn't exist.
