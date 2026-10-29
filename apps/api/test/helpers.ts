import { NestExpressApplication } from '@nestjs/platform-express';
import { normalizeIndianMobile } from '@saheli/domain';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { InMemoryOtpSender, OTP_SENDER } from '../src/auth/otp/otp-sender';
import { DB, Database } from '../src/database/database.module';
import {
  driverDocuments,
  driverProfiles,
  driverVerifications,
  rides,
  staffRoleAssignments,
  staffUsers,
  users,
  vehicles,
} from '../src/database/schema';
import { seedReferenceData } from '../src/database/seed';
import { REQUIRED_CHECKS, requiredDocuments } from '../src/drivers/driver-eligibility.service';
import { SandboxPaymentProvider } from '../src/payments/payment-provider';
import type { StaffRole } from '../src/admin/staff-auth';
import { base32Decode, hashPassword, totpAt } from '../src/admin/staff-crypto';
import { TEST_ENV } from './test-env';

export interface TestContext {
  app: NestExpressApplication;
  http: TestAgent;
  db: Database;
  otp: InMemoryOtpSender;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
    rawBody: true,
  });
  configureApp(app);
  await app.init();
  return {
    app,
    http: request(app.getHttpServer()),
    db: app.get<Database>(DB),
    otp: app.get<InMemoryOtpSender>(OTP_SENDER),
    close: () => app.close(),
  };
}

/** Empties every application table between tests. */
export async function resetDatabase(db: Database): Promise<void> {
  const { rows } = await db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys'`);
  if (!rows.length) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await db.execute(sql.raw(`TRUNCATE ${list} RESTART IDENTITY CASCADE`));
}

/** Synthetic test numbers only. Never use a real person's number in tests. */
export function testPhone(n: number): string {
  return `+9199999${String(n).padStart(5, '0')}`;
}

export interface LoggedIn {
  accessToken: string;
  refreshToken: string;
  userId: string;
  isNewUser: boolean;
}

export async function login(
  ctx: TestContext,
  phone: string,
  app: 'PASSENGER' | 'DRIVER' = 'PASSENGER',
): Promise<LoggedIn> {
  const sent = await ctx.http.post('/v1/auth/otp/request').send({ phone }).expect(202);
  const code = ctx.otp.lastCodeFor(normalizeIndianMobile(phone));
  if (!code) throw new Error('No OTP captured');
  const res = await ctx.http
    .post('/v1/auth/otp/verify')
    .send({ challengeId: sent.body.challengeId, code, app, deviceName: 'test-device' })
    .expect(200);
  return {
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    userId: res.body.user.id,
    isNewUser: res.body.isNewUser,
  };
}

/** Drizzle wraps driver errors; the Postgres message is on `cause`. */
export async function pgError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const err = e as { cause?: { message?: string }; message: string };
    return err.cause?.message ?? err.message;
  }
  throw new Error('Expected the query to fail');
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Central Bengaluru points inside the synthetic pilot zone. */
export const PLACES = {
  mgRoad: { lat: 12.9756, lng: 77.6066, address: 'MG Road Metro, Bengaluru' },
  koramangala: { lat: 12.9352, lng: 77.6245, address: 'Koramangala 5th Block, Bengaluru' },
  mumbai: { lat: 19.076, lng: 72.8777, address: 'Mumbai (outside the pilot zone)' },
};

export async function seed(ctx: TestContext): Promise<void> {
  await seedReferenceData(ctx.db);
}

/** A signed-in passenger who has accepted the current terms. */
export async function readyPassenger(
  ctx: TestContext,
  n: number,
  fullName = 'Asha Kumar',
): Promise<LoggedIn> {
  const p = await login(ctx, testPhone(n));
  await ctx.http.patch('/v1/me').set(bearer(p.accessToken)).send({ fullName }).expect(200);
  await ctx.http
    .post('/v1/me/terms')
    .set(bearer(p.accessToken))
    .send({ termsVersion: TEST_ENV.TERMS_VERSION })
    .expect(200);
  return p;
}

/**
 * A driver who has passed every check (written straight to the database, as
 * an operations reviewer would approve them), online at the given point.
 */
export async function approvedDriver(
  ctx: TestContext,
  n: number,
  opts: {
    category?: 'BIKE' | 'AUTO' | 'CAB';
    at?: { lat: number; lng: number };
    online?: boolean;
  } = {},
): Promise<LoggedIn & { vehicleId: string }> {
  const d = await login(ctx, testPhone(n), 'DRIVER');
  const category = opts.category ?? 'BIKE';
  await ctx.db
    .update(users)
    .set({ fullName: `Driver ${n}` })
    .where(eq(users.id, d.userId));
  const [vehicle] = await ctx.db
    .insert(vehicles)
    .values({
      driverId: d.userId,
      categoryCode: category,
      registrationNumber: `KA01TS${String(n).padStart(4, '0')}`,
      make: 'TestMake',
      model: 'TestModel',
      colour: 'White',
      status: 'ACTIVE',
    })
    .returning({ id: vehicles.id });
  for (const type of requiredDocuments(category)) {
    await ctx.db.insert(driverDocuments).values({
      driverId: d.userId,
      type,
      storageKey: `test/${d.userId}/${type}`,
      mimeType: 'image/png',
      sizeBytes: 100,
      sha256: 'test',
      status: 'APPROVED',
    });
  }
  for (const check of REQUIRED_CHECKS) {
    await ctx.db
      .insert(driverVerifications)
      .values({ driverId: d.userId, check, status: 'PASSED' });
  }
  await ctx.db
    .update(driverProfiles)
    .set({ status: 'APPROVED', approvedAt: new Date() })
    .where(eq(driverProfiles.userId, d.userId));
  if (opts.online !== false) {
    await ctx.http
      .post('/v1/driver/availability')
      .set(bearer(d.accessToken))
      .send({ online: true })
      .expect(200);
    await placeDriver(ctx, d.userId, opts.at ?? PLACES.mgRoad);
  }
  return { ...d, vehicleId: vehicle!.id };
}

