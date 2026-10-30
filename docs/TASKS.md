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

## Phase 4: Payments and safety ✅ (API complete; app checkout UI pending)

- [x] Payment provider interface; sandbox adapter (HMAC-signed webhooks, refused in staging/prod); Razorpay adapter (orders, refunds, webhook signature)
- [x] Online payment start (server-computed amount, idempotent), cash confirmation by driver
- [x] Webhooks: raw-body signature check, event-id de-duplication, amount-mismatch refusal, failure → retry path
- [x] Double-entry ledger postings: fares (online and cash), cancellation fees, refunds, payouts
- [x] Driver earnings summary, commission, cash netting, CSV statement; payouts with failure reversal
- [x] Refunds with four-eyes approval and over-refund protection
- [x] SOS (passenger and driver): ride and location attached, de-duplicated, honest delivery status
- [x] Incident reports with reporter-only timeline; trusted contacts (max 5); expiring, revocable trip-share links
- [x] Ratings (one per side, 7-day window); support tickets with private threads
- [x] Apps: SOS, share trip, trusted contacts, rating, pay-online start, cash confirmation, driver earnings
- [ ] In-app Razorpay checkout (native SDK or hosted page). Today the app starts the order but cannot complete a live payment
- [ ] SMS/push providers: notifications are recorded as SKIPPED with the reason until one is integrated
- [ ] Automated payouts (RazorpayX or bank API); payouts are created and settled by staff

## Phase 5: Administration and operations ✅

- [x] Staff auth: scrypt passwords, mandatory TOTP (RFC 6238, secrets AES-256-GCM encrypted), lockout, 12-hour rotating sessions, separate JWT audience from app tokens
- [x] Server-side RBAC (SUPER_ADMIN, OPERATIONS, SUPPORT, FINANCE, SAFETY), roles read per request; first super admin via CLI (`admin:create`)
- [x] Driver review: queue, document viewing (no-store, audited), document approve/reject, verification check results, approve/reject/suspend/reactivate with gap checks
- [x] Live and historical rides, ride timeline/offers/payments, admin end-ride; passenger search, account suspension (revokes all devices)
- [x] Safety queue (severity-ordered), acknowledge → respond (note required, then visible to reporter) → resolve → close; internal notes
- [x] Support queue with replies and private internal notes
- [x] Versioned pricing publishing (no backdating), zones (WKT validated by PostGIS), promotions
- [x] Finance: four-eyes refunds, driver balances, payout creation and settlement; ride CSV export without personal data (formula-injection safe, audited)
- [x] Database-backed overview metrics; audit log viewer
- [x] Admin dashboard (Next.js 15): cookie-based server proxy (httpOnly, SameSite=strict, CSRF header), strict CSP, role-aware navigation, all screens above
- [ ] QR code for TOTP enrolment (today: copy the key into the authenticator)
- [ ] Map view for live rides (today: coordinates linking to Google Maps)

## Phase 6: Hardening and launch preparation ✅ (engineering scope)

- [x] TOTP replay protection; rate-limit counters in Redis (shared across instances)
- [x] Retention jobs (OTP, sessions, idempotency, share links, ride breadcrumbs) and document-expiry enforcement
- [x] Data export and account deletion (anonymisation; blocked while rides, payments or balances are open)
- [x] Load test with correctness assertions under concurrency; quote path batched (burst latency halved) — docs/PERFORMANCE.md
- [x] Production Dockerfiles (multi-stage, non-root, health checks); whole stack verified from images
- [x] Backup and restore drill (pg_dump/pg_restore, counts and triggers verified) — docs/DEPLOYMENT.md
- [x] CI: Docker image builds, CodeQL, Dependabot
- [x] Deployment and rollback guide, security and privacy checklist, runbook, production-readiness assessment
- [ ] Staging environment on real infrastructure; sustained load test there
- [ ] Error tracking, metrics dashboards and alerting (incl. paging for SOS)
- [ ] External penetration test
- [ ] Mobile end-to-end tests (Maestro/Detox) on real devices
- [ ] Playwright end-to-end tests for the admin dashboard (today: API-level tests and a live smoke test)

## Phase 7: Store-ready mobile apps ✅ (configuration; builds need accounts)

- [x] Android package / iOS bundle IDs, icons, adaptive and themed icons, splash screens
- [x] Minimal permissions per app; iOS background mode `location` (driver) only
- [x] Push notifications: device registration API, Expo push sender, ride-event pushes, tap-to-open
- [x] Driver background location (foreground service, Play prominent disclosure)
- [x] In-app account deletion (store requirement); deep links (schemes; optional App/Universal Links)
- [x] EAS Build and Submit profiles; release builds refuse non-https APIs — docs/MOBILE_RELEASE.md
- [ ] (owner) Expo, Google Play and Apple accounts; first `.aab` / `.ipa` builds and submission
- [x] Reviewer sign-in: sandboxed review accounts with a fixed code (two keys, isolated matching, cash only)
- [ ] (owner) Review numbers and code; store listings, screenshots, Data safety / App Privacy forms
- [ ] Device testing on low-end Android and iPhone; TestFlight and Play closed testing
- [ ] Data export screen in the apps; push delivery receipts
