import { eq } from 'drizzle-orm';
import { notifications, safetyIncidents } from '../src/database/schema';
import {
  approvedDriver,
  bearer,
  bookRide,
  completeRide,
  createTestApp,
  currentOffer,
  readyPassenger,
  resetDatabase,
  seed,
  TestContext,
  testPhone,
} from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.db);
  await seed(ctx);
});

async function assignedRide(n = 1) {
  const p = await readyPassenger(ctx, n);
  const d = await approvedDriver(ctx, n + 1);
  const ride = await bookRide(ctx, p);
  const offer = await currentOffer(ctx, d);
  await ctx.http
    .post(`/v1/driver/offers/${offer!.id}/accept`)
    .set(bearer(d.accessToken))
    .expect(200);
  return { p, d, rideId: ride.id };
}

describe('trusted contacts', () => {
  it('adds up to five contacts and refuses duplicates and your own number', async () => {
    const p = await readyPassenger(ctx, 1);
    const auth = bearer(p.accessToken);
    for (let i = 0; i < 5; i++) {
      await ctx.http
        .post('/v1/me/trusted-contacts')
        .set(auth)
        .send({ name: `Contact ${i}`, phone: testPhone(100 + i) })
        .expect(201);
    }
    const sixth = await ctx.http
      .post('/v1/me/trusted-contacts')
      .set(auth)
      .send({ name: 'Six', phone: testPhone(200) })
      .expect(422);
    expect(sixth.body.error.code).toBe('TOO_MANY_CONTACTS');
    const list = await ctx.http.get('/v1/me/trusted-contacts').set(auth).expect(200);
    expect(list.body).toHaveLength(5);

    await ctx.http.delete(`/v1/me/trusted-contacts/${list.body[0].id}`).set(auth).expect(204);
    await ctx.http
      .post('/v1/me/trusted-contacts')
      .set(auth)
      .send({ name: 'Dup', phone: testPhone(101) })
      .expect(409);
    await ctx.http
      .post('/v1/me/trusted-contacts')
      .set(auth)
      .send({ name: 'Me', phone: testPhone(1) })
      .expect(422);
  });
});

describe('SOS', () => {
  it('records a critical incident on the current ride and reports contact delivery honestly', async () => {
    const { p, rideId } = await assignedRide();
    await ctx.http
      .post('/v1/me/trusted-contacts')
      .set(bearer(p.accessToken))
      .send({ name: 'Amma', phone: testPhone(50) });

    const res = await ctx.http
      .post('/v1/safety/sos')
      .set(bearer(p.accessToken))
      .send({ lat: 12.9756, lng: 77.6066 })
      .expect(201);
    expect(res.body.incident).toMatchObject({
      type: 'SOS',
      severity: 'CRITICAL',
      status: 'OPEN',
      rideId,
      responseInitiatedAt: null,
    });
    expect(res.body.trustedContacts).toMatchObject({
      saved: 1,
      sent: 0,
      status: 'NOT_SENT',
      reason: 'SMS_PROVIDER_NOT_CONFIGURED',
    });
    // Must not claim a response that has not happened.
    expect(res.body.message).not.toMatch(/responding|police|on the way/i);
    expect(res.body.emergencyNumber).toBe('112');

    const [sms] = await ctx.db.select().from(notifications);
    expect(sms).toMatchObject({
      channel: 'SMS',
      status: 'SKIPPED',
      lastError: 'SMS_PROVIDER_NOT_CONFIGURED',
    });

    const again = await ctx.http
      .post('/v1/safety/sos')
      .set(bearer(p.accessToken))
      .send({})
      .expect(201);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.incident.id).toBe(res.body.incident.id);
    expect(again.body.incident.timeline.map((e: { action: string }) => e.action)).toEqual([
      'CREATED',
      'SOS_REPEATED',
    ]);
  });

  it('works without a ride and for drivers', async () => {
    const p = await readyPassenger(ctx, 1);
    const noRide = await ctx.http
      .post('/v1/safety/sos')
      .set(bearer(p.accessToken))
      .send({})
      .expect(201);
    expect(noRide.body.incident.rideId).toBeNull();
    expect(noRide.body.trustedContacts.status).toBe('NO_CONTACTS_SAVED');

    const { d, rideId } = await assignedRide(5);
    const driverSos = await ctx.http
      .post('/v1/safety/sos')
      .set(bearer(d.accessToken))
      .send({})
      .expect(201);
    expect(driverSos.body.incident.rideId).toBe(rideId);
    const [row] = await ctx.db
      .select()
      .from(safetyIncidents)
      .where(eq(safetyIncidents.id, driverSos.body.incident.id));
    expect(row!.reporterRole).toBe('DRIVER');
    // Location falls back to the driver's last known position.
    expect(row!.location).not.toBeNull();
  });

  it("does not attach an SOS to someone else's ride", async () => {
    const { rideId } = await assignedRide();
    const other = await readyPassenger(ctx, 9);
    await ctx.http
      .post('/v1/safety/sos')
      .set(bearer(other.accessToken))
      .send({ rideId })
      .expect(404);
  });
});

