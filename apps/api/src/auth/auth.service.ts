import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { normalizeIndianMobile } from '@saheli/domain';
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { keyedHash, randomDigits, randomToken, safeEqual } from '../common/hashing';
import { Env } from '../config/env';
import { DB, Database, Tx } from '../database/database.module';
import {
  driverAvailability,
  driverProfiles,
  otpChallenges,
  passengerProfiles,
  pushTokens,
  sessions,
  userRoles,
  users,
} from '../database/schema';
import { AccessTokenClaims, AuthUser, ClientApp, UserRole } from './auth.decorators';
import { RequestOtpResponse, SessionView, TokenResponse } from './auth.dto';
import { OTP_SENDER, OtpSender } from './otp/otp-sender';

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(OTP_SENDER) private readonly otpSender: OtpSender,
    private readonly env: Env,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async requestOtp(rawPhone: string, client: ClientInfo): Promise<RequestOtpResponse> {
    const phone = normalizeIndianMobile(rawPhone);
    const now = new Date();
    const hourAgo = new Date(now.getTime() - HOUR_MS);

    const { challengeId, code, review } = await this.db.transaction(async (tx) => {
      // Serialise sends per phone so concurrent requests cannot bypass the limits.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'otp:' + phone}))`);

      const recent = await tx
        .select({ createdAt: otpChallenges.createdAt })
        .from(otpChallenges)
        .where(and(eq(otpChallenges.phoneE164, phone), gt(otpChallenges.createdAt, hourAgo)))
        .orderBy(desc(otpChallenges.createdAt));
      const last = recent[0];
      if (last) {
        const waitMs =
          last.createdAt.getTime() + this.env.OTP_RESEND_COOLDOWN_SECONDS * 1000 - now.getTime();
        if (waitMs > 0) {
          throw new AppError(
            429,
            'OTP_RESEND_TOO_SOON',
            'Please wait before requesting another code',
            {
              retryAfterSeconds: Math.ceil(waitMs / 1000),
            },
          );
        }
      }
      if (recent.length >= this.env.OTP_MAX_SENDS_PER_PHONE_PER_HOUR) {
        throw new AppError(429, 'OTP_RATE_LIMITED', 'Too many codes requested. Try again later');
      }
      if (client.ip) {
        const [byIp] = await tx
          .select({ n: count() })
          .from(otpChallenges)
          .where(and(eq(otpChallenges.requestIp, client.ip), gt(otpChallenges.createdAt, hourAgo)));
        if ((byIp?.n ?? 0) >= this.env.OTP_MAX_SENDS_PER_IP_PER_HOUR) {
          throw new AppError(429, 'OTP_RATE_LIMITED', 'Too many codes requested. Try again later');
        }
      }

      // App-store reviewers cannot receive Indian SMS. Both keys are required: the number
      // is allow-listed in the environment AND the account was provisioned as a review
      // account, so a mistyped number can never take over a real person's account.
      const review = await this.isReviewSignIn(tx, phone);
      const code = review ? this.env.REVIEW_LOGIN_CODE! : randomDigits(6);

      const [row] = await tx
        .insert(otpChallenges)
        .values({
          phoneE164: phone,
          codeHash: keyedHash(this.env.HASH_PEPPER, `${phone}:${code}`),
          maxAttempts: this.env.OTP_MAX_ATTEMPTS,
          expiresAt: new Date(now.getTime() + this.env.OTP_TTL_SECONDS * 1000),
          requestIp: client.ip ?? null,
        })
        .returning({ id: otpChallenges.id });
      if (review) {
        await this.audit.record(
          {
            actorType: 'SYSTEM',
            actorId: null,
            action: 'auth.review_code_issued',
            entityType: 'otp_challenge',
            entityId: row!.id,
            ip: client.ip,
            requestId: client.requestId,
            metadata: {},
          },
          tx,
        );
      }
      return { challengeId: row!.id, code, review };
    });

    // The response is the same either way, so callers cannot tell a review number apart.
    if (!review) {
      try {
        await this.otpSender.send(phone, code);
      } catch {
        throw new AppError(503, 'OTP_DELIVERY_FAILED', 'Could not send the code. Please try again');
      }
    }

    return {
      challengeId,
      expiresInSeconds: this.env.OTP_TTL_SECONDS,
      resendAfterSeconds: this.env.OTP_RESEND_COOLDOWN_SECONDS,
    };
  }

  private async isReviewSignIn(tx: Tx, phone: string): Promise<boolean> {
    if (!this.env.reviewLoginPhones.has(phone)) return false;
    const [user] = await tx
      .select({ review: users.isReviewAccount, status: users.status })
      .from(users)
      .where(eq(users.phoneE164, phone));
    return user?.review === true && user.status === 'ACTIVE';
  }

  async verifyOtp(
    input: { challengeId: string; code: string; app: ClientApp; deviceName?: string },
    client: ClientInfo,
  ): Promise<TokenResponse> {
    // Count the attempt before checking the code so guesses are always limited.
    const [challenge] = await this.db
      .update(otpChallenges)
      .set({ attempts: sql`${otpChallenges.attempts} + 1` })
      .where(
        and(
          eq(otpChallenges.id, input.challengeId),
          isNull(otpChallenges.consumedAt),
          gt(otpChallenges.expiresAt, new Date()),
          sql`${otpChallenges.attempts} < ${otpChallenges.maxAttempts}`,
        ),
      )
      .returning();
    if (!challenge) {
      throw new AppError(400, 'OTP_INVALID_OR_EXPIRED', 'This code has expired. Request a new one');
    }

    const expected = keyedHash(this.env.HASH_PEPPER, `${challenge.phoneE164}:${input.code}`);
    if (!safeEqual(expected, challenge.codeHash)) {
      throw new AppError(400, 'OTP_INCORRECT', 'The code is incorrect', {
        attemptsRemaining: challenge.maxAttempts - challenge.attempts,
      });
    }

    const [consumed] = await this.db
      .update(otpChallenges)
      .set({ consumedAt: new Date() })
      .where(and(eq(otpChallenges.id, challenge.id), isNull(otpChallenges.consumedAt)))
      .returning({ id: otpChallenges.id });
    if (!consumed) {
      throw new AppError(400, 'OTP_INVALID_OR_EXPIRED', 'This code has expired. Request a new one');
    }

    const role: UserRole = input.app;
    const { userId, isNewUser, roles, refreshToken, familyId } = await this.db.transaction(
      async (tx) => {
        const inserted = await tx
          .insert(users)
          .values({ phoneE164: challenge.phoneE164 })
          .onConflictDoNothing({ target: users.phoneE164 })
          .returning({ id: users.id });
        const [user] = await tx
          .select({ id: users.id, status: users.status })
          .from(users)
          .where(eq(users.phoneE164, challenge.phoneE164));
        if (!user) throw new Error('User row missing after upsert');
        if (user.status !== 'ACTIVE') {
          throw new AppError(
            403,
            'ACCOUNT_SUSPENDED',
            'This account is not active. Contact support',
          );
        }

        await this.ensureRole(tx, user.id, role);
        const roleRows = await tx
          .select({ role: userRoles.role })
          .from(userRoles)
          .where(eq(userRoles.userId, user.id));

        const session = await this.createSession(tx, user.id, input.app, randomUUID(), {
          ...client,
          deviceName: input.deviceName,
        });
        await this.audit.record(
          {
            actorType: 'USER',
            actorId: user.id,
            action: 'auth.login',
            entityType: 'session',
            entityId: session.familyId,
            ip: client.ip,
            requestId: client.requestId,
            metadata: { app: input.app, newUser: inserted.length > 0 },
          },
          tx,
        );
        return {
          userId: user.id,
          isNewUser: inserted.length > 0,
          roles: roleRows.map((r) => r.role),
          ...session,
        };
      },
    );

    return {
      accessToken: await this.signAccessToken({
        sub: userId,
        fam: familyId,
        app: input.app,
        roles,
      }),
      refreshToken,
      accessTokenExpiresInSeconds: this.env.JWT_ACCESS_TTL_SECONDS,
      isNewUser,
      user: { id: userId, roles },
    };
  }

  /**
   * Rotates a refresh token. Presenting a token that was already rotated means
   * it was copied, so the whole device session is revoked.
   */
  async refresh(refreshToken: string, client: ClientInfo): Promise<TokenResponse> {
    const hash = keyedHash(this.env.HASH_PEPPER, refreshToken);
    const [current] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, hash));
    if (!current) throw new AppError(401, 'REFRESH_TOKEN_INVALID', 'Please sign in again');
    if (current.revokedAt) throw new AppError(401, 'SESSION_REVOKED', 'Please sign in again');
    if (current.rotatedAt) {
      await this.revokeFamily(current.userId, current.familyId, 'refresh_token_reuse', client);
      throw new AppError(401, 'REFRESH_TOKEN_REUSED', 'Please sign in again');
    }
    if (current.expiresAt <= new Date()) {
      throw new AppError(401, 'SESSION_EXPIRED', 'Please sign in again');
    }

    const result = await this.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(sessions)
        .set({ rotatedAt: new Date() })
        .where(
          and(eq(sessions.id, current.id), isNull(sessions.rotatedAt), isNull(sessions.revokedAt)),
        )
        .returning({ id: sessions.id });
      if (!claimed) return null;

      const [user] = await tx
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, current.userId));
      if (user?.status !== 'ACTIVE') {
        throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is not active. Contact support');
      }
      const roleRows = await tx
        .select({ role: userRoles.role })
        .from(userRoles)
        .where(eq(userRoles.userId, current.userId));
      const session = await this.createSession(tx, current.userId, current.app, current.familyId, {
        ...client,
        deviceName: current.deviceName ?? undefined,
      });
      return { ...session, roles: roleRows.map((r) => r.role) };
    });

    if (!result) {
      // Lost a race with another refresh of the same token: treat as reuse.
      await this.revokeFamily(current.userId, current.familyId, 'refresh_token_reuse', client);
      throw new AppError(401, 'REFRESH_TOKEN_REUSED', 'Please sign in again');
    }

    return {
      accessToken: await this.signAccessToken({
        sub: current.userId,
        fam: current.familyId,
        app: current.app,
        roles: result.roles,
      }),
      refreshToken: result.refreshToken,
      accessTokenExpiresInSeconds: this.env.JWT_ACCESS_TTL_SECONDS,
      isNewUser: false,
      user: { id: current.userId, roles: result.roles },
    };
  }

  async logout(user: AuthUser, client: ClientInfo): Promise<void> {
    await this.revokeFamily(user.userId, user.sessionId, 'logout', client);
  }

  async listSessions(user: AuthUser): Promise<SessionView[]> {
    const rows = await this.db
      .select({
        familyId: sessions.familyId,
        app: sessions.app,
        deviceName: sessions.deviceName,
        lastUsedAt: sessions.lastUsedAt,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, user.userId),
          isNull(sessions.revokedAt),
          isNull(sessions.rotatedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(sessions.lastUsedAt));
    return rows.map((r) => ({
      id: r.familyId,
      app: r.app,
      deviceName: r.deviceName,
      lastUsedAt: r.lastUsedAt,
      current: r.familyId === user.sessionId,
    }));
  }

  async revokeSession(user: AuthUser, familyId: string, client: ClientInfo): Promise<void> {
    const revoked = await this.revokeFamily(user.userId, familyId, 'revoked_by_user', client);
    if (!revoked) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found');
  }

  private async revokeFamily(
    userId: string,
    familyId: string,
    reason: string,
    client: ClientInfo,
  ): Promise<boolean> {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(sessions.userId, userId),
          eq(sessions.familyId, familyId),
          isNull(sessions.revokedAt),
        ),
      )
      .returning({ id: sessions.id });
    if (rows.length) {
      // The device must stop receiving this account's pushes once signed out.
      await this.db
        .delete(pushTokens)
        .where(and(eq(pushTokens.userId, userId), eq(pushTokens.sessionFamilyId, familyId)));
      await this.audit.record({
        actorType: 'USER',
        actorId: userId,
        action: 'auth.session_revoked',
        entityType: 'session',
        entityId: familyId,
        ip: client.ip,
        requestId: client.requestId,
        metadata: { reason },
      });
    }
    return rows.length > 0;
  }

  private async ensureRole(tx: Tx, userId: string, role: UserRole): Promise<void> {
    await tx.insert(userRoles).values({ userId, role }).onConflictDoNothing();
    if (role === 'PASSENGER') {
      await tx.insert(passengerProfiles).values({ userId }).onConflictDoNothing();
    } else {
      await tx.insert(driverProfiles).values({ userId }).onConflictDoNothing();
      await tx.insert(driverAvailability).values({ driverId: userId }).onConflictDoNothing();
    }
  }

  private async createSession(
    tx: Tx,
    userId: string,
    app: ClientApp,
    familyId: string,
    client: ClientInfo & { deviceName?: string },
  ): Promise<{ refreshToken: string; familyId: string }> {
    const refreshToken = randomToken();
    await tx.insert(sessions).values({
      userId,
      app,
      familyId,
      refreshTokenHash: keyedHash(this.env.HASH_PEPPER, refreshToken),
      deviceName: client.deviceName ?? null,
      userAgent: client.userAgent?.slice(0, 300) ?? null,
      ip: client.ip ?? null,
      expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 24 * HOUR_MS),
    });
    return { refreshToken, familyId };
  }

  private signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      algorithm: 'HS256',
      audience: 'app',
      expiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
    });
  }
}
