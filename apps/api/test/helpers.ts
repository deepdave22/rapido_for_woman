import { NestExpressApplication } from '@nestjs/platform-express';
import { normalizeIndianMobile } from '@saheli/domain';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { InMemoryOtpSender, OTP_SENDER } from '../src/auth/otp/otp-sender';
import { DB, Database } from '../src/database/database.module';

export interface TestContext {
  app: NestExpressApplication;
  http: TestAgent;
  db: Database;
  otp: InMemoryOtpSender;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
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
