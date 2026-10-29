import { eq } from 'drizzle-orm';
import { auditLogs, pricingRules, staffUsers } from '../src/database/schema';
import { base32Decode, totpAt } from '../src/admin/staff-crypto';
import { hashPassword } from '../src/admin/staff-crypto';
import {
  approvedDriver,
  bearer,
  bookRide,
  completeRide,
  createTestApp,
  currentOffer,
  login,
  PLACES,
  readyPassenger,
  resetDatabase,
  seed,
  staffLogin,
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

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

describe('staff authentication', () => {
  async function createStaff(email: string, password: string) {
    await ctx.db
      .insert(staffUsers)
      .values({ email, fullName: 'Test', passwordHash: await hashPassword(password) });
  }

  it('requires a second factor, then MFA on every later sign-in', async () => {
    const s = await staffLogin(ctx, ['OPERATIONS']);
    const me = await ctx.http.get('/v1/admin/me').set(bearer(s.accessToken)).expect(200);
    expect(me.body.roles).toEqual(['OPERATIONS']);

    const [row] = await ctx.db.select().from(staffUsers).where(eq(staffUsers.id, s.staffId));
    expect(row!.totpSecretEncrypted).not.toContain(s.totpSecret);
    const again = await ctx.http
      .post('/v1/admin/auth/login')
      .send({ email: row!.email, password: 'correct horse battery 42' })
      .expect(200);
    expect(again.body.step).toBe('MFA_REQUIRED');
    await ctx.http
      .post('/v1/admin/auth/mfa/enroll')
      .send({ challengeToken: again.body.challengeToken })
      .expect(409);
    await ctx.http
      .post('/v1/admin/auth/mfa/verify')
      .send({ challengeToken: again.body.challengeToken, code: '000000' })
      .expect(401);
    const code = totpAt(base32Decode(s.totpSecret), Date.now() / 1000);
    await ctx.http
      .post('/v1/admin/auth/mfa/verify')
      .send({ challengeToken: again.body.challengeToken, code })
      .expect(200);

    const refreshed = await ctx.http
      .post('/v1/admin/auth/refresh')
      .send({ refreshToken: s.refreshToken })
      .expect(200);
    await ctx.http
      .post('/v1/admin/auth/refresh')
      .send({ refreshToken: s.refreshToken })
      .expect(401);
    await ctx.http.get('/v1/admin/me').set(bearer(refreshed.body.accessToken)).expect(200);
  });

  it('gives the same error for unknown email and wrong password, and locks after 5 failures', async () => {
    await createStaff('lock@test.invalid', 'right password 123');
    const unknown = await ctx.http
      .post('/v1/admin/auth/login')
      .send({ email: 'nobody@test.invalid', password: 'x' })
      .expect(401);
    const wrong = await ctx.http
      .post('/v1/admin/auth/login')
      .send({ email: 'lock@test.invalid', password: 'x' })
      .expect(401);
    expect(unknown.body.error.code).toBe(wrong.body.error.code);
    for (let i = 0; i < 4; i++) {
      await ctx.http
        .post('/v1/admin/auth/login')
        .send({ email: 'lock@test.invalid', password: 'x' })
        .expect(401);
    }
    const locked = await ctx.http
      .post('/v1/admin/auth/login')
      .send({ email: 'lock@test.invalid', password: 'right password 123' })
      .expect(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('keeps app and staff tokens apart', async () => {
    const s = await staffLogin(ctx, ['SUPER_ADMIN']);
    const user = await login(ctx, testPhone(1));
    await ctx.http.get('/v1/admin/me').set(bearer(user.accessToken)).expect(401);
    await ctx.http.get('/v1/me').set(bearer(s.accessToken)).expect(401);
  });

  it('cuts off a disabled staff member immediately', async () => {
    const admin = await staffLogin(ctx, ['SUPER_ADMIN']);
    const ops = await staffLogin(ctx, ['OPERATIONS']);
    await ctx.http
      .patch(`/v1/admin/staff/${ops.staffId}`)
      .set(bearer(admin.accessToken))
      .send({ status: 'DISABLED' })
      .expect(200);
    await ctx.http.get('/v1/admin/me').set(bearer(ops.accessToken)).expect(401);
    await ctx.http
      .patch(`/v1/admin/staff/${admin.staffId}`)
      .set(bearer(admin.accessToken))
      .send({ status: 'DISABLED' })
      .expect(409);
  });
});

describe('role-based access', () => {
  it('enforces least privilege on the server', async () => {
    const support = await staffLogin(ctx, ['SUPPORT']);
    const finance = await staffLogin(ctx, ['FINANCE']);
    const d = await approvedDriver(ctx, 2, { online: false });
    const zone = (
      await ctx.db.select({ zoneId: pricingRules.zoneId }).from(pricingRules).limit(1)
    )[0]!.zoneId;

    await ctx.http
      .post('/v1/admin/pricing')
      .set(bearer(support.accessToken))
      .send({ zoneId: zone })
      .expect(403);
    await ctx.http
      .post(`/v1/admin/drivers/${d.userId}/decision`)
      .set(bearer(finance.accessToken))
      .send({ decision: 'SUSPEND', reason: 'x'.repeat(5) })
      .expect(403);
    await ctx.http.get('/v1/admin/audit').set(bearer(finance.accessToken)).expect(403);
    await ctx.http.get('/v1/admin/staff').set(bearer(support.accessToken)).expect(403);

    // Support sees drivers with masked phone numbers.
    const list = await ctx.http
      .get('/v1/admin/drivers')
      .set(bearer(support.accessToken))
      .expect(200);
    expect(list.body[0].phone).toMatch(/•/);
  });
});

describe('driver review', () => {
  const PDF = Buffer.from('%PDF-1.7\n%test\n');
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

  it('approves a driver only after every check and document passes', async () => {
    const ops = await staffLogin(ctx, ['OPERATIONS']);
    const auth = bearer(ops.accessToken);
    const d = await login(ctx, testPhone(5), 'DRIVER');
    const dAuth = bearer(d.accessToken);
    await ctx.http.patch('/v1/me').set(dAuth).send({ fullName: 'Kavya Nair' });
    await ctx.http
      .put('/v1/driver/vehicle')
      .set(dAuth)
      .send({
        categoryCode: 'BIKE',
        registrationNumber: 'KA05XY0001',
        make: 'TVS',
        model: 'Jupiter',
        colour: 'Blue',
      });
    const ob = await ctx.http.get('/v1/driver/onboarding').set(dAuth);
    for (const type of ob.body.requiredDocuments as string[]) {
      await ctx.http
        .post('/v1/driver/documents')
        .set(dAuth)
        .field('type', type)
        .attach('file', type === 'PROFILE_PHOTO' ? PNG : PDF, 'f')
        .expect(201);
    }
    await ctx.http.post('/v1/driver/submit').set(dAuth).expect(200);

    const queue = await ctx.http
      .get('/v1/admin/drivers?status=PENDING_REVIEW')
      .set(auth)
      .expect(200);
    expect(queue.body.map((r: { id: string }) => r.id)).toContain(d.userId);

    const early = await ctx.http
      .post(`/v1/admin/drivers/${d.userId}/decision`)
      .set(auth)
      .send({ decision: 'APPROVE' })
      .expect(422);
    expect(early.body.error.code).toBe('VERIFICATION_INCOMPLETE');

    const detail = await ctx.http.get(`/v1/admin/drivers/${d.userId}`).set(auth).expect(200);
    for (const doc of detail.body.documents as { id: string }[]) {
      const file = await ctx.http
        .get(`/v1/admin/documents/${doc.id}/content`)
        .set(auth)
        .expect(200);
      expect(file.headers['cache-control']).toBe('no-store');
      await ctx.http
        .post(`/v1/admin/documents/${doc.id}/review`)
        .set(auth)
        .send({ approve: true })
        .expect(200);
    }
    for (const check of ['IDENTITY', 'GENDER_ELIGIBILITY', 'DRIVING_LICENCE', 'BACKGROUND']) {
      await ctx.http
        .post(`/v1/admin/drivers/${d.userId}/checks/${check}`)
        .set(auth)
        .send({ status: 'PASSED', provider: 'manual-review' })
        .expect(201);
    }
    await ctx.http
      .post(`/v1/admin/drivers/${d.userId}/decision`)
      .set(auth)
      .send({ decision: 'APPROVE' })
      .expect(200);

    // Now she can work.
    await ctx.http.post('/v1/driver/availability').set(dAuth).send({ online: true }).expect(200);

    const views = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'driver_document.viewed'));
    expect(views.length).toBe(detail.body.documents.length);

    // Suspension takes her offline at once and blocks going online again.
    await ctx.http
      .post(`/v1/admin/drivers/${d.userId}/decision`)
      .set(auth)
      .send({ decision: 'SUSPEND', reason: 'Complaint under review' })
      .expect(200);
    const blocked = await ctx.http
      .post('/v1/driver/availability')
      .set(dAuth)
      .send({ online: true })
      .expect(403);
    expect(blocked.body.error.details.reasons).toContain('DRIVER_SUSPENDED');
  });
});

describe('safety operations', () => {
  it('moves an SOS through acknowledgement and a recorded response the passenger can see', async () => {
    const safety = await staffLogin(ctx, ['SAFETY']);
    const auth = bearer(safety.accessToken);
    const p = await readyPassenger(ctx, 1);
    const sos = await ctx.http
      .post('/v1/safety/sos')
      .set(bearer(p.accessToken))
      .send({})
      .expect(201);
    const id = sos.body.incident.id;

    const queue = await ctx.http.get('/v1/admin/incidents').set(auth).expect(200);
    expect(queue.body[0]).toMatchObject({ id, severity: 'CRITICAL', status: 'OPEN' });
    const detail = await ctx.http.get(`/v1/admin/incidents/${id}`).set(auth).expect(200);
    expect(detail.body.reporter.phone).toBe(testPhone(1));

    await ctx.http.post(`/v1/admin/incidents/${id}/status/acknowledge`).set(auth).expect(200);
    await ctx.http.post(`/v1/admin/incidents/${id}/status/respond`).set(auth).send({}).expect(400);
    await ctx.http
      .post(`/v1/admin/incidents/${id}/status/respond`)
      .set(auth)
      .send({ note: 'Called passenger; she is safe and waiting at a shop' })
      .expect(200);
    await ctx.http.post(`/v1/admin/incidents/${id}/status/close`).set(auth).expect(409);

    const mine = await ctx.http
      .get(`/v1/safety/incidents/${id}`)
      .set(bearer(p.accessToken))
      .expect(200);
    expect(mine.body.status).toBe('RESPONDING');
    expect(mine.body.responseInitiatedAt).not.toBeNull();
    // Staff notes are not exposed to the reporter.
    expect(JSON.stringify(mine.body)).not.toContain('waiting at a shop');

    await ctx.http
      .post(`/v1/admin/incidents/${id}/status/resolve`)
      .set(auth)
      .send({ note: 'Reached home safely' })
      .expect(200);
  });

  it('keeps internal ticket notes private from the user', async () => {
    const support = await staffLogin(ctx, ['SUPPORT']);
    const p = await readyPassenger(ctx, 1);
    const t = await ctx.http
      .post('/v1/support/tickets')
      .set(bearer(p.accessToken))
      .send({ category: 'PAYMENT', subject: 'Charged twice', message: 'Please check' });
    await ctx.http
      .post(`/v1/admin/tickets/${t.body.id}/messages`)
      .set(bearer(support.accessToken))
      .send({ body: 'Possible fraud pattern', internal: true })
      .expect(201);
    await ctx.http
      .post(`/v1/admin/tickets/${t.body.id}/messages`)
      .set(bearer(support.accessToken))
      .send({ body: 'We are checking with the bank' })
      .expect(201);
    const seen = await ctx.http
      .get(`/v1/support/tickets/${t.body.id}`)
      .set(bearer(p.accessToken))
      .expect(200);
    expect(seen.body.status).toBe('WAITING_ON_USER');
    expect(seen.body.messages.map((m: { body: string }) => m.body)).toEqual([
      'Please check',
      'We are checking with the bank',
    ]);
  });

  it('can end an in-progress ride and suspend an account', async () => {
    const ops = await staffLogin(ctx, ['OPERATIONS']);
    const auth = bearer(ops.accessToken);
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);
    const ride = await bookRide(ctx, p);
    const offer = await currentOffer(ctx, d);
    await ctx.http.post(`/v1/driver/offers/${offer!.id}/accept`).set(bearer(d.accessToken));

    const blocked = await ctx.http
      .post(`/v1/admin/users/${p.userId}/suspend`)
      .set(auth)
      .send({ reason: 'Abuse report' })
      .expect(409);
    expect(blocked.body.error.code).toBe('ACTIVE_RIDE');
    await ctx.http
      .post(`/v1/admin/rides/${ride.id}/cancel`)
      .set(auth)
      .send({ reason: 'Safety escalation' })
      .expect(200);
    await ctx.http
      .post(`/v1/admin/users/${p.userId}/suspend`)
      .set(auth)
      .send({ reason: 'Abuse report' })
      .expect(200);
    await ctx.http.get('/v1/me').set(bearer(p.accessToken)).expect(401);

    const detail = await ctx.http.get(`/v1/admin/rides/${ride.id}`).set(auth).expect(200);
    expect(detail.body).not.toHaveProperty('pickupPin');
    expect(detail.body.events.at(-1)).toMatchObject({ toStatus: 'CANCELLED', actorType: 'ADMIN' });
  });
});

describe('pricing, metrics and reports', () => {
  it('publishes a new price version without changing quotes already given', async () => {
    const finance = await staffLogin(ctx, ['FINANCE']);
    const p = await readyPassenger(ctx, 1);
    const before = await ctx.http
      .post('/v1/rides/quotes')
      .set(bearer(p.accessToken))
      .send({ pickup: PLACES.mgRoad, dropoff: PLACES.koramangala });
    const bikeBefore = before.body.options.find(
      (o: { categoryCode: string }) => o.categoryCode === 'BIKE',
    );

    const [v1] = await ctx.db
      .select()
      .from(pricingRules)
      .where(eq(pricingRules.categoryCode, 'BIKE'));
    const {
      id: _id,
      version: _v,
      createdAt: _c,
      createdBy: _b,
      effectiveFrom: _e,
      ...fields
    } = v1!;
    const published = await ctx.http
      .post('/v1/admin/pricing')
      .set(bearer(finance.accessToken))
      .send({ ...fields, perKmPaise: v1!.perKmPaise * 2, changeNote: 'Test increase' })
      .expect(201);
    expect(published.body.version).toBe(2);

    const after = await ctx.http
      .post('/v1/rides/quotes')
      .set(bearer(p.accessToken))
      .send({ pickup: PLACES.mgRoad, dropoff: PLACES.koramangala });
    const bikeAfter = after.body.options.find(
      (o: { categoryCode: string }) => o.categoryCode === 'BIKE',
    );
    expect(bikeAfter.totalPaise).toBeGreaterThan(bikeBefore.totalPaise);

    // The earlier quote still books at its original price.
    const booked = await ctx.http
      .post('/v1/rides')
      .set(bearer(p.accessToken))
      .set('Idempotency-Key', 'pricing-test-key-1')
      .send({ quoteId: bikeBefore.quoteId, paymentMethod: 'CASH' })
      .expect(201);
    expect(booked.body.quotedTotalPaise).toBe(bikeBefore.totalPaise);

    await ctx.http
      .post('/v1/admin/pricing')
      .set(bearer(finance.accessToken))
      .send({ ...fields, effectiveFrom: '2020-01-01T00:00:00Z', changeNote: 'Backdated' })
      .expect(422);
  });

  it('reports metrics from the database and exports rides without personal data', async () => {
    const admin = await staffLogin(ctx, ['SUPER_ADMIN']);
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);
    await completeRide(ctx, p, d);
    const m = await ctx.http
      .get(`/v1/admin/metrics?from=${today()}&to=${today()}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(m.body).toMatchObject({ passengers: 1, drivers: 1, completedRides: 1, activeRides: 0 });
    expect(m.body.offers).toMatchObject({ offered: 1, accepted: 1, acceptanceRate: 1 });

    const csv = await ctx.http
      .get(`/v1/admin/reports/rides.csv?from=${today()}&to=${today()}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(csv.text.split('\n')).toHaveLength(3);
    expect(csv.text).not.toMatch(/\+91|Asha|Driver 2/);

    const audit = await ctx.http
      .get('/v1/admin/audit?entityType=report')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(audit.body[0].action).toBe('report.rides_exported');
  });
});
