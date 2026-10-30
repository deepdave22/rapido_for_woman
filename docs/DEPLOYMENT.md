# Deployment, rollback and recovery

## Environments

|            | Development                                                                                | Staging                                    | Production                |
| ---------- | ------------------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------- |
| Purpose    | Local work                                                                                 | Pre-release checks, pilot rehearsal        | Real users                |
| Data       | Synthetic seed                                                                             | Synthetic only; never copies of production | Real                      |
| Providers  | Dev adapters allowed (`console` OTP, `estimate` maps, `local` storage, `sandbox` payments) | **Real providers in test mode**            | Real providers, live mode |
| `NODE_ENV` | `development`                                                                              | `staging`                                  | `production`              |

The API refuses to start in `staging` or `production` with any development adapter. That is
deliberate: a missing integration stops the deploy instead of silently faking behaviour.

## What runs

| Component                        | Image / artefact                            | Notes                                                                                                                                        |
| -------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| API                              | `apps/api/Dockerfile`                       | Stateless; scale horizontally behind a load balancer. Needs WebSocket support (sticky sessions or the Socket.IO Redis adapter, see Scaling). |
| Migrations                       | Same image, `node dist/database/migrate.js` | One-off job before each API rollout.                                                                                                         |
| Admin dashboard                  | `apps/admin/Dockerfile`                     | Next.js standalone. Restrict it to staff (VPN, IP allow-list or SSO proxy) in addition to MFA.                                               |
| PostgreSQL 16+ with PostGIS 3.4+ | Managed service                             | Point-in-time recovery on. Indian region.                                                                                                    |
| Redis 7                          | Managed service                             | Rate limits; future Socket.IO adapter and queues.                                                                                            |
| Object storage                   | S3-compatible, private bucket               | Driver documents. **S3 adapter not yet written** (blocker).                                                                                  |
| Passenger and driver apps        | EAS Build → Play Store / App Store          | `EXPO_PUBLIC_API_URL` must be https.                                                                                                         |

`infra/docker-compose.full.yml` runs the whole stack from the production images and was used to
verify them (see the last section).

## Configuration

All configuration is environment variables, validated at startup (`apps/api/src/config/env.ts`).
Secrets come from the platform's secret manager, never from files in the image or repo.

Required in every deployed environment: `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`,
`HASH_PEPPER`, `DATA_ENCRYPTION_KEY`, `OTP_PROVIDER` (real), `MAPS_PROVIDER=google` with
`GOOGLE_MAPS_API_KEY`, `STORAGE_PROVIDER=s3`, `PAYMENT_PROVIDER=razorpay` with its three keys,
`SHARE_LINK_BASE_URL` (https), `CORS_ORIGINS`, `TRUST_PROXY_HOPS` (match the load balancer),
`PUSH_PROVIDER=expo` (plus `EXPO_ACCESS_TOKEN` if the Expo project enforces it).
Optional: `ANDROID_APP_LINK_SHA256` and `IOS_TEAM_ID` to serve the app-link verification files.

The mobile apps are released separately from the API, through the stores: see MOBILE_RELEASE.md.
Keep the API backwards compatible with the app versions still installed on phones.

Rotate `JWT_ACCESS_SECRET` to sign everyone out. Never rotate `HASH_PEPPER` or
`DATA_ENCRYPTION_KEY` without a migration: stored hashes and encrypted TOTP secrets depend on them.

## Release procedure

1. CI green on `main`: audit, lint, typecheck, migration drift, unit and integration tests,
   app bundles, admin build, Docker images, CodeQL.
2. Build and tag images with the git SHA. Push to the registry.
3. **Staging:** run the migration job, deploy the API and admin, run the smoke checks below.
4. **Production:** take an on-demand database snapshot, run the migration job, then roll the API
   out gradually (one instance, check health and error rate, then the rest), then the admin.
5. Smoke checks: `/health/ready` is 200; staff sign-in works; a synthetic test account can quote
   (no booking in production); the dashboard incident queue loads.

### Migrations

- Migrations are forward-only SQL files in `apps/api/drizzle/`, applied in order and recorded in
  `drizzle.__drizzle_migrations`. Running them twice is a no-op.
- Write them **expand → migrate → contract**. Add new columns or tables (nullable or with a
  default) first and deploy code that writes both shapes. Remove the old shape only in a later
  release. That way the previous API version keeps working during a rollout and after a rollback.
- Never edit a migration that has run anywhere shared. Add a new one.

## Rollback

- **Application:** redeploy the previous image tag. Because migrations are expand-first, the
  previous version runs against the newer schema.
- **Bad migration:** do not hand-edit tables. Write a corrective forward migration. If data was
  damaged, restore to a new instance from point-in-time recovery to just before the migration,
  then copy the affected rows back, reconciling ledger effects by adding new entries (the
  ledger is append-only by design).
- **Mobile apps:** cannot be rolled back on devices. Keep the API backward compatible with the
  last two app versions, and use a minimum-version check before forcing upgrades (not yet built).

## Backups and recovery

- Managed Postgres with automated daily snapshots and point-in-time recovery (7-35 days per
  policy). Also take a nightly logical dump (`pg_dump -Fc`) to separate storage in another region.
- **Restore drill:** run one quarterly and record it here.

### Drill log

| Date       | What                                                                        | Result                                                                                                                                                                                                  |
| ---------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-30 | Local: `pg_dump -Fc` of the dev database → `pg_restore` into a new database | Row counts identical for users, rides, audit_logs, staff, pricing, migrations and triggers (6/6). PostGIS working. The append-only trigger still blocked `DELETE FROM audit_logs` on the restored copy. |

## Verified locally (2026-10-30)

`docker compose -f infra/docker-compose.full.yml --env-file infra/full.env up --build`:

- The migration job ran and exited 0. The API and admin became healthy (healthchecks passing).
- `/health/ready` returned `{"database":"ok","redis":"ok"}`. The API process runs as `node`, not
  root, and logs JSON.
- Image sizes: API 378 MB, admin 302 MB.
- Found and fixed during this check: pretty logging depended on a dev-only package; it is now
  opt-in (`LOG_PRETTY`).

## Scaling notes

- The API is stateless apart from WebSockets. Before running more than one instance, add the
  Socket.IO Redis adapter (or sticky sessions) so pushes reach clients connected to any instance.
- The dispatch sweeper and maintenance jobs are safe on many instances (`SKIP LOCKED`, advisory
  locks).
- Rate-limit counters are in Redis and shared across instances.
- Tune `DATABASE_POOL_MAX` so that instances × pool stays under the database connection limit.
  Consider PgBouncer at scale.

## Expected running costs (pilot, rough order of magnitude; verify current pricing)

| Item                                      | Basis                                                       | Indicative monthly                        |
| ----------------------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| Managed Postgres (2 vCPU, 4-8 GB, Mumbai) | Small instance + storage + backups                          | ₹6,000-15,000                             |
| Managed Redis (small)                     |                                                             | ₹2,000-5,000                              |
| Containers (2 API + 1 admin, small)       |                                                             | ₹4,000-12,000                             |
| Object storage                            | A few GB of documents                                       | < ₹500                                    |
| Google Maps Platform                      | Routes + Places per quote/search; the largest variable cost | Depends on volume; budget alerts required |
| SMS (DLT-registered OTP)                  | Per message                                                 | ~₹0.15-0.30 per SMS                       |
| Razorpay                                  | Per transaction fee on online payments                      | Commonly ~2% (verify contract)            |
| Error tracking, uptime monitoring         | Free tiers possible at pilot scale                          | ₹0-5,000                                  |
