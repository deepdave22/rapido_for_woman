# Security and privacy checklist

`[x]` = implemented and covered by an automated test that was run. `[~]` = partly done.
`[ ]` = not done.

## Authentication and sessions

- [x] Phone OTP: 6 digits, stored as HMAC (pepper), 5 attempts, 5-minute expiry, single use under concurrency
- [x] OTP abuse limits per phone (5/h, 30 s cooldown) and per IP, enforced in Postgres
- [x] Short-lived access tokens (15 min); rotating refresh tokens stored hashed; reuse revokes the device session
- [x] Logout, device list and remote sign-out; suspension and deletion take effect on the next request
- [x] App and staff tokens use different JWT audiences and cannot be swapped
- [x] Staff: scrypt passwords, mandatory TOTP (RFC 6238), secrets encrypted with AES-256-GCM, single-use codes, lockout after 5 failures, 12-hour sessions
- [x] Mobile tokens in the OS keystore (expo-secure-store); admin tokens in httpOnly, SameSite=strict cookies, never visible to browser JavaScript
- [ ] Staff SSO / hardware keys (consider for scale)

- [x] App-store review accounts: a fixed code for allow-listed, provisioned, sandboxed accounts only
      (ADR-020). Normal OTP limits and audit logging apply; unset the variables to disable.

## Authorisation

- [x] Global deny-by-default guard; public routes opt out explicitly
- [x] Passenger/driver routes check both role and the app the session was created in
- [x] Object-level checks on every ride, ticket, incident, payment and share; other users' objects return 404 (tested)
- [x] Staff RBAC enforced server-side, roles reloaded per request (tested per role)
- [x] Four-eyes refunds (database constraint + service check)

## Input, output and transport

- [x] Validation on every DTO with unknown fields rejected; consistent error shape; no stack traces to clients
- [x] Parameterised SQL everywhere (Drizzle / `sql` template); dependency patched for the Drizzle identifier-escaping CVE
- [x] Upload checks: size limit, type detected from content (not the declared type), server-generated storage keys, path-escape guard
- [x] Helmet headers on the API; strict CSP, frame-ancestors none, no-referrer on the admin dashboard
- [x] CSRF: SameSite=strict cookies plus a required custom header on mutating admin requests (tested)
- [x] CSV exports neutralise spreadsheet formulas and contain no names or phone numbers
- [~] HTTPS: release apps refuse non-https API URLs; TLS termination is the platform's job (configure HSTS there)

## Rate limiting and abuse

- [x] Global HTTP rate limit with counters in Redis, shared across instances (storage tested)
- [x] Stricter limits on OTP and staff login endpoints
- [x] One live ride per passenger; quotes are single use and expire
- [ ] Device fingerprinting / suspicious-booking heuristics

## Data protection and privacy (DPDP)

- [x] Minimal sharing: drivers see the passenger's first name only; no phone numbers exchanged; trip PIN only to the passenger
- [x] Live driver location only to the assigned passenger, only during the ride; deleted when the driver goes offline
- [x] Trip-share links expire, can be revoked, and show only vehicle and progress
- [x] Identity documents in private storage, viewable only by OPERATIONS, every view audited, never cached
- [x] Support staff see masked phone numbers; full numbers only for operations and safety
- [x] Data export and account deletion endpoints (anonymises the identity, keeps legally required records)
- [x] Retention jobs: OTP challenges (1 day), sessions (30 days after end), idempotency records, share links, ride breadcrumbs (configurable, 90 days default)
- [x] Audit log is append-only (database trigger); metadata excludes personal data
- [ ] Retention periods confirmed by counsel (LAUNCH_BLOCKERS L8)
- [ ] Encryption at rest for the database and bucket (enable on the managed services)
- [ ] Consent records for trusted-contact messaging (contacts are told by the user, not opted in by us)
- [ ] Privacy notice, terms and grievance officer published (text in the app is a placeholder)

## Supply chain and operations

- [x] `npm audit` on server and admin production dependencies: 0 known vulnerabilities, blocking in CI
- [x] Patched transitive versions pinned via `overrides` (multer, js-yaml, postcss)
- [x] CodeQL (security-extended) and Dependabot configured
- [x] No secrets in the repo; `.env` files ignored; images contain no secrets
- [x] Containers run as non-root
- [~] Mobile dependency findings in Expo SDK 54 accepted and reported (ADR-012)
- [ ] External penetration test before launch
- [ ] Centralised log retention, alerting and an error tracker (Sentry or similar)
