# Performance

Run: `npm run test:perf -w @saheli/api` (set `PERF_PAIRS` to change the size).

## Targets for the pilot

| Operation                                  | Target (p95, under normal load)                |
| ------------------------------------------ | ---------------------------------------------- |
| Fare quote                                 | < 500 ms (excluding the external routing call) |
| Booking including the first dispatch offer | < 1 s                                          |
| Driver accepts an offer                    | < 300 ms                                       |
| Location update ingest                     | < 200 ms                                       |
| No-contention single request               | < 100 ms                                       |

## Results, 2026-10-30

Single API process, in-process HTTP, `DATABASE_POOL_MAX=10`, Postgres 17 + PostGIS and Redis in
Docker Desktop on Windows 11 (16 GB RAM). 60 passengers and 60 drivers. All 60 requests of each
kind are fired **at the same instant**: a burst, not a sustained rate.

| Operation                    | n   | p50      | p95      | max      |
| ---------------------------- | --- | -------- | -------- | -------- |
| Quote, sequential (baseline) | 20  | 35 ms    | 109 ms   | 109 ms   |
| Quote, 60 at once            | 60  | 1,135 ms | 1,202 ms | 1,203 ms |
| Book + dispatch, 60 at once  | 60  | 3,290 ms | 3,388 ms | 3,457 ms |
| Accept offer, 60 at once     | 60  | 973 ms   | 1,019 ms | 1,019 ms |
| Location update, 60 at once  | 60  | 582 ms   | 636 ms   | 638 ms   |

**Correctness under load (asserted):** every one of the 60 concurrent bookings got exactly one
outstanding offer, each to a different driver. All 60 accepts succeeded. The database showed 60
assigned rides held by 60 distinct drivers. No double assignment.

## How to read this

- The sequential baseline (35 ms) is the cost of one request. Burst latency is queueing: 60
  requests share 10 database connections and one Node event loop. Docker Desktop on Windows also
  adds noticeable per-query overhead compared with Linux.
- Batching the quote path (one rules query, one multi-row insert, parallel lookups) halved burst
  quote latency (2.1 s → 1.1 s).
- **Not yet validated:** sustained-rate tests (k6 or similar against a deployed staging stack on
  Linux), WebSocket fan-out at scale, and multi-instance behaviour. Do these on staging before the
  pilot. Expect much better numbers on managed Linux infrastructure with a larger pool.

## Known levers, in order of expected value

1. Run several API instances, with a pool size sized to the database (see DEPLOYMENT.md).
2. Cache the session check (one indexed query per request) in Redis, with invalidation on logout or suspension.
3. Move ride location breadcrumbs and push fan-out to a queue.
4. Booking + dispatch: make the first dispatch attempt asynchronous so booking returns sooner.