describe('incident reports', () => {
  it('lets the reporter, and only the reporter, follow an incident', async () => {
    const { p, rideId } = await assignedRide();
    const created = await ctx.http
      .post('/v1/safety/incidents')
      .set(bearer(p.accessToken))
      .send({ type: 'ROUTE_DEVIATION', rideId, description: 'Driver took an unfamiliar road' })
      .expect(201);
    expect(created.body).toMatchObject({ severity: 'HIGH', status: 'OPEN' });
    const mine = await ctx.http.get('/v1/safety/incidents').set(bearer(p.accessToken)).expect(200);
    expect(mine.body).toHaveLength(1);
    const other = await readyPassenger(ctx, 9);
    await ctx.http
      .get(`/v1/safety/incidents/${created.body.id}`)
      .set(bearer(other.accessToken))
      .expect(404);
  });
});

describe('trip sharing', () => {
  it('shares vehicle and progress without personal contact details, and can be revoked', async () => {
    const { p, rideId } = await assignedRide();
    const share = await ctx.http
      .post(`/v1/rides/${rideId}/share`)
      .set(bearer(p.accessToken))
      .expect(201);
    const token = (share.body.url as string).split('/').pop()!;

    const view = await ctx.http.get(`/v1/public/trips/${token}`).expect(200);
    expect(view.body).toMatchObject({
      status: 'DRIVER_ASSIGNED',
      driver: { vehicle: { registrationNumber: 'KA01TS0002' } },
    });
    expect(JSON.stringify(view.body)).not.toMatch(/\+91|phone|pin/i);

    await ctx.http.delete(`/v1/rides/${rideId}/share`).set(bearer(p.accessToken)).expect(204);
    await ctx.http.get(`/v1/public/trips/${token}`).expect(404);
    await ctx.http.get('/v1/public/trips/not-a-real-token').expect(404);
  });

  it('only the passenger can share her ride', async () => {
    const { d, rideId } = await assignedRide();
    const other = await readyPassenger(ctx, 9);
    await ctx.http.post(`/v1/rides/${rideId}/share`).set(bearer(other.accessToken)).expect(404);
    await ctx.http.post(`/v1/rides/${rideId}/share`).set(bearer(d.accessToken)).expect(403);
  });
});

describe('ratings', () => {
  it('allows one rating per side after completion and updates the driver average', async () => {
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);
    const rideId = await completeRide(ctx, p, d);
    await ctx.http
      .post(`/v1/rides/${rideId}/rating`)
      .set(bearer(p.accessToken))
      .send({ stars: 4 })
      .expect(201);
    const twice = await ctx.http
      .post(`/v1/rides/${rideId}/rating`)
      .set(bearer(p.accessToken))
      .send({ stars: 5 })
      .expect(409);
    expect(twice.body.error.code).toBe('ALREADY_RATED');
    await ctx.http
      .post(`/v1/rides/${rideId}/rating`)
      .set(bearer(d.accessToken))
      .send({ stars: 5 })
      .expect(201);
    await ctx.http
      .post(`/v1/rides/${rideId}/rating`)
      .set(bearer(p.accessToken))
      .send({ stars: 9 })
      .expect(400);

    const ride = await ctx.http.get(`/v1/rides/${rideId}`).set(bearer(p.accessToken));
    expect(ride.body.driver).toMatchObject({ rating: 4, ratingCount: 1 });
  });

  it('refuses rating before the ride is completed', async () => {
    const { p, rideId } = await assignedRide();
    await ctx.http
      .post(`/v1/rides/${rideId}/rating`)
      .set(bearer(p.accessToken))
      .send({ stars: 5 })
      .expect(409);
  });
});

describe('support tickets', () => {
  it('creates, lists and replies, privately per user', async () => {
    const p = await readyPassenger(ctx, 1);
    const t = await ctx.http
      .post('/v1/support/tickets')
      .set(bearer(p.accessToken))
      .send({
        category: 'LOST_ITEM',
        subject: 'Left my bag',
        message: 'Black bag on the back seat',
      })
      .expect(201);
    expect(t.body).toMatchObject({
      status: 'OPEN',
      priority: 'NORMAL',
      messages: [{ fromSupport: false }],
    });
    await ctx.http
      .post(`/v1/support/tickets/${t.body.id}/messages`)
      .set(bearer(p.accessToken))
      .send({ body: 'Any update?' })
      .expect(201);
    expect(
      (await ctx.http.get('/v1/support/tickets').set(bearer(p.accessToken))).body,
    ).toHaveLength(1);

    const other = await readyPassenger(ctx, 9);
    await ctx.http
      .get(`/v1/support/tickets/${t.body.id}`)
      .set(bearer(other.accessToken))
      .expect(404);
    await ctx.http
      .post(`/v1/support/tickets/${t.body.id}/messages`)
      .set(bearer(other.accessToken))
      .send({ body: 'hi' })
      .expect(404);
  });

  it('gives safety tickets urgent priority', async () => {
    const p = await readyPassenger(ctx, 1);
    const t = await ctx.http
      .post('/v1/support/tickets')
      .set(bearer(p.accessToken))
      .send({ category: 'SAFETY', subject: 'Felt unsafe', message: 'Driver made remarks' })
      .expect(201);
    expect(t.body.priority).toBe('URGENT');
  });
});
