# Task checklist

Prioritised for a working, secure, end-to-end ride flow first. `[x]` means built **and**
covered by tests that were actually run.

## Phase 1: Assessment and architecture ✅

- [x] Repository assessed (it was empty apart from the README)
- [x] Architecture, boundaries and invariants: [ARCHITECTURE.md](ARCHITECTURE.md)
- [x] Decisions recorded: [DECISIONS.md](DECISIONS.md)
- [x] Legal, operational and external-service blockers: [LAUNCH_BLOCKERS.md](LAUNCH_BLOCKERS.md)

## Phase 2: Foundation ✅ (API side)

- [x] Monorepo, strict TypeScript, ESLint, Prettier, EditorConfig
- [x] Local infrastructure: Postgres 17 + PostGIS 3.5, Redis 7 (docker compose)
- [x] Full database schema (40 tables) with constraints, partial unique indexes, GiST indexes
- [x] Append-only triggers (ledger, audit, ride events, incident events) and immutable pricing versions
- [x] Ledger balance enforced at commit
- [x] Domain package: money, fares, settlement, ride state machine, cancellation fees, phone numbers
- [x] Env validation; production refuses dev-only OTP senders
- [x] Consistent error format, request IDs, redacted structured logs
- [x] Phone OTP auth, refresh rotation with reuse detection, logout, device list and revoke
- [x] Global auth guard (session and account status checked per request) and role/app guard
- [x] Health: liveness and readiness (DB and Redis)
- [x] OpenAPI at `/docs` (non-production)
- [x] CI: audit, format, lint, typecheck, migration drift, unit and integration tests, build
- [ ] Idempotency-Key middleware (table exists): needed before booking/payments
- [ ] Staff auth: email + password (argon2) + TOTP, staff RBAC guard

## Phase 3: Core ride journey (next)

- [ ] Seed: service categories, one pilot zone, pricing v1 (synthetic, clearly labelled)
- [ ] Driver onboarding API: documents (signed upload URLs), vehicle, verification checks, submit for review
- [ ] Driver eligibility rule: every required check PASSED and unexpired, documents approved, vehicle active
- [ ] Driver online/offline + location ingest (rate-limited, freshness and accuracy checks)
- [ ] Maps provider interface + dev adapter (straight-line × factor, clearly labelled) + real adapter
- [ ] Fare quotes (zone lookup with PostGIS, versioned rule, expiry)
- [ ] Booking from a quote (idempotent; one active ride per passenger)
- [ ] Dispatch: PostGIS nearest eligible drivers, ranking, timed offers, atomic accept, radius expansion, NO_DRIVER_FOUND
- [ ] Ride transitions API (arrive, verify PIN, start, complete, cancel + fees, driver-cancel → reassign)
- [ ] Realtime: Socket.IO gateway with auth; ride-scoped rooms; driver location to the assigned passenger only
- [ ] Passenger app (Expo): login, home map, quote, book, track, PIN, complete, history
- [ ] Driver app (Expo): login, onboarding, online toggle, offer, navigate, PIN, complete, earnings view

## Phase 4: Payments and safety

- [ ] Payment provider interface; sandbox adapter (never real money); cash flow
- [ ] Razorpay adapter: orders, signed webhook verification, idempotent processing, reconciliation
- [ ] Ledger postings for completion, cash, refunds, cancellation fees, payouts
- [ ] Driver earnings and statements derived from the ledger
- [ ] SOS: incident creation tied to the ride and location, honest status, staff acknowledgement
- [ ] Trusted contacts, trip-share links (expiring, revocable)
- [ ] Support tickets, ratings

## Phase 5: Admin and operations

- [ ] Admin dashboard (Next.js): staff login with MFA, role-based navigation
- [ ] Driver review queue, document viewer (signed URLs, audited access), approve/reject/suspend
- [ ] Live rides map, incident queue and timeline, ticket queue
- [ ] Pricing versions editor, zones, promotions
- [ ] Metrics from the database (no hardcoded numbers)

## Phase 6: Hardening

- [ ] Playwright E2E for admin; mobile E2E strategy (Maestro or Detox)
- [ ] Load tests: booking, dispatch, location ingest, WebSocket fan-out
- [ ] Security review, dependency scanning, OWASP API checks
- [ ] Staging deploy, backups with a tested restore, monitoring and alerting, runbooks
- [ ] Data retention jobs (location points, OTP challenges, expired sessions)
