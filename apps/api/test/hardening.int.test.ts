import { eq, sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { RedisThrottlerStorage } from '../src/common/redis-throttler-storage';
import { auditLogs, driverDocuments, otpChallenges, users } from '../src/database/schema';
import { MaintenanceService } from '../src/maintenance/maintenance.service';
import {
  approvedDriver,
  bearer,
  bookRide,
  completeRide,
  createTestApp,
  login,
  readyPassenger,
  resetDatabase,
  seed,
  TestContext,
  testPhone,
} from './helpers';
import { TEST_ENV } from './test-env';

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

describe('Redis rate-limit storage', () => {
  it('counts across calls and blocks once the limit is passed', async () => {
    const redis = new Redis(TEST_ENV.REDIS_URL!);
    try {
      const storage = new RedisThrottlerStorage(redis);
      const key = `test-${Date.now()}`;
      const results = [];
      for (let i = 0; i < 4; i++)
        results.push(await storage.increment(key, 60_000, 3, 60_000, 'default'));
      expect(results.map((r) => r.totalHits)).toEqual([1, 2, 3, 4]);
      expect(results.slice(0, 3).every((r) => !r.isBlocked)).toBe(true);
      expect(results[3]!.isBlocked).toBe(true);
      expect(results[0]!.timeToExpire).toBeGreaterThan(55);
    } finally {
      await redis.quit();
    }
  });
});

describe('maintenance', () => {
  it('purges stale transient data and keeps fresh data', async () => {
    await ctx.http
      .post('/v1/auth/otp/request')
      .send({ phone: testPhone(1) })
      .expect(202);
    await ctx.http
      .post('/v1/auth/otp/request')
      .send({ phone: testPhone(2) })
      .expect(202);
    await ctx.db
      .update(otpChallenges)
      .set({ createdAt: new Date(Date.now() - 2 * 86_400_000) })
      .where(eq(otpChallenges.phoneE164, testPhone(1)));
    const report = await ctx.app.get(MaintenanceService).run();
    expect(report!.otpChallenges).toBe(1);
    expect(await ctx.db.select().from(otpChallenges)).toHaveLength(1);
  });

  it('expires documents and takes newly ineligible drivers offline', async () => {
    const d = await approvedDriver(ctx, 2);
    await ctx.db
      .update(driverDocuments)
      .set({ expiresOn: '2020-01-01' })
      .where(eq(driverDocuments.driverId, d.userId));
    const report = await ctx.app.get(MaintenanceService).run();
    expect(report!.documentsExpired).toBeGreaterThan(0);
    expect(report!.driversTakenOffline).toBe(1);
    const { rows } = await ctx.db.execute<{ is_online: boolean }>(
      sql`SELECT is_online FROM driver_availability WHERE driver_id = ${d.userId}`,
    );
    expect(rows[0]!.is_online).toBe(false);
    const [audit] = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'driver.taken_offline_ineligible'));
    expect(audit!.entityId).toBe(d.userId);
  });

  it('leaves a driver on an active ride online', async () => {
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);
    await bookRide(ctx, p); // offered and reserved
    await ctx.db
      .update(driverDocuments)
      .set({ expiresOn: '2020-01-01' })
      .where(eq(driverDocuments.driverId, d.userId));
    const report = await ctx.app.get(MaintenanceService).run();
    expect(report!.driversTakenOffline).toBe(0);
  });
});

describe('data rights', () => {
  it('exports a copy of personal data', async () => {
    const p = await readyPassenger(ctx, 1, 'Divya Menon');
    const d = await approvedDriver(ctx, 2);
    await completeRide(ctx, p, d);
    const res = await ctx.http.get('/v1/me/export').set(bearer(p.accessToken)).expect(200);
    expect(res.body.profile).toMatchObject({ phone: testPhone(1), fullName: 'Divya Menon' });
    expect(res.body.rides).toHaveLength(1);
    expect(res.body.consents.termsVersion).toBe(TEST_ENV.TERMS_VERSION);
  });

  it('deletes an account: anonymises it, signs out, and frees the number', async () => {
    const p = await readyPassenger(ctx, 1, 'Divya Menon');
    const d = await approvedDriver(ctx, 2);
    const rideId = await completeRide(ctx, p, d, 'CASH');

    await ctx.http
      .post('/v1/me/delete')
      .set(bearer(p.accessToken))
      .send({ confirm: 'yes' })
      .expect(400);
    await ctx.http
      .post('/v1/me/delete')
      .set(bearer(p.accessToken))
      .send({ confirm: 'DELETE' })
      .expect(409); // unpaid cash ride
    await ctx.http
      .post(`/v1/driver/rides/${rideId}/cash-collected`)
      .set(bearer(d.accessToken))
      .expect(200);
    await ctx.http
      .post('/v1/me/delete')
      .set(bearer(p.accessToken))
      .send({ confirm: 'DELETE' })
      .expect(200);

    const [row] = await ctx.db.select().from(users).where(eq(users.id, p.userId));
    expect(row).toMatchObject({
      status: 'DELETED',
      fullName: null,
      phoneE164: `deleted:${p.userId}`,
    });
    await ctx.http.get('/v1/me').set(bearer(p.accessToken)).expect(401);

    // The ride stays (for legal retention) but is no longer linked to a phone number.
    const { rows } = await ctx.db.execute(sql`SELECT 1 FROM rides WHERE id = ${rideId}`);
    expect(rows).toHaveLength(1);

    // The same number can sign up again as a new account.
    const again = await login(ctx, testPhone(1));
    expect(again.isNewUser).toBe(true);
    expect(again.userId).not.toBe(p.userId);
  });

  it("won't delete a driver who is still owed or owes money", async () => {
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);
    const rideId = await completeRide(ctx, p, d, 'CASH');
    await ctx.http
      .post(`/v1/driver/rides/${rideId}/cash-collected`)
      .set(bearer(d.accessToken))
      .expect(200);
    const res = await ctx.http
      .post('/v1/me/delete')
      .set(bearer(d.accessToken))
      .send({ confirm: 'DELETE' })
      .expect(409);
    expect(res.body.error.code).toBe('OUTSTANDING_BALANCE');
  });
});
