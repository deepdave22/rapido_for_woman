# Saheli Rides

A women-focused ride-hailing platform for India: women passengers booking verified women
drivers, with safety built into the ride lifecycle. _"Saheli Rides" is a working name._

> **Status: engineering complete for a controlled pilot; not launch-ready.** All six phases
> are built and tested (API, passenger and driver apps, admin dashboard). Launch still needs legal
> answers, real provider accounts, a staffed safety desk, device testing and a staging environment.
> Start with [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md).

## Repository layout

```
apps/
  api/            NestJS API (REST + Socket.IO), Drizzle ORM, migrations in drizzle/
  passenger/      Passenger app (Expo SDK 54 / React Native)
  driver/         Driver app (Expo SDK 54 / React Native)
  admin/          Operations dashboard (Next.js 15)
packages/
  domain/         Pure business rules: fares, dispatch ranking, ride lifecycle, money
  api-client/     Typed HTTP client shared by the apps
  mobile-core/    Shared React Native theme, components, sign-in, realtime
infra/            docker compose for local Postgres+PostGIS and Redis
docs/             Architecture, decisions, tasks, launch blockers, deployment, security, runbook
```

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

## Admin dashboard

```bash
npm run admin:create -w @saheli/api -- you@example.com "Your Name"   # prints a one-time password
cp apps/admin/.env.example apps/admin/.env.local
npm run dev -w @saheli/admin                                        # http://localhost:3001
```

The first sign-in asks you to add a TOTP key to an authenticator app.

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

## Documentation

| Document                                             | What it covers                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| [PRODUCTION_READINESS](docs/PRODUCTION_READINESS.md) | Honest status against the pilot Definition of Done                  |
| [LAUNCH_BLOCKERS](docs/LAUNCH_BLOCKERS.md)           | Legal, operational and external-service blockers; known limitations |
| [ARCHITECTURE](docs/ARCHITECTURE.md)                 | System diagram, invariants, ride lifecycle, ER diagram              |
| [DECISIONS](docs/DECISIONS.md)                       | Architecture decision records                                       |
| [DEPLOYMENT](docs/DEPLOYMENT.md)                     | Environments, release, migrations, rollback, backups, costs         |
| [SECURITY_PRIVACY](docs/SECURITY_PRIVACY.md)         | Security and DPDP checklist                                         |
| [PERFORMANCE](docs/PERFORMANCE.md)                   | Targets and load-test results                                       |
| [RUNBOOK](docs/RUNBOOK.md)                           | SOS handling, outages, payments, security incidents                 |
| [TASKS](docs/TASKS.md)                               | Phase-by-phase checklist                                            |
