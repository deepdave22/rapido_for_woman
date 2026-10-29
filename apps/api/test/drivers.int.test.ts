import { io, Socket } from 'socket.io-client';
import { AddressInfo } from 'node:net';
import {
  approvedDriver,
  bearer,
  bookRide,
  createTestApp,
  login,
  PLACES,
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

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = Buffer.from('%PDF-1.7\n%test\n');

describe('driver onboarding', () => {
  it('walks a new driver from sign-up to review submission', async () => {
    const d = await login(ctx, testPhone(1), 'DRIVER');
    const auth = bearer(d.accessToken);

    const start = await ctx.http.get('/v1/driver/onboarding').set(auth).expect(200);
    expect(start.body).toMatchObject({ status: 'ONBOARDING', vehicle: null, canSubmit: false });

    await ctx.http
      .put('/v1/driver/vehicle')
      .set(auth)
      .send({
        categoryCode: 'AUTO',
        registrationNumber: 'ka 01 ab 1234',
        make: 'Bajaj',
        model: 'RE',
        colour: 'Green',
      })
      .expect(200);
    const mid = await ctx.http.get('/v1/driver/onboarding').set(auth);
    expect(mid.body.vehicle.registrationNumber).toBe('KA01AB1234');
    expect(mid.body.requiredDocuments).toContain('VEHICLE_PERMIT');

    for (const type of mid.body.requiredDocuments as string[]) {
      await ctx.http
        .post('/v1/driver/documents')
        .set(auth)
        .field('type', type)
        .field('expiresOn', '2030-01-01')
        .attach('file', type === 'PROFILE_PHOTO' ? PNG : PDF, 'doc')
        .expect(201);
    }
    const early = await ctx.http.post('/v1/driver/submit').set(auth).expect(422);
    expect(early.body.error.code).toBe('ONBOARDING_INCOMPLETE'); // name still missing

    await ctx.http.patch('/v1/me').set(auth).send({ fullName: 'Lakshmi Devi' }).expect(200);
    const submitted = await ctx.http.post('/v1/driver/submit').set(auth).expect(200);
    expect(submitted.body.status).toBe('PENDING_REVIEW');
    expect(submitted.body.checks.every((c: { status: string }) => c.status === 'PENDING')).toBe(
      true,
    );

    // Under review: the driver cannot go online or swap documents.
    const online = await ctx.http
      .post('/v1/driver/availability')
      .set(auth)
      .send({ online: true })
      .expect(403);
    expect(online.body.error.code).toBe('NOT_ELIGIBLE_TO_DRIVE');
    expect(online.body.error.details.reasons).toContain('DRIVER_PENDING_REVIEW');
    await ctx.http
      .post('/v1/driver/documents')
      .set(auth)
      .field('type', 'PROFILE_PHOTO')
      .attach('file', PNG, 'p.png')
      .expect(409);
  });

  it('checks file contents, not the declared type', async () => {
    const d = await login(ctx, testPhone(1), 'DRIVER');
    const res = await ctx.http
      .post('/v1/driver/documents')
      .set(bearer(d.accessToken))
      .field('type', 'IDENTITY_PROOF')
      .attach('file', Buffer.from('<html>not a pdf</html>'), {
        filename: 'id.pdf',
        contentType: 'application/pdf',
      })
      .expect(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('refuses an already-expired document', async () => {
    const d = await login(ctx, testPhone(1), 'DRIVER');
    const res = await ctx.http
      .post('/v1/driver/documents')
      .set(bearer(d.accessToken))
      .field('type', 'DRIVING_LICENCE')
      .field('expiresOn', '2020-01-01')
      .attach('file', PDF, 'dl.pdf')
      .expect(422);
    expect(res.body.error.code).toBe('DOCUMENT_EXPIRED');
  });

  it('keeps an approved driver offline once a required document expires', async () => {
    const d = await approvedDriver(ctx, 2, { online: false });
    await ctx.db.execute(
      (await import('drizzle-orm'))
        .sql`UPDATE driver_documents SET expires_on = '2020-01-01' WHERE driver_id = ${d.userId} AND type = 'DRIVING_LICENCE'`,
    );
    const res = await ctx.http
      .post('/v1/driver/availability')
      .set(bearer(d.accessToken))
      .send({ online: true })
      .expect(403);
    expect(res.body.error.details.reasons).toContain('DOCUMENT_DRIVING_LICENCE_EXPIRED');
  });
});

describe('location', () => {
  const fix = (over: object = {}) => ({
    lat: PLACES.mgRoad.lat,
    lng: PLACES.mgRoad.lng,
    accuracyM: 12,
    recordedAt: new Date().toISOString(),
    ...over,
  });

  it('accepts good fixes and rejects inaccurate, stale or future ones', async () => {
    const d = await approvedDriver(ctx, 2, { online: true });
    const auth = bearer(d.accessToken);
    await ctx.db.execute((await import('drizzle-orm')).sql`DELETE FROM driver_locations`);
    const ok = await ctx.http.post('/v1/driver/location').set(auth).send(fix()).expect(202);
    expect(ok.body.accepted).toBe(true);
    // Thinned: too soon after the previous accepted fix.
    const thin = await ctx.http.post('/v1/driver/location').set(auth).send(fix()).expect(202);
    expect(thin.body.accepted).toBe(false);

    expect(
      (
        await ctx.http
          .post('/v1/driver/location')
          .set(auth)
          .send(fix({ accuracyM: 500 }))
      ).body.error.code,
    ).toBe('LOCATION_INACCURATE');
    const stale = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(
      (
        await ctx.http
          .post('/v1/driver/location')
          .set(auth)
          .send(fix({ recordedAt: stale }))
      ).body.error.code,
    ).toBe('LOCATION_STALE');
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    expect(
      (
        await ctx.http
          .post('/v1/driver/location')
          .set(auth)
          .send(fix({ recordedAt: future }))
      ).body.error.code,
    ).toBe('LOCATION_IN_FUTURE');
  });

  it('requires the driver to be online, and forgets the location when going offline', async () => {
    const d = await approvedDriver(ctx, 2, { online: true });
    const auth = bearer(d.accessToken);
    await ctx.http.post('/v1/driver/availability').set(auth).send({ online: false }).expect(200);
    const { rows } = await ctx.db.execute(
      (await import('drizzle-orm'))
        .sql`SELECT 1 FROM driver_locations WHERE driver_id = ${d.userId}`,
    );
    expect(rows).toHaveLength(0);
    const res = await ctx.http.post('/v1/driver/location').set(auth).send(fix()).expect(409);
    expect(res.body.error.code).toBe('DRIVER_OFFLINE');
  });
});

describe('realtime', () => {
  let socket: Socket | undefined;
  afterEach(() => socket?.disconnect());

  it('pushes a new offer to the driver over the socket', async () => {
    await ctx.app.listen(0);
    const { port } = ctx.app.getHttpServer().address() as AddressInfo;
    const p = await readyPassenger(ctx, 1);
    const d = await approvedDriver(ctx, 2);

    socket = io(`http://127.0.0.1:${port}/realtime`, {
      auth: { token: d.accessToken },
      transports: ['websocket'],
    });
    await new Promise<void>((resolve, reject) => {
      socket!.on('ready', () => resolve());
      socket!.on('connect_error', reject);
    });
    const offer = new Promise<{ rideId: string }>((resolve) =>
      socket!.on('offer.created', resolve),
    );
    const ride = await bookRide(ctx, p);
    await expect(offer).resolves.toMatchObject({ rideId: ride.id });
  });

  it('disconnects a socket without a valid token', async () => {
    await ctx.app.listen(0).catch(() => undefined);
    const { port } = ctx.app.getHttpServer().address() as AddressInfo;
    socket = io(`http://127.0.0.1:${port}/realtime`, {
      auth: { token: 'bad' },
      transports: ['websocket'],
    });
    await expect(new Promise((resolve) => socket!.on('unauthorized', resolve))).resolves.toEqual({
      code: 'UNAUTHENTICATED',
    });
  });
});
