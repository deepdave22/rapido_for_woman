import { normalizeIndianMobile } from '@saheli/domain';
import { eq } from 'drizzle-orm';
import { provisionReviewAccounts } from '../src/admin/review-accounts';
import { Env } from '../src/config/env';
import { auditLogs } from '../src/database/schema';
import { DispatchService } from '../src/dispatch/dispatch.service';
import {
  approvedDriver,
  bearer,
  bookRide,
  createTestApp,
  currentOffer,
  idemKey,
  login,
  PLACES,
  placeDriver,
  resetDatabase,
  seed,
  staffLogin,
  TestContext,
  testPhone,
} from './helpers';
import { TEST_ENV } from './test-env';

const TEST_TERMS = TEST_ENV.TERMS_VERSION;

let ctx: TestContext;
let env: Env;
const REVIEW_CODE = '583920';
const reviewPassenger = testPhone(901);
const reviewDriver = testPhone(902);

beforeAll(async () => {
  ctx = await createTestApp();
  env = ctx.app.get(Env);
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.db);
  await seed(ctx);
  env.REVIEW_LOGIN_PHONES = `${reviewPassenger},${reviewDriver}`;
  env.REVIEW_LOGIN_CODE = REVIEW_CODE;
});
afterEach(() => {
  env.REVIEW_LOGIN_PHONES = undefined;
  env.REVIEW_LOGIN_CODE = undefined;
});

const requestCode = async (phone: string) =>
  (await ctx.http.post('/v1/auth/otp/request').send({ phone }).expect(202)).body as {
    challengeId: string;
  };

const verify = (challengeId: string, code: string, app: 'PASSENGER' | 'DRIVER' = 'PASSENGER') =>
  ctx.http.post('/v1/auth/otp/verify').send({ challengeId, code, app });

async function reviewLogin(phone: string, app: 'PASSENGER' | 'DRIVER') {
  const { challengeId } = await requestCode(phone);
  const res = await verify(challengeId, REVIEW_CODE, app).expect(200);
  return { accessToken: res.body.accessToken as string, userId: res.body.user.id as string };
}

describe('review sign-in', () => {
  it('accepts the fixed code for a provisioned review number, without sending an SMS', async () => {
    await provisionReviewAccounts(ctx.db, { passengerPhone: reviewPassenger });
    const sent = await requestCode(reviewPassenger);
    expect(ctx.otp.lastCodeFor(normalizeIndianMobile(reviewPassenger))).toBeUndefined();

    const res = await verify(sent.challengeId, REVIEW_CODE).expect(200);
    expect(res.body.isNewUser).toBe(false);
    const audit = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'auth.review_code_issued'));
    expect(audit).toHaveLength(1);
  });

  it('sends a normal SMS code to a listed number that was never provisioned', async () => {
    const sent = await requestCode(reviewPassenger);
    const smsCode = ctx.otp.lastCodeFor(normalizeIndianMobile(reviewPassenger));
    expect(smsCode).toMatch(/^\d{6}$/);
    if (smsCode !== REVIEW_CODE) {
      await verify(sent.challengeId, REVIEW_CODE).expect(400);
    }
  });

  it('never applies to a real account, even if its number is listed by mistake', async () => {
    const real = testPhone(1);
    await login(ctx, real);
    env.REVIEW_LOGIN_PHONES = `${reviewPassenger},${real}`;
    await requestCode(real);
    expect(ctx.otp.lastCodeFor(normalizeIndianMobile(real))).toMatch(/^\d{6}$/);
    await expect(provisionReviewAccounts(ctx.db, { passengerPhone: real })).rejects.toThrow(
      /real account/,
    );
  });

  it('is off unless both the numbers and the code are configured', async () => {
    await provisionReviewAccounts(ctx.db, { passengerPhone: reviewPassenger });
    env.REVIEW_LOGIN_CODE = undefined;
    await requestCode(reviewPassenger);
    expect(ctx.otp.lastCodeFor(normalizeIndianMobile(reviewPassenger))).toMatch(/^\d{6}$/);
  });

  it('keeps the normal attempt limit', async () => {
    await provisionReviewAccounts(ctx.db, { passengerPhone: reviewPassenger });
    const { challengeId } = await requestCode(reviewPassenger);
    for (let i = 0; i < Number(env.OTP_MAX_ATTEMPTS); i++) {
      await verify(challengeId, '000001').expect(400);
    }
    const res = await verify(challengeId, REVIEW_CODE).expect(400);
    expect(res.body.error.code).toBe('OTP_INVALID_OR_EXPIRED');
  });
});

