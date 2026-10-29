import { eq, sql } from 'drizzle-orm';
import { DispatchService } from '../src/dispatch/dispatch.service';
import { rideAssignments, rideEvents, rides } from '../src/database/schema';
import {
  approvedDriver,
  bearer,
  bookRide,
  createTestApp,
  currentOffer,
  idemKey,
  PLACES,
  placeDriver,
  readyPassenger,
  resetDatabase,
  seed,
  TestContext,
} from './helpers';

let ctx: TestContext;
let dispatch: DispatchService;

beforeAll(async () => {
  ctx = await createTestApp();
  dispatch = ctx.app.get(DispatchService);
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.db);
  await seed(ctx);
});

const post = (token: string, url: string, body: object = {}) =>
  ctx.http.post(url).set(bearer(token)).send(body);

describe('quotes', () => {
  it('prices every category server-side and reports nearby drivers', async () => {
    const p = await readyPassenger(ctx, 1);
    await approvedDriver(ctx, 2, { category: 'BIKE', at: PLACES.mgRoad });
    const res = await post(p.accessToken, '/v1/rides/quotes', {
      pickup: PLACES.mgRoad,
      dropoff: PLACES.koramangala,
    }).expect(200);

    expect(res.body.route.provider).toBe('estimate-dev');
    expect(res.body.options.map((o: { categoryCode: string }) => o.categoryCode)).toEqual([
      'BIKE',
      'AUTO',
      'CAB',
    ]);
    const bike = res.body.options[0];
    expect(bike.driversNearby).toBe(true);
    expect(bike.pickupEtaSeconds).toBeGreaterThanOrEqual(60);
    expect(res.body.options[2].driversNearby).toBe(false);
    for (const o of res.body.options) {
      expect(Number.isInteger(o.totalPaise)).toBe(true);
      expect(o.totalPaise).toBe(o.breakdown.totalPaise);
    }
  });

  it('refuses trips outside the service area', async () => {
    const p = await readyPassenger(ctx, 1);
    const res = await post(p.accessToken, '/v1/rides/quotes', {
      pickup: PLACES.mgRoad,
      dropoff: PLACES.mumbai,
    }).expect(422);
    expect(res.body.error.code).toBe('OUTSIDE_SERVICE_AREA');
  });

  it('does not accept a client-supplied fare', async () => {
    const p = await readyPassenger(ctx, 1);
    const quote = await post(p.accessToken, '/v1/rides/quotes', {
      pickup: PLACES.mgRoad,
      dropoff: PLACES.koramangala,
    });
    await post(p.accessToken, '/v1/rides', {
      quoteId: quote.body.options[0].quoteId,
      paymentMethod: 'CASH',
      totalPaise: 1,
    })
      .set('Idempotency-Key', idemKey())
      .expect(400);
  });
});

