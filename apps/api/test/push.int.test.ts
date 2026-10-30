import { and, eq } from 'drizzle-orm';
import { Env } from '../src/config/env';
import { notifications, pushTokens } from '../src/database/schema';
import { InMemoryPushSender, PUSH_SENDER } from '../src/notifications/push-sender';
import {
  approvedDriver,
  bearer,
  bookRide,
  createTestApp,
  currentOffer,
  login,
  readyPassenger,
  resetDatabase,
  seed,
  TestContext,
  testPhone,
} from './helpers';

let ctx: TestContext;
let sender: InMemoryPushSender;

beforeAll(async () => {
  ctx = await createTestApp();
  sender = ctx.app.get<InMemoryPushSender>(PUSH_SENDER);
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.db);
  await seed(ctx);
  sender.sent.length = 0;
  sender.goneTokens.clear();
});

const token = (n: number) => `ExponentPushToken[test-device-${String(n).padStart(6, '0')}]`;

const register = (accessToken: string, n: number, platform = 'ANDROID') =>
  ctx.http
    .put('/v1/me/push-token')
    .set(bearer(accessToken))
    .send({ token: token(n), platform });

/** Pushes are sent after the request returns; wait for them instead of sleeping blindly. */
async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > until) throw new Error('Timed out waiting for push');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('push tokens', () => {
  it('registers a device once, and rejects anything that is not an Expo token', async () => {
    const p = await login(ctx, testPhone(1));
    await register(p.accessToken, 1).expect(204);
    await register(p.accessToken, 1).expect(204);
    await ctx.http
      .put('/v1/me/push-token')
      .set(bearer(p.accessToken))
      .send({ token: 'not-a-token', platform: 'ANDROID' })
      .expect(400);
    await ctx.http
      .put('/v1/me/push-token')
      .send({ token: token(1), platform: 'IOS' })
      .expect(401);

    const rows = await ctx.db.select().from(pushTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: p.userId, app: 'PASSENGER', platform: 'ANDROID' });
  });

  it('moves a token to whoever signs in on that phone next', async () => {
    const first = await login(ctx, testPhone(1));
    const second = await login(ctx, testPhone(2));
    await register(first.accessToken, 1).expect(204);
    await register(second.accessToken, 1).expect(204);
    const rows = await ctx.db.select().from(pushTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(second.userId);
  });

  it('forgets the device on sign-out and on explicit removal', async () => {
    const p = await login(ctx, testPhone(1));
    await register(p.accessToken, 1).expect(204);
    await ctx.http.post('/v1/auth/logout').set(bearer(p.accessToken)).expect(204);
    expect(await ctx.db.select().from(pushTokens)).toHaveLength(0);

    const again = await login(ctx, testPhone(1));
    await register(again.accessToken, 2).expect(204);
    await ctx.http
      .delete('/v1/me/push-token')
      .set(bearer(again.accessToken))
      .send({ token: token(2) })
      .expect(204);
    expect(await ctx.db.select().from(pushTokens)).toHaveLength(0);
  });
});

describe('ride pushes', () => {
  it('notifies the offered driver and the passenger, on the right app only', async () => {
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);
    await register(p.accessToken, 1, 'IOS').expect(204);
    await register(d.accessToken, 2).expect(204);

    const booked = await bookRide(ctx, p);
    await waitFor(() => sender.sent.some((m) => m.to === token(2)));
    const offerPush = sender.sent.find((m) => m.to === token(2))!;
    expect(offerPush).toMatchObject({ title: 'New ride request', data: { path: '/' } });
    expect(offerPush.channelId).toBe('rides');

    const offer = await currentOffer(ctx, d);
    await ctx.http
      .post(`/v1/driver/offers/${offer!.id}/accept`)
      .set(bearer(d.accessToken))
      .send({})
      .expect(200);
    await waitFor(() => sender.sent.some((m) => m.to === token(1)));
    expect(sender.sent.find((m) => m.to === token(1))).toMatchObject({
      title: 'Driver assigned',
      data: { path: `/ride/${booked.id}` },
    });
    // Lock-screen text never carries personal details.
    for (const m of sender.sent) {
      expect(`${m.title} ${m.body}`).not.toMatch(/Asha|Driver 2|KA01|\+91/);
    }
    const sentRows = () =>
      ctx.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.channel, 'PUSH'), eq(notifications.status, 'SENT')));
    await waitFor(async () => (await sentRows()).length >= 2);
  });

  it('drops tokens the push service rejects', async () => {
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);
    await register(d.accessToken, 2).expect(204);
    sender.goneTokens.add(token(2));

    await bookRide(ctx, p);
    const pushRows = () =>
      ctx.db.select().from(notifications).where(eq(notifications.channel, 'PUSH'));
    await waitFor(async () => (await pushRows()).some((r) => r.status === 'FAILED'));
    const rows = await pushRows();
    expect(rows.find((r) => r.template === 'ride_offer')).toMatchObject({
      status: 'FAILED',
      lastError: 'DeviceNotRegistered',
    });
    expect(await ctx.db.select().from(pushTokens)).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
  });

  it('records SKIPPED when the user has no device registered', async () => {
    const p = await readyPassenger(ctx, 1);
    await approvedDriver(ctx, 2);
    await bookRide(ctx, p);
    const pushRows = () =>
      ctx.db.select().from(notifications).where(eq(notifications.template, 'ride_offer'));
    await waitFor(async () => (await pushRows()).some((r) => r.status === 'SKIPPED'));
    expect((await pushRows())[0]).toMatchObject({ lastError: 'NO_DEVICE_REGISTERED' });
  });
});

describe('app link verification files', () => {
  it('are not served until signing details are configured', async () => {
    await ctx.http.get('/.well-known/assetlinks.json').expect(404);
    await ctx.http.get('/.well-known/apple-app-site-association').expect(404);
  });

  it('vouch for the passenger app once configured', async () => {
    const env = ctx.app.get(Env);
    const fp = Array.from({ length: 32 }, () => 'AB').join(':');
    env.ANDROID_APP_LINK_SHA256 = fp;
    env.IOS_TEAM_ID = 'ABCDE12345';
    try {
      const android = await ctx.http.get('/.well-known/assetlinks.json').expect(200);
      expect(android.body[0].target).toEqual({
        namespace: 'android_app',
        package_name: 'in.saheli.passenger',
        sha256_cert_fingerprints: [fp],
      });
      const ios = await ctx.http.get('/.well-known/apple-app-site-association').expect(200);
      expect(ios.headers['content-type']).toMatch(/application\/json/);
      expect(ios.body.applinks.details[0]).toEqual({
        appIDs: ['ABCDE12345.in.saheli.passenger'],
        components: [{ '/': '/ride/*' }],
      });
    } finally {
      env.ANDROID_APP_LINK_SHA256 = undefined;
      env.IOS_TEAM_ID = undefined;
    }
  });
});