describe('review account isolation', () => {
  async function readyReviewPassenger() {
    await provisionReviewAccounts(ctx.db, { passengerPhone: reviewPassenger });
    const p = await reviewLogin(reviewPassenger, 'PASSENGER');
    await ctx.http
      .post('/v1/me/terms')
      .set(bearer(p.accessToken))
      .send({ termsVersion: TEST_TERMS })
      .expect(200);
    return { ...p, refreshToken: '', isNewUser: false };
  }

  async function onlineReviewDriver() {
    await provisionReviewAccounts(ctx.db, { driverPhone: reviewDriver, category: 'BIKE' });
    const d = await reviewLogin(reviewDriver, 'DRIVER');
    await ctx.http
      .post('/v1/driver/availability')
      .set(bearer(d.accessToken))
      .send({ online: true })
      .expect(200);
    await placeDriver(ctx, d.userId, PLACES.mgRoad);
    return { ...d, refreshToken: '', isNewUser: false };
  }

  it("never offers a reviewer's ride to a real driver", async () => {
    const realDriver = await approvedDriver(ctx, 2);
    const p = await readyReviewPassenger();

    const quote = await ctx.http
      .post('/v1/rides/quotes')
      .set(bearer(p.accessToken))
      .send({ pickup: PLACES.mgRoad, dropoff: PLACES.koramangala })
      .expect(200);
    expect(quote.body.options.every((o: { driversNearby: boolean }) => !o.driversNearby)).toBe(
      true,
    );

    await bookRide(ctx, p);
    await ctx.app.get(DispatchService).sweep();
    expect(await currentOffer(ctx, realDriver)).toBeNull();

    const reviewer = await onlineReviewDriver();
    await ctx.app.get(DispatchService).sweep();
    expect(await currentOffer(ctx, reviewer)).not.toBeNull();
  });

  it('never offers a real passenger to a review driver', async () => {
    const reviewer = await onlineReviewDriver();
    const real = await login(ctx, testPhone(3));
    await ctx.http
      .post('/v1/me/terms')
      .set(bearer(real.accessToken))
      .send({ termsVersion: TEST_TERMS })
      .expect(200);
    await bookRide(ctx, real);
    await ctx.app.get(DispatchService).sweep();
    expect(await currentOffer(ctx, reviewer)).toBeNull();
  });

  it('only allows cash rides', async () => {
    const p = await readyReviewPassenger();
    const quote = await ctx.http
      .post('/v1/rides/quotes')
      .set(bearer(p.accessToken))
      .send({ pickup: PLACES.mgRoad, dropoff: PLACES.koramangala })
      .expect(200);
    const res = await ctx.http
      .post('/v1/rides')
      .set(bearer(p.accessToken))
      .set('Idempotency-Key', idemKey())
      .send({ quoteId: quote.body.options[0].quoteId, paymentMethod: 'ONLINE' })
      .expect(422);
    expect(res.body.error.code).toBe('REVIEW_ACCOUNT_CASH_ONLY');
  });

  it('is visible to staff', async () => {
    await provisionReviewAccounts(ctx.db, { passengerPhone: reviewPassenger });
    const staff = await staffLogin(ctx, ['OPERATIONS']);
    const res = await ctx.http
      .get('/v1/admin/passengers')
      .set(bearer(staff.accessToken))
      .expect(200);
    const rows = (res.body.items ?? res.body) as { phone: string; reviewAccount: boolean }[];
    expect(rows.find((r) => r.phone === normalizeIndianMobile(reviewPassenger))).toMatchObject({
      reviewAccount: true,
    });
  });

  it('can be provisioned again after the reviewer deletes the account', async () => {
    const p = await readyReviewPassenger();
    await ctx.http
      .post('/v1/me/delete')
      .set(bearer(p.accessToken))
      .send({ confirm: 'DELETE' })
      .expect(200);
    const again = await provisionReviewAccounts(ctx.db, { passengerPhone: reviewPassenger });
    expect(again.passengerId).toBeDefined();
    await reviewLogin(reviewPassenger, 'PASSENGER');
  });
});