describe('booking', () => {
  it('requires accepted terms', async () => {
    const { login, testPhone } = await import('./helpers');
    const p = await login(ctx, testPhone(9));
    const quote = await post(p.accessToken, '/v1/rides/quotes', {
      pickup: PLACES.mgRoad,
      dropoff: PLACES.koramangala,
    });
    const res = await post(p.accessToken, '/v1/rides', {
      quoteId: quote.body.options[0].quoteId,
      paymentMethod: 'CASH',
    })
      .set('Idempotency-Key', idemKey())
      .expect(403);
    expect(res.body.error.code).toBe('TERMS_NOT_ACCEPTED');
  });

  it('replays a retried booking instead of creating a second ride', async () => {
    const p = await readyPassenger(ctx, 1);
    const quote = await post(p.accessToken, '/v1/rides/quotes', {
      pickup: PLACES.mgRoad,
      dropoff: PLACES.koramangala,
    });
    const body = { quoteId: quote.body.options[0].quoteId, paymentMethod: 'CASH' };
    const key = idemKey();
    const first = await post(p.accessToken, '/v1/rides', body)
      .set('Idempotency-Key', key)
      .expect(201);
    const retry = await post(p.accessToken, '/v1/rides', body)
      .set('Idempotency-Key', key)
      .expect(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.headers['idempotent-replayed']).toBe('true');

    const changed = await post(p.accessToken, '/v1/rides', { ...body, paymentMethod: 'ONLINE' })
      .set('Idempotency-Key', key)
      .expect(422);
    expect(changed.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const [{ n }] = (await ctx.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM rides`))
      .rows as [{ n: number }];
    expect(n).toBe(1);
  });

  it('allows one live ride per passenger', async () => {
    const p = await readyPassenger(ctx, 1);
    await bookRide(ctx, p);
    const quote = await post(p.accessToken, '/v1/rides/quotes', {
      pickup: PLACES.mgRoad,
      dropoff: PLACES.koramangala,
    });
    const res = await post(p.accessToken, '/v1/rides', {
      quoteId: quote.body.options[1].quoteId,
      paymentMethod: 'CASH',
    })
      .set('Idempotency-Key', idemKey())
      .expect(409);
    expect(res.body.error.code).toBe('ACTIVE_RIDE_EXISTS');
  });

  it('rejects a quote that was already used or belongs to someone else', async () => {
    const a = await readyPassenger(ctx, 1);
    const b = await readyPassenger(ctx, 2);
    const quote = await post(a.accessToken, '/v1/rides/quotes', {
      pickup: PLACES.mgRoad,
      dropoff: PLACES.koramangala,
    });
    const res = await post(b.accessToken, '/v1/rides', {
      quoteId: quote.body.options[0].quoteId,
      paymentMethod: 'CASH',
    })
      .set('Idempotency-Key', idemKey())
      .expect(410);
    expect(res.body.error.code).toBe('QUOTE_EXPIRED');
  });
});

describe('full ride', () => {
  it('runs from booking to completion with PIN verification', async () => {
    const p = await readyPassenger(ctx, 1, 'Meera Iyer');
    const d = await approvedDriver(ctx, 2, { at: PLACES.mgRoad });

    const booked = await bookRide(ctx, p);
    expect(booked.status).toBe('SEARCHING');

    const offer = await currentOffer(ctx, d);
    expect(offer).toMatchObject({ rideId: booked.id });
    expect(offer!.estimatedEarningPaise).toBeGreaterThan(0);

    const accepted = await post(d.accessToken, `/v1/driver/offers/${offer!.id}/accept`).expect(200);
    expect(accepted.body).toMatchObject({ id: booked.id, status: 'DRIVER_ASSIGNED' });
    expect(accepted.body.passenger).toEqual({ firstName: 'Meera' });
    expect(accepted.body).not.toHaveProperty('pickupPin');

    const seen = await ctx.http
      .get(`/v1/rides/${booked.id}`)
      .set(bearer(p.accessToken))
      .expect(200);
    expect(seen.body.pickupPin).toMatch(/^\d{4}$/);
    expect(seen.body.driver).toMatchObject({
      verified: true,
      vehicle: { registrationNumber: 'KA01TS0002' },
    });
    const pin: string = seen.body.pickupPin;

    await post(d.accessToken, `/v1/driver/rides/${booked.id}/arriving`).expect(200);
    await post(d.accessToken, `/v1/driver/rides/${booked.id}/arrived`).expect(200);

    const early = await post(d.accessToken, `/v1/driver/rides/${booked.id}/start`).expect(422);
    expect(early.body.error.code).toBe('PICKUP_NOT_VERIFIED');

    const wrong = pin === '0000' ? '1111' : '0000';
    const bad = await post(d.accessToken, `/v1/driver/rides/${booked.id}/verify-pin`, {
      pin: wrong,
    }).expect(400);
    expect(bad.body.error).toMatchObject({
      code: 'PIN_INCORRECT',
      details: { attemptsRemaining: 4 },
    });
    await post(d.accessToken, `/v1/driver/rides/${booked.id}/verify-pin`, { pin }).expect(200);

    await post(d.accessToken, `/v1/driver/rides/${booked.id}/start`).expect(200);
    const afterStart = await ctx.http.get(`/v1/rides/${booked.id}`).set(bearer(p.accessToken));
    expect(afterStart.body.pickupPin).toBeNull();

    const done = await post(d.accessToken, `/v1/driver/rides/${booked.id}/complete`).expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.finalTotalPaise).toBeGreaterThanOrEqual(booked.quotedTotalPaise);
    expect(done.body.paymentStatus).toBe('PENDING');

    await post(d.accessToken, `/v1/driver/rides/${booked.id}/complete`).expect(409);

    const events = await ctx.db
      .select({ to: rideEvents.toStatus })
      .from(rideEvents)
      .where(eq(rideEvents.rideId, booked.id))
      .orderBy(rideEvents.id);
    expect(events.map((e) => e.to)).toEqual([
      'SEARCHING',
      'DRIVER_ASSIGNED',
      'DRIVER_ARRIVING',
      'DRIVER_ARRIVED',
      'IN_PROGRESS',
      'COMPLETED',
    ]);

    // The driver is free for new work again.
    const avail = await ctx.db.execute<{ active_ride_id: string | null }>(
      sql`SELECT active_ride_id FROM driver_availability WHERE driver_id = ${d.userId}`,
    );
    expect(avail.rows[0]!.active_ride_id).toBeNull();
  });

  it('will not mark arrival far from the pickup', async () => {
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2, { at: PLACES.mgRoad });
    const ride = await bookRide(ctx, p);
    const offer = await currentOffer(ctx, d);
    await post(d.accessToken, `/v1/driver/offers/${offer!.id}/accept`).expect(200);
    await placeDriver(ctx, d.userId, PLACES.koramangala);
    const res = await post(d.accessToken, `/v1/driver/rides/${ride.id}/arrived`).expect(422);
    expect(res.body.error.code).toBe('NOT_AT_PICKUP');
  });

  it('locks the PIN after five wrong attempts', async () => {
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);
    const ride = await bookRide(ctx, p);
    const offer = await currentOffer(ctx, d);
    await post(d.accessToken, `/v1/driver/offers/${offer!.id}/accept`).expect(200);
    await post(d.accessToken, `/v1/driver/rides/${ride.id}/arrived`).expect(200);
    const [row] = await ctx.db
      .select({ pin: rides.pickupPin })
      .from(rides)
      .where(eq(rides.id, ride.id));
    const wrong = row!.pin === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i++) {
      await post(d.accessToken, `/v1/driver/rides/${ride.id}/verify-pin`, { pin: wrong }).expect(
        400,
      );
    }
    const locked = await post(d.accessToken, `/v1/driver/rides/${ride.id}/verify-pin`, {
      pin: row!.pin,
    }).expect(423);
    expect(locked.body.error.code).toBe('PIN_LOCKED');
  });
});

describe('dispatch', () => {
  it('offers the nearest driver first', async () => {
    const p = await readyPassenger(ctx, 1);
    const far = await approvedDriver(ctx, 2, { at: { lat: 12.985, lng: 77.6066 } }); // ~1 km
    const near = await approvedDriver(ctx, 3, { at: { lat: 12.9758, lng: 77.6068 } }); // ~30 m
    await bookRide(ctx, p);
    expect(await currentOffer(ctx, near)).not.toBeNull();
    expect(await currentOffer(ctx, far)).toBeNull();
  });

  it('only dispatches drivers of the booked category', async () => {
    const p = await readyPassenger(ctx, 1);
    const cab = await approvedDriver(ctx, 2, { category: 'CAB' });
    await bookRide(ctx, p, 'BIKE');
    expect(await currentOffer(ctx, cab)).toBeNull();
  });

  it('moves to the next driver on rejection and on timeout', async () => {
    const p = await readyPassenger(ctx, 1);
    const d1 = await approvedDriver(ctx, 2, { at: { lat: 12.9757, lng: 77.6066 } });
    const d2 = await approvedDriver(ctx, 3, { at: { lat: 12.9775, lng: 77.6066 } });
    const d3 = await approvedDriver(ctx, 4, { at: { lat: 12.98, lng: 77.6066 } });
    await bookRide(ctx, p);

    const o1 = await currentOffer(ctx, d1);
    await post(d1.accessToken, `/v1/driver/offers/${o1!.id}/reject`).expect(204);
    const o2 = await currentOffer(ctx, d2);
    expect(o2).not.toBeNull();

    // Let d2's offer expire, then sweep.
    await ctx.db
      .update(rideAssignments)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(rideAssignments.id, o2!.id));
    await dispatch.sweep();
    expect(await currentOffer(ctx, d2)).toBeNull();
    expect(await currentOffer(ctx, d3)).not.toBeNull();
    const late = await post(d2.accessToken, `/v1/driver/offers/${o2!.id}/accept`).expect(409);
    expect(late.body.error.code).toBe('OFFER_NO_LONGER_AVAILABLE');
  });

  it('lets exactly one of two concurrent accepts win', async () => {
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);
    await bookRide(ctx, p);
    const offer = await currentOffer(ctx, d);
    const results = await Promise.all([
      post(d.accessToken, `/v1/driver/offers/${offer!.id}/accept`),
      post(d.accessToken, `/v1/driver/offers/${offer!.id}/accept`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("does not let a driver accept someone else's offer", async () => {
    const p = await readyPassenger(ctx, 1);
    const d1 = await approvedDriver(ctx, 2);
    const d2 = await approvedDriver(ctx, 3, { at: PLACES.koramangala });
    await bookRide(ctx, p);
    const offer = await currentOffer(ctx, d1);
    await post(d2.accessToken, `/v1/driver/offers/${offer!.id}/accept`).expect(409);
  });

  it('keeps searching, then ends as NO_DRIVER_FOUND after the search window', async () => {
    const p = await readyPassenger(ctx, 1);
    const ride = await bookRide(ctx, p);
    expect(ride.status).toBe('SEARCHING');
    await ctx.db
      .update(rides)
      .set({ searchStartedAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(rides.id, ride.id));
    await dispatch.sweep();
    const res = await ctx.http.get(`/v1/rides/${ride.id}`).set(bearer(p.accessToken)).expect(200);
    expect(res.body.status).toBe('NO_DRIVER_FOUND');
  });

  it('ignores drivers whose location is stale', async () => {
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);
    await ctx.db.execute(
      sql`UPDATE driver_locations SET recorded_at = now() - interval '10 minutes' WHERE driver_id = ${d.userId}`,
    );
    await bookRide(ctx, p);
    expect(await currentOffer(ctx, d)).toBeNull();
  });

  it('reassigns when the driver cancels before pickup, never back to the same driver', async () => {
    const p = await readyPassenger(ctx, 1);
    const d1 = await approvedDriver(ctx, 2, { at: { lat: 12.9757, lng: 77.6066 } });
    const d2 = await approvedDriver(ctx, 3, { at: { lat: 12.98, lng: 77.6066 } });
    const ride = await bookRide(ctx, p);
    const o1 = await currentOffer(ctx, d1);
    await post(d1.accessToken, `/v1/driver/offers/${o1!.id}/accept`).expect(200);

    await post(d1.accessToken, `/v1/driver/rides/${ride.id}/cancel`, {
      reason: 'Vehicle problem',
    }).expect(200);
    expect(await currentOffer(ctx, d1)).toBeNull();
    const o2 = await currentOffer(ctx, d2);
    expect(o2!.rideId).toBe(ride.id);
    await post(d2.accessToken, `/v1/driver/offers/${o2!.id}/accept`).expect(200);
    const res = await ctx.http.get(`/v1/rides/${ride.id}`).set(bearer(p.accessToken));
    expect(res.body.status).toBe('DRIVER_ASSIGNED');
    expect(res.body.driver.vehicle.registrationNumber).toBe('KA01TS0003');
  });
});

describe('cancellation', () => {
  it('is free while searching and charges after the free window', async () => {
    const p = await readyPassenger(ctx, 1);
    const ride = await bookRide(ctx, p);
    const free = await post(p.accessToken, `/v1/rides/${ride.id}/cancel`, {
      reason: 'Changed plans',
    }).expect(200);
    expect(free.body).toMatchObject({
      status: 'CANCELLED',
      cancellationFeePaise: 0,
      paymentStatus: 'WAIVED',
    });

    const d = await approvedDriver(ctx, 2);
    const ride2 = await bookRide(ctx, p);
    const offer = await currentOffer(ctx, d);
    await post(d.accessToken, `/v1/driver/offers/${offer!.id}/accept`).expect(200);
    await ctx.db
      .update(rides)
      .set({ driverAssignedAt: new Date(Date.now() - 5 * 60 * 1000) })
      .where(eq(rides.id, ride2.id));
    const charged = await post(p.accessToken, `/v1/rides/${ride2.id}/cancel`, {
      reason: 'Took too long',
    }).expect(200);
    expect(charged.body.cancellationFeePaise).toBe(1000);
    expect(await currentOffer(ctx, d)).toBeNull();
  });

  it('does not let a passenger cancel a trip in progress', async () => {
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);
    const ride = await bookRide(ctx, p);
    const offer = await currentOffer(ctx, d);
    await post(d.accessToken, `/v1/driver/offers/${offer!.id}/accept`);
    await post(d.accessToken, `/v1/driver/rides/${ride.id}/arrived`);
    const [row] = await ctx.db
      .select({ pin: rides.pickupPin })
      .from(rides)
      .where(eq(rides.id, ride.id));
    await post(d.accessToken, `/v1/driver/rides/${ride.id}/verify-pin`, { pin: row!.pin });
    await post(d.accessToken, `/v1/driver/rides/${ride.id}/start`).expect(200);
    const res = await post(p.accessToken, `/v1/rides/${ride.id}/cancel`, {
      reason: 'x'.repeat(5),
    }).expect(403);
    expect(res.body.error.code).toBe('TRANSITION_NOT_PERMITTED');
  });
});

describe('access control', () => {
  it("hides other passengers' rides and blocks cross-app calls", async () => {
    const a = await readyPassenger(ctx, 1);
    const b = await readyPassenger(ctx, 2);
    const d = await approvedDriver(ctx, 3);
    const ride = await bookRide(ctx, a);

    await ctx.http.get(`/v1/rides/${ride.id}`).set(bearer(b.accessToken)).expect(404);
    await post(b.accessToken, `/v1/rides/${ride.id}/cancel`, { reason: 'not mine' }).expect(404);
    // A driver-app token cannot use passenger routes and vice versa.
    await ctx.http.get('/v1/rides/active').set(bearer(d.accessToken)).expect(403);
    await ctx.http.get('/v1/driver/offers/current').set(bearer(a.accessToken)).expect(403);
  });

  it('stops a driver who is not assigned from moving the ride', async () => {
    const p = await readyPassenger(ctx, 1);
    const d1 = await approvedDriver(ctx, 2);
    const d2 = await approvedDriver(ctx, 3, { at: PLACES.koramangala });
    const ride = await bookRide(ctx, p);
    const offer = await currentOffer(ctx, d1);
    await post(d1.accessToken, `/v1/driver/offers/${offer!.id}/accept`).expect(200);
    await post(d2.accessToken, `/v1/driver/rides/${ride.id}/arriving`).expect(404);
    await post(d2.accessToken, `/v1/driver/rides/${ride.id}/cancel`, { reason: 'hijack' }).expect(
      404,
    );
  });
});