/** Sets a driver's current position directly (bypasses update thinning). */
export async function placeDriver(
  ctx: TestContext,
  driverId: string,
  at: { lat: number; lng: number },
) {
  await ctx.db.execute(sql`
    INSERT INTO driver_locations (driver_id, location, accuracy_m, recorded_at)
    VALUES (${driverId}, ST_SetSRID(ST_MakePoint(${at.lng}, ${at.lat}), 4326)::geography, 10, now())
    ON CONFLICT (driver_id) DO UPDATE SET location = EXCLUDED.location, recorded_at = now()`);
}

let keyCounter = 0;
export const idemKey = () => `test-key-${Date.now()}-${++keyCounter}`;

/** Quotes MG Road → Koramangala and books the given category. */
export async function bookRide(
  ctx: TestContext,
  passenger: LoggedIn,
  category: 'BIKE' | 'AUTO' | 'CAB' = 'BIKE',
  paymentMethod: 'CASH' | 'ONLINE' = 'CASH',
) {
  const quote = await ctx.http
    .post('/v1/rides/quotes')
    .set(bearer(passenger.accessToken))
    .send({ pickup: PLACES.mgRoad, dropoff: PLACES.koramangala })
    .expect(200);
  const option = quote.body.options.find(
    (o: { categoryCode: string }) => o.categoryCode === category,
  );
  const res = await ctx.http
    .post('/v1/rides')
    .set(bearer(passenger.accessToken))
    .set('Idempotency-Key', idemKey())
    .send({ quoteId: option.quoteId, paymentMethod })
    .expect(201);
  return res.body as {
    id: string;
    status: string;
    pickupPin: string | null;
    quotedTotalPaise: number;
  };
}

export async function currentOffer(ctx: TestContext, driver: LoggedIn) {
  const res = await ctx.http
    .get('/v1/driver/offers/current')
    .set(bearer(driver.accessToken))
    .expect(200);
  return res.body.offer as { id: string; rideId: string; estimatedEarningPaise: number } | null;
}

/** Runs a booked ride all the way to COMPLETED and returns its id. */
export async function completeRide(
  ctx: TestContext,
  passenger: LoggedIn,
  driver: LoggedIn,
  paymentMethod: 'CASH' | 'ONLINE' = 'CASH',
): Promise<string> {
  const ride = await bookRide(ctx, passenger, 'BIKE', paymentMethod);
  const offer = await currentOffer(ctx, driver);
  const auth = bearer(driver.accessToken);
  await ctx.http.post(`/v1/driver/offers/${offer!.id}/accept`).set(auth).expect(200);
  await ctx.http.post(`/v1/driver/rides/${ride.id}/arrived`).set(auth).expect(200);
  const [row] = await ctx.db
    .select({ pin: rides.pickupPin })
    .from(rides)
    .where(eq(rides.id, ride.id));
  await ctx.http
    .post(`/v1/driver/rides/${ride.id}/verify-pin`)
    .set(auth)
    .send({ pin: row!.pin })
    .expect(200);
  await ctx.http.post(`/v1/driver/rides/${ride.id}/start`).set(auth).expect(200);
  await ctx.http.post(`/v1/driver/rides/${ride.id}/complete`).set(auth).expect(200);
  return ride.id;
}

let eventCounter = 0;
/** Sends a gateway webhook signed exactly as the sandbox provider verifies it. */
export function sendWebhook(
  ctx: TestContext,
  event: string,
  entity: Record<string, unknown>,
  opts: { eventId?: string; secret?: string } = {},
) {
  const body = JSON.stringify({ event, payload: { payment: { entity } } });
  return ctx.http
    .post('/v1/payments/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Event-Id', opts.eventId ?? `evt_test_${++eventCounter}`)
    .set(
      'X-Razorpay-Signature',
      SandboxPaymentProvider.sign(opts.secret ?? 'sandbox-webhook-secret-dev-only', body),
    )
    .send(body);
}

export interface StaffSession {
  staffId: string;
  accessToken: string;
  refreshToken: string;
  totpSecret: string;
}

let staffCounter = 0;
/** Creates a staff member with the given roles and signs in through password + TOTP enrollment. */
export async function staffLogin(ctx: TestContext, roles: StaffRole[]): Promise<StaffSession> {
  const email = `staff${++staffCounter}-${Date.now()}@test.invalid`;
  const password = 'correct horse battery 42';
  const [s] = await ctx.db
    .insert(staffUsers)
    .values({
      email,
      fullName: `Staff ${staffCounter}`,
      passwordHash: await hashPassword(password),
    })
    .returning({ id: staffUsers.id });
  await ctx.db
    .insert(staffRoleAssignments)
    .values(roles.map((role) => ({ staffUserId: s!.id, role })));
  const login = await ctx.http.post('/v1/admin/auth/login').send({ email, password }).expect(200);
  const enroll = await ctx.http
    .post('/v1/admin/auth/mfa/enroll')
    .send({ challengeToken: login.body.challengeToken })
    .expect(200);
  const code = totpAt(base32Decode(enroll.body.secret), Date.now() / 1000);
  const verified = await ctx.http
    .post('/v1/admin/auth/mfa/verify')
    .send({ challengeToken: login.body.challengeToken, code })
    .expect(200);
  return {
    staffId: s!.id,
    accessToken: verified.body.accessToken,
    refreshToken: verified.body.refreshToken,
    totpSecret: enroll.body.secret,
  };
}
