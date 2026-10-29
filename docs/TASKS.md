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
- [x] Idempotency-Key handling for booking (replay, mismatch and in-flight detection)
- [ ] Staff auth: email + password (argon2) + TOTP, staff RBAC guard

## Phase 3: Core ride journey ✅

- [x] Seed: categories, pilot zone, pricing v1 (synthetic, labelled; refuses to run in staging/prod)
- [x] Driver onboarding API: vehicle, document upload (content-sniffed, size-limited, private storage), submit for review
- [x] Driver eligibility rule: required checks PASSED and unexpired, documents approved and unexpired, vehicle active
- [x] Driver online/offline; location ingest (accuracy, staleness, clock-skew checks; thinning; dropped when going offline)
- [x] Maps/places provider interfaces: dev estimate + dev gazetteer (labelled), Google Routes and Places adapters (not yet live-tested)
- [x] Fare quotes: PostGIS zone lookup, versioned rule, expiry, promo codes
- [x] Booking from a quote: idempotent, terms required, one live ride per passenger
- [x] Dispatch: PostGIS radius search, ranking with fairness, reservation, timed offers, atomic accept, radius expansion, search window, NO_DRIVER_FOUND
- [x] Ride transitions: arriving, arrived (geofenced), PIN (5 attempts), start, complete (server-side final fare), passenger cancel with fees, driver cancel → re-dispatch
- [x] Realtime: authenticated Socket.IO; offers, ride updates, driver location to the passenger only
- [x] Shared typed API client (single-flight refresh, typed errors, idempotency keys)
- [x] Passenger app: sign-in, terms, place search, quotes with fare breakdown, booking, live tracking, PIN, cancel, history, devices
- [x] Driver app: sign-in, onboarding with document upload, online toggle, location sharing, offers with countdown, ride flow, history
- [ ] Background location for drivers (foreground only today)
- [ ] Device testing on real Android and iOS hardware

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
