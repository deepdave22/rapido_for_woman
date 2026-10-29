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
