# Architecture decisions

Short records of choices that are expensive to reverse. Newest last.

## ADR-001 Monorepo with npm workspaces

**Decision:** One repo: `apps/api`, `apps/admin`, `apps/passenger`, `apps/driver`, `packages/domain`.
npm workspaces, no Turborepo/Nx yet.
**Why:** Shared types and rules across apps, one CI. npm is already installed and Expo's
Metro works with it without extra hoisting config. A build orchestrator can come later
if build times call for one.

## ADR-002 NestJS modular monolith, not microservices

**Why:** One team, pre-launch. Clear module boundaries give the separation without the
operational cost. See the scaling path in ARCHITECTURE.md.

## ADR-003 Business rules in a pure `@saheli/domain` package

**Why:** Fares, the ride state machine and settlement are the rules most likely to be
wrong and most costly when they are. Pure functions are exhaustively unit-tested
(including a 1,000-trip randomised check that every paisa is accounted for). The API is
the only runtime that executes them for decisions.

## ADR-004 Drizzle ORM with SQL-first migrations

**Why:** PostGIS, partial unique indexes, check constraints and triggers are central to
correctness. Drizzle exposes them directly and generates reviewable SQL. Prisma's PostGIS
support relies on `Unsupported` types and raw queries.
**Gotcha:** drizzle-kit quotes custom types containing parentheses.
`scripts/unquote-postgis-types.mjs` runs after every `db:generate` to fix that.

## ADR-005 Money as integer paise, ledger as double-entry

**Decision:** All amounts are `integer` paise. Financial events post balanced debit/credit
legs to an append-only `financial_ledger_entries` table, and the database rejects
unbalanced transactions at commit.
**Pricing defaults (business decisions, to be confirmed):**

- Tax is applied to (ride fare − discount + booking fee). The 5% rate is a placeholder.
  The correct GST treatment for each category must come from a tax advisor.
- Promotions are platform-funded: the driver earns on the undiscounted ride fare.
- The passenger total is rounded to the nearest rupee. The rounding difference goes to
  the platform and is shown on the receipt.

## ADR-006 Ride status and payment status are separate

**Why:** A trip that happened stays COMPLETED even if payment fails. Disputes are support
tickets linked to the ride, not a ride status.

## ADR-007 Driver cancellation sends the ride back to SEARCHING

**Why:** The passenger shouldn't have to rebook. The dispatch service decides whether
retry limits allow another round, or ends the ride as NO_DRIVER_FOUND.

## ADR-008 Phone OTP auth with rotating refresh tokens; session checked per request

**Why:** Suspending a driver or logging out a stolen phone must take effect immediately,
not 15 minutes later. That costs one indexed query per request, which is acceptable at
launch scale. It can be cached in Redis with explicit invalidation later.

## ADR-009 Dependency versions: latest patch within known-stable majors

**Decision:** NestJS 11, TypeScript 5.9, Vitest 3, Drizzle 0.45, Node 22 LTS. Newer majors
exist (NestJS 12, TypeScript 7, Vitest 5) but are not adopted yet. Upgrading should be a
deliberate, tested step, not a side effect of scaffolding.
`npm audit --omit=dev` must stay clean (CI enforces `--audit-level=high`). `overrides`
pin patched `multer` and `js-yaml` transitive versions.
**Accepted dev-only findings:** Vitest 3 / tinypool (fixed only in Vitest 5) and
drizzle-kit's esbuild. Neither ships to production and neither dev server is exposed.
Revisit when upgrading Vitest.

## ADR-010 Plain `tsc` build instead of the Nest CLI

**Why:** `@nestjs/cli` 11.0.24 installed without its `commander` dependency and failed to
run. `tsc` emits the decorator metadata Nest needs, has fewer dependencies, and gives the
same output. `scripts/dev.mjs` provides the watch loop.

## ADR-011 Local Postgres on host port 55432

**Why:** Windows (Hyper-V) reserves port ranges that include 5432 on the primary dev
machine. CI uses 5432 inside GitHub's runner.

## ADR-012 Mobile: Expo SDK 54, shared `mobile-core`, separate mobile audit

**Decision:** Both apps use Expo SDK 54 (React Native 0.81, React 19.1, expo-router 6), the
latest patch of an SDK line we know well (ADR-009). Native module versions are chosen by
`expo install`. Shared UI, auth and realtime code lives in `packages/mobile-core`, shipped
as TypeScript source and compiled by Metro.
**Consequences:**

