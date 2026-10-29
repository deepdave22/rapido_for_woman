import { sql } from 'drizzle-orm';
import {
  approvedDriver,
  bearer,
  createTestApp,
  currentOffer,
  idemKey,
  LoggedIn,
  PLACES,
  readyPassenger,
  resetDatabase,
  seed,
  TestContext,
} from './helpers';

/**
 * Concurrency and latency check, run on demand: npm run test:perf -w @saheli/api
 * In-process (no network hop), against the local Postgres/PostGIS and Redis.
 * Results are indicative only; see docs/PERFORMANCE.md for how to read them.
 */
const PAIRS = Number(process.env.PERF_PAIRS ?? 60);
// All test accounts sign in from one IP; lift the per-IP OTP cap for this run only.
process.env.OTP_MAX_SENDS_PER_IP_PER_HOUR = '1000';

let ctx: TestContext;
const timings: Record<string, number[]> = {};

async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    (timings[name] ??= []).push(performance.now() - start);
  }
}

function summary(name: string) {
  const xs = [...(timings[name] ?? [])].sort((a, b) => a - b);
  const pct = (p: number) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0;
  return {
    op: name,
    n: xs.length,
    p50: Math.round(pct(50)),
    p95: Math.round(pct(95)),
    max: Math.round(xs.at(-1) ?? 0),
  };
}

/** Spread points around central Bengaluru so many drivers are in range but not identical. */
const near = (i: number) => ({
  lat: PLACES.mgRoad.lat + ((i % 10) - 5) * 0.002,
  lng: PLACES.mgRoad.lng + (Math.floor(i / 10) - 3) * 0.002,
});

beforeAll(async () => {
  ctx = await createTestApp();
  await resetDatabase(ctx.db);
  await seed(ctx);
}, 120_000);

afterAll(async () => {
  console.table(Object.keys(timings).map(summary));
  await ctx.close();
});

describe(`load: ${PAIRS} passengers and ${PAIRS} drivers`, () => {
  let passengers: LoggedIn[] = [];
  let drivers: LoggedIn[] = [];

  it('sets up accounts', async () => {
    drivers = [];
    passengers = [];
    for (let i = 0; i < PAIRS; i++) {
      drivers.push(await approvedDriver(ctx, 5000 + i, { at: near(i) }));
      passengers.push(await readyPassenger(ctx, 1 + i));
    }
  }, 300_000);

  it('measures a single quote with no contention (baseline)', async () => {
    for (const p of passengers.slice(0, 20)) {
      await timed('quote (sequential)', () =>
        ctx.http
          .post('/v1/rides/quotes')
          .set(bearer(p.accessToken))
          .send({ pickup: PLACES.mgRoad, dropoff: PLACES.koramangala }),
      );
    }
  }, 120_000);

  it('serves concurrent quotes', async () => {
    const res = await Promise.all(
      passengers.map((p) =>
        timed('quote', () =>
          ctx.http
            .post('/v1/rides/quotes')
            .set(bearer(p.accessToken))
            .send({ pickup: PLACES.mgRoad, dropoff: PLACES.koramangala }),
        ),
      ),
    );
    expect(res.every((r) => r.status === 200)).toBe(true);
  }, 120_000);

  it('books concurrently, offers every ride to a distinct driver, and lets each accept once', async () => {
    const quotes = await Promise.all(
      passengers.map((p) =>
        ctx.http
          .post('/v1/rides/quotes')
          .set(bearer(p.accessToken))
          .send({ pickup: PLACES.mgRoad, dropoff: PLACES.koramangala }),
      ),
    );
    const booked = await Promise.all(
      passengers.map((p, i) =>
        timed('book+dispatch', () =>
          ctx.http
            .post('/v1/rides')
            .set(bearer(p.accessToken))
            .set('Idempotency-Key', idemKey())
            .send({ quoteId: quotes[i]!.body.options[0].quoteId, paymentMethod: 'CASH' }),
        ),
      ),
    );
    expect(booked.every((r) => r.status === 201)).toBe(true);

    const offers = await Promise.all(drivers.map((d) => currentOffer(ctx, d)));
    const offered = offers.filter((o) => o !== null);
    // With one driver per passenger, every ride gets exactly one outstanding offer.
    expect(new Set(offered.map((o) => o!.rideId)).size).toBe(PAIRS);

    const accepted = await Promise.all(
      drivers.map((d, i) =>
        offers[i]
          ? timed('accept', () =>
              ctx.http.post(`/v1/driver/offers/${offers[i]!.id}/accept`).set(bearer(d.accessToken)),
            )
          : null,
      ),
    );
    expect(accepted.filter((r) => r?.status === 200)).toHaveLength(PAIRS);

    const { rows } = await ctx.db.execute<{ rides: number; drivers: number }>(sql`
      SELECT count(*)::int AS rides, count(DISTINCT driver_id)::int AS drivers
        FROM rides WHERE status = 'DRIVER_ASSIGNED'`);
    expect(rows[0]).toEqual({ rides: PAIRS, drivers: PAIRS });
  }, 300_000);

  it('ingests concurrent location updates', async () => {
    const res = await Promise.all(
      drivers.map((d, i) =>
        timed('location', () =>
          ctx.http
            .post('/v1/driver/location')
            .set(bearer(d.accessToken))
            .send({ ...near(i + 1), accuracyM: 10, recordedAt: new Date().toISOString() }),
        ),
      ),
    );
    expect(res.every((r) => r.status === 202)).toBe(true);
  }, 120_000);
});
