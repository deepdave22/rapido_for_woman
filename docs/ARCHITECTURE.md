# Architecture

_Working name: **Saheli Rides**. The name is a placeholder until a trademark search clears it._

## System overview

```mermaid
flowchart LR
  subgraph Clients
    P[Passenger app<br/>React Native / Expo]
    D[Driver app<br/>React Native / Expo]
    A[Admin dashboard<br/>Next.js]
  end

  subgraph API["API (NestJS modular monolith)"]
    AUTH[auth / sessions]
    RIDES[rides + dispatch]
    PRICE[pricing]
    PAY[payments + ledger]
    SAFE[safety + support]
    ADMIN[admin / RBAC]
    RT[realtime gateway<br/>Socket.IO]
  end

  DOMAIN[["@saheli/domain<br/>fares, lifecycle, money<br/>(pure, no I/O)"]]

  PG[(PostgreSQL 17<br/>+ PostGIS 3.5)]
  RD[(Redis 7<br/>queues, pub/sub, rate limits)]
  OBJ[(Private object storage<br/>driver documents)]

  SMS[SMS / OTP provider]
  MAPS[Maps & routing]
  PG_GW[Payment gateway]
  PUSH[FCM / APNs]

  P & D -->|HTTPS REST + WebSocket| API
  A -->|HTTPS REST| API
  API --> DOMAIN
  API --> PG
  API --> RD
  API --> OBJ
  AUTH --> SMS
  RIDES --> MAPS
  PAY <-->|orders, signed webhooks| PG_GW
  SAFE --> PUSH
```

**Status legend:** what exists today is tracked in [TASKS.md](TASKS.md). As of Phase 2, the API
has auth, sessions, profile, health and the full database schema. Everything else in the
diagram is designed but not built.

## Boundaries

| Layer               | Owns                                                                                | Must not                                                   |
| ------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `packages/domain`   | Fare maths, ride state machine, cancellation rules, settlement split, phone parsing | Do I/O, read config, import Nest                           |
| `apps/api` modules  | Persistence, authorisation, transactions, integrations                              | Re-implement domain rules                                  |
| Mobile / admin apps | Presentation, input, device capabilities                                            | Calculate fares, decide eligibility, trust their own state |

The server is the only authority for money, ride state and eligibility. Clients display
server-computed values and send intents ("book this quote", "start ride with PIN 4821").

## Key invariants and where they are enforced

| Invariant                                                | Enforcement                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| One live ride per passenger; one engaged ride per driver | Partial unique indexes on `rides`                                            |
| Only one driver wins an offer                            | Partial unique index `ride_assignments_one_accepted_uq` + conditional update |
| Ride cannot start before pickup PIN check                | Domain `assertRideTransition` + `rides_started_verified_ck`                  |
| Ledger always balances                                   | Deferred constraint trigger `financial_ledger_entries_balanced`              |
| Ledger, audit log, ride events are never rewritten       | `forbid_mutation` triggers                                                   |
| Published prices never change                            | `pricing_rules_immutable` trigger; new version = new row                     |
| Money is never fractional                                | Integer paise everywhere; checks reject negatives                            |
| Logout/suspension takes effect immediately               | Guard checks session + account status on every request                       |
| OTP guesses are bounded                                  | Attempt counted atomically before comparison                                 |

## Ride lifecycle

```mermaid
stateDiagram-v2
  [*] --> REQUESTED
  REQUESTED --> SEARCHING: system
  SEARCHING --> DRIVER_ASSIGNED: driver accepts
  SEARCHING --> NO_DRIVER_FOUND: system (retries exhausted)
  DRIVER_ASSIGNED --> DRIVER_ARRIVING: driver/system
  DRIVER_ASSIGNED --> DRIVER_ARRIVED: driver
  DRIVER_ARRIVING --> DRIVER_ARRIVED: driver
  DRIVER_ARRIVED --> IN_PROGRESS: driver + verified PIN
  IN_PROGRESS --> COMPLETED: driver/admin
  DRIVER_ASSIGNED --> SEARCHING: driver cancels → reassign
  DRIVER_ARRIVING --> SEARCHING: driver cancels → reassign
  DRIVER_ARRIVED --> SEARCHING: driver cancels → reassign
  REQUESTED --> CANCELLED
  SEARCHING --> CANCELLED
  DRIVER_ASSIGNED --> CANCELLED
  DRIVER_ARRIVING --> CANCELLED
  DRIVER_ARRIVED --> CANCELLED
  IN_PROGRESS --> CANCELLED: admin only
  COMPLETED --> [*]
  CANCELLED --> [*]
  NO_DRIVER_FOUND --> [*]
```

Payment status is a separate column so a failed payment never rewinds a completed trip.

## Data model (core entities)

```mermaid
erDiagram
  users ||--o{ user_roles : has
  users ||--o{ sessions : "signs in on"
  users ||--o| passenger_profiles : "is a"
  users ||--o| driver_profiles : "is a"
  driver_profiles ||--o{ driver_verifications : "checked by"
  driver_profiles ||--o{ driver_documents : uploads
  driver_profiles ||--o{ vehicles : owns
  driver_profiles ||--|| driver_availability : "is"
  driver_profiles ||--o| driver_locations : "last seen at"
  service_zones ||--o{ pricing_rules : "priced by"
  service_categories ||--o{ pricing_rules : "priced by"
  users ||--o{ fare_quotes : requests
  fare_quotes ||--o| rides : "booked as"
  pricing_rules ||--o{ rides : "priced with"
  rides ||--o{ ride_events : history
  rides ||--o{ ride_assignments : "offered to"
  rides ||--o{ payments : "paid by"
  payments ||--o{ refunds : ""
  rides ||--o{ financial_ledger_entries : posts
  driver_profiles ||--o{ driver_payouts : receives
  rides ||--o{ safety_incidents : ""
  rides ||--o{ trip_shares : ""
  users ||--o{ trusted_contacts : ""
  rides ||--o{ ratings : ""
  users ||--o{ support_tickets : opens
  staff_users ||--o{ staff_role_assignments : ""
```

The schema source of truth is `apps/api/src/database/schema/`. Migrations are in
`apps/api/drizzle/`. Generated migrations are committed; CI fails if the schema and
migrations drift apart.

## Authentication

- **App users** (passengers, drivers): phone + 6-digit SMS OTP. Codes are stored as
  HMAC-SHA256 with a server pepper. Each code allows 5 attempts and expires after 5 minutes.
  Sends are limited per phone (5/hour, 30s cooldown) and per IP.
- **Tokens**: 15-minute HS256 access JWT + opaque 30-day refresh token (stored hashed).
  Every refresh rotates the token. Replaying a rotated token revokes that device's whole
  session family (theft detection). Clients must not run two refreshes in parallel.
- **Staff** (admin dashboard): separate `staff_users` table with email + password +
  mandatory TOTP, and role assignments (SUPER_ADMIN, OPERATIONS, SUPPORT, FINANCE, SAFETY).
  The schema exists; the flows are Phase 5.
- A driver-app token cannot call passenger routes and vice versa (`@Roles` checks both
  the role and the app the session was created from).

## Scaling path

The first deployment is a single modular API with managed Postgres and Redis. Known
steps before running more than one API instance:

1. Move the HTTP throttler storage from memory to Redis.
2. Use the Socket.IO Redis adapter for realtime fan-out.
3. Run dispatch timeouts and notifications on a durable queue (BullMQ), not in-process timers.

Modules talk through service interfaces so a hot module (dispatch, location ingest) can
be extracted later if load proves it necessary. That isn't done up front.
