import { eq } from 'drizzle-orm';
import { auditLogs, otpChallenges, users } from '../src/database/schema';
import { createTestApp, login, resetDatabase, TestContext, testPhone } from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.db);
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('phone OTP sign-in', () => {
  it('creates an account on first sign-in and returns the profile', async () => {
    const phone = testPhone(1);
    const first = await login(ctx, '99999 00001');
    expect(first.isNewUser).toBe(true);

    const me = await ctx.http.get('/v1/me').set(bearer(first.accessToken)).expect(200);
    expect(me.body).toMatchObject({
      id: first.userId,
      phone,
      roles: ['PASSENGER'],
      passenger: { eligibilityStatus: 'PENDING' },
      driver: null,
    });

    const second = await login(ctx, phone);
    expect(second.isNewUser).toBe(false);
    expect(second.userId).toBe(first.userId);
  });

  it('stores only a hash of the code', async () => {
    const phone = testPhone(2);
    await ctx.http.post('/v1/auth/otp/request').send({ phone }).expect(202);
    const code = ctx.otp.lastCodeFor(phone)!;
    const [row] = await ctx.db
      .select()
      .from(otpChallenges)
      .where(eq(otpChallenges.phoneE164, phone));
    expect(row!.codeHash).not.toContain(code);
    expect(row!.codeHash.length).toBeGreaterThan(20);
  });

  it('locks a challenge after the maximum wrong attempts, even for the right code', async () => {
    const phone = testPhone(3);
    const sent = await ctx.http.post('/v1/auth/otp/request').send({ phone }).expect(202);
    const code = ctx.otp.lastCodeFor(phone)!;
    const wrong = code === '000000' ? '111111' : '000000';

    for (let remaining = 4; remaining >= 0; remaining--) {
      const res = await ctx.http
        .post('/v1/auth/otp/verify')
        .send({ challengeId: sent.body.challengeId, code: wrong, app: 'PASSENGER' })
        .expect(400);
      expect(res.body.error).toMatchObject({
        code: 'OTP_INCORRECT',
        details: { attemptsRemaining: remaining },
      });
    }
    const res = await ctx.http
      .post('/v1/auth/otp/verify')
      .send({ challengeId: sent.body.challengeId, code, app: 'PASSENGER' })
      .expect(400);
    expect(res.body.error.code).toBe('OTP_INVALID_OR_EXPIRED');
  });

  it('accepts a code only once, even under concurrent requests', async () => {
    const phone = testPhone(4);
    const sent = await ctx.http.post('/v1/auth/otp/request').send({ phone }).expect(202);
    const code = ctx.otp.lastCodeFor(phone)!;
    const body = { challengeId: sent.body.challengeId, code, app: 'PASSENGER' };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => ctx.http.post('/v1/auth/otp/verify').send(body)),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(4);
  });

  it('limits how many codes one phone can request per hour', async () => {
    const phone = testPhone(5);
    for (let i = 0; i < 5; i++) {
      await ctx.http.post('/v1/auth/otp/request').send({ phone }).expect(202);
    }
    const res = await ctx.http.post('/v1/auth/otp/request').send({ phone }).expect(429);
    expect(res.body.error.code).toBe('OTP_RATE_LIMITED');
  });

  it('rejects invalid and non-Indian numbers with a clear error', async () => {
    const bad = await ctx.http.post('/v1/auth/otp/request').send({ phone: '12345' }).expect(400);
    expect(bad.body.error.code).toBe('INVALID_PHONE');
    const foreign = await ctx.http
      .post('/v1/auth/otp/request')
      .send({ phone: '+14155550123' })
      .expect(400);
    expect(foreign.body.error.code).toBe('UNSUPPORTED_COUNTRY');
  });

  it('rejects unknown fields instead of silently ignoring them', async () => {
    const res = await ctx.http
      .post('/v1/auth/otp/request')
      .send({ phone: testPhone(6), role: 'ADMIN' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('gives a driver sign-in the driver role and an onboarding profile', async () => {
    const driver = await login(ctx, testPhone(7), 'DRIVER');
    const me = await ctx.http.get('/v1/me').set(bearer(driver.accessToken)).expect(200);
    expect(me.body.roles).toEqual(['DRIVER']);
    expect(me.body.driver).toEqual({ status: 'ONBOARDING' });
  });
});

describe('sessions and tokens', () => {
  it('requires a token for protected routes', async () => {
    const res = await ctx.http.get('/v1/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    await ctx.http.get('/v1/me').set(bearer('not-a-jwt')).expect(401);
  });

  it('rotates refresh tokens and revokes the device when an old one is reused', async () => {
    const s = await login(ctx, testPhone(10));
    const r1 = await ctx.http
      .post('/v1/auth/refresh')
      .send({ refreshToken: s.refreshToken })
      .expect(200);
    expect(r1.body.refreshToken).not.toBe(s.refreshToken);
    await ctx.http.get('/v1/me').set(bearer(r1.body.accessToken)).expect(200);

    // Replaying the first token signals theft: the whole session is revoked.
    const replay = await ctx.http
      .post('/v1/auth/refresh')
      .send({ refreshToken: s.refreshToken })
      .expect(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    await ctx.http
      .post('/v1/auth/refresh')
      .send({ refreshToken: r1.body.refreshToken })
      .expect(401);
    const me = await ctx.http.get('/v1/me').set(bearer(r1.body.accessToken)).expect(401);
    expect(me.body.error.code).toBe('SESSION_REVOKED');

    const audit = await ctx.db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(eq(auditLogs.action, 'auth.session_revoked'));
    expect(audit).toEqual([{ metadata: { reason: 'refresh_token_reuse' } }]);
  });

  it('logs out immediately, without waiting for the access token to expire', async () => {
    const s = await login(ctx, testPhone(11));
    await ctx.http.post('/v1/auth/logout').set(bearer(s.accessToken)).expect(204);
    await ctx.http.get('/v1/me').set(bearer(s.accessToken)).expect(401);
  });

  it('lists devices and signs out another one', async () => {
    const phone = testPhone(12);
    const phoneA = await login(ctx, phone);
    const phoneB = await login(ctx, phone);
    const list = await ctx.http
      .get('/v1/auth/sessions')
      .set(bearer(phoneA.accessToken))
      .expect(200);
    expect(list.body).toHaveLength(2);
    const other = list.body.find((s: { current: boolean }) => !s.current);

    await ctx.http
      .delete(`/v1/auth/sessions/${other.id}`)
      .set(bearer(phoneA.accessToken))
      .expect(204);
    await ctx.http.get('/v1/me').set(bearer(phoneB.accessToken)).expect(401);
    await ctx.http.get('/v1/me').set(bearer(phoneA.accessToken)).expect(200);
  });

  it("cannot sign out another user's session", async () => {
    const alice = await login(ctx, testPhone(13));
    const bob = await login(ctx, testPhone(14));
    const bobSessions = await ctx.http.get('/v1/auth/sessions').set(bearer(bob.accessToken));
    await ctx.http
      .delete(`/v1/auth/sessions/${bobSessions.body[0].id}`)
      .set(bearer(alice.accessToken))
      .expect(404);
    await ctx.http.get('/v1/me').set(bearer(bob.accessToken)).expect(200);
  });

  it('blocks a suspended account at once and at next sign-in', async () => {
    const phone = testPhone(15);
    const s = await login(ctx, phone);
    await ctx.db.update(users).set({ status: 'SUSPENDED' }).where(eq(users.id, s.userId));

    const me = await ctx.http.get('/v1/me').set(bearer(s.accessToken)).expect(403);
    expect(me.body.error.code).toBe('ACCOUNT_SUSPENDED');

    const sent = await ctx.http.post('/v1/auth/otp/request').send({ phone }).expect(202);
    const res = await ctx.http
      .post('/v1/auth/otp/verify')
      .send({
        challengeId: sent.body.challengeId,
        code: ctx.otp.lastCodeFor(phone),
        app: 'PASSENGER',
      })
      .expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });
});

describe('profile', () => {
  it('updates allowed fields, rejects bad input and records an audit entry', async () => {
    const s = await login(ctx, testPhone(20));
    const res = await ctx.http
      .patch('/v1/me')
      .set(bearer(s.accessToken))
      .send({ fullName: 'Ananya Rao', preferredLanguage: 'hi-IN' })
      .expect(200);
    expect(res.body).toMatchObject({ fullName: 'Ananya Rao', preferredLanguage: 'hi-IN' });

    await ctx.http
      .patch('/v1/me')
      .set(bearer(s.accessToken))
      .send({ fullName: '<script>' })
      .expect(400);
    await ctx.http
      .patch('/v1/me')
      .set(bearer(s.accessToken))
      .send({ phone: '+919999999999' })
      .expect(400);

    const [entry] = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'user.profile_updated'));
    // Audit records which fields changed, never their values.
    expect(entry!.metadata).toEqual({ fields: ['fullName', 'preferredLanguage'] });
  });
});

describe('health', () => {
  it('reports readiness of the database and redis', async () => {
    await ctx.http.get('/health/live').expect(200);
    const res = await ctx.http.get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });
});