- Expo Go from the stores runs only the newest SDK, so device testing uses a development
  build (`npx expo run:android`) or EAS Build.
- `mobile-core` pins its peer dependencies exactly. A `"*"` peer range once made npm hoist
  React Native 0.88 beside 0.81 and broke the Metro bundle.
- Production audit findings in the Expo 54 tree (decode-uri-component/query-string in
  expo-router deep-link parsing, image-size/deepmerge at build time) have no fix inside
  SDK 54. CI therefore audits server packages as a blocking check and mobile packages as a
  reported, non-blocking check. Revisit at the next SDK upgrade, which should happen before
  store submission.

## ADR-013 Dispatch state in Postgres, swept on an interval

**Decision:** Offers, reservations and timeouts live in Postgres. One offer per ride at a
time. The offered driver is reserved via `driver_availability.active_ride_id` (an atomic
conditional update). Expired offers are swept every 2 s with `FOR UPDATE SKIP LOCKED`.
**Why:** It is correct across restarts and multiple API instances without adding a queue,
and every outcome is queryable for operations. A Redis/BullMQ delay queue can replace the
sweep if offer timing needs to be tighter than about 2 s.

## ADR-014 Upfront pricing; final fare = quote + waiting charge

**Decision:** The passenger pays the quoted fare for the quoted route, plus waiting time
beyond the free window. Distance actually driven is not re-metered.
**Why:** Predictable for passengers and resistant to detours. Route-deviation alerts and
re-pricing for passenger-requested stop or destination changes are separate features.

## ADR-015 Payments: webhooks are the source of truth

**Decision:** A ride is marked paid only by a signature-verified gateway webhook (or a
driver's cash confirmation), never by the app reporting success. Webhooks are stored by
gateway event id before processing, so retries are no-ops. A captured amount that differs
from the order is refused and audited. Every financial effect is a balanced ledger
transaction, so balances (driver earnings, cash held, payouts) are always derived, never
stored.

## ADR-016 Safety features report delivery truthfully

**Decision:** SOS always records an incident, even without a ride, location or
connectivity to other services. The response lists what actually happened (incident
received; trusted-contact SMS sent or not, and why) and always shows 112. The app never
says "help is on the way" unless staff have recorded a response.

## ADR-017 Admin dashboard keeps tokens server-side

**Decision:** The Next.js dashboard never exposes staff tokens to browser JavaScript. Its route
handlers hold them in `httpOnly`, `SameSite=strict` cookies, refresh them, and proxy
`/api/admin/*` to the API. State-changing requests must carry an `x-saheli-csrf` header.
**Why:** It limits the damage an XSS bug in a privileged UI can do, and keeps one source of truth
for authorisation (the API), so the dashboard has no business logic to get wrong.

## ADR-018 Staff credentials without native dependencies

**Decision:** scrypt (Node built-in) for staff passwords and an in-house RFC 6238 TOTP
(verified against the RFC test vectors), instead of argon2 and otplib.
**Why:** It avoids native build steps on Windows and in CI, and avoids an unmaintained OTP
dependency. The code is small and fully unit-tested.

## ADR-019 Store builds with EAS; push through the Expo push service

**Decision:** Build and submit both apps with EAS Build / EAS Submit (one EAS project per app,
`eas.json` in each app folder, build numbers kept remotely). Send push notifications through
the Expo push service using Expo push tokens, behind a `PushSender` interface
(`PUSH_PROVIDER=none|expo`).
**Why:** EAS builds Android and iOS in the cloud, so iOS builds do not need a Mac in the team,
and it manages signing credentials. The Expo push service relays to FCM and APNs with one
token format and one HTTP call, and needs no Firebase Admin SDK on the server.
**Consequences:**

- The Expo account becomes a dependency for builds and push; use an organisation account and
  back up the Android upload keystore. Moving off Expo push later only means a new
  `PushSender` and native token registration.
- Push tokens are tied to the sign-in session: the API stops sending as soon as the session is
  revoked or expires, so a shared or resold phone does not receive someone else's ride updates.
- Push is a nudge on top of realtime events. It never blocks or fails the ride flow, and
  lock-screen text carries no names, numbers or addresses.
