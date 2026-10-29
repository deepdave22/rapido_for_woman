import {
  applyDecorators,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth } from '@nestjs/swagger';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Public } from '../auth/auth.decorators';
import type { ClientInfo } from '../auth/auth.service';
import { AppError } from '../common/errors';
import { keyedHash, randomToken } from '../common/hashing';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { staffRoleAssignments, staffSessions, staffUsers } from '../database/schema';
import {
  decryptField,
  encryptField,
  hashPassword,
  newTotpSecret,
  otpauthUri,
  passwordProblem,
  matchTotpStep,
  verifyPassword,
} from './staff-crypto';

export type StaffRole = 'SUPER_ADMIN' | 'OPERATIONS' | 'SUPPORT' | 'FINANCE' | 'SAFETY';

export interface StaffPrincipal {
  staffId: string;
  sessionId: string;
  roles: StaffRole[];
}

interface StaffClaims {
  sub: string;
  sid: string;
}

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const SESSION_MS = 12 * 60 * 60 * 1000;
const ACCESS_TTL_S = 15 * 60;
const CHALLENGE_TTL_S = 5 * 60;
/** Verifying against this keeps the response time similar for unknown emails. */
const DUMMY_HASH =
  'scrypt$32768$8$1$c2FsdHNhbHRzYWx0c2FsdA$5Yp1kQ5V0bJ0o1y0q5o9V3oJcY4N2Kp8X7vN4b1sJ2c';

@Injectable()
export class StaffAuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  /** Step 1: password. Never issues a session by itself: a second factor is always required. */
  async login(email: string, password: string, client: ClientInfo) {
    const [staff] = await this.db
      .select()
      .from(staffUsers)
      .where(sql`lower(${staffUsers.email}) = lower(${email})`);
    if (!staff) {
      await verifyPassword(password, DUMMY_HASH);
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    if (staff.lockedUntil && staff.lockedUntil > new Date()) {
      throw new AppError(
        423,
        'ACCOUNT_LOCKED',
        'Too many attempts. Try again later or contact an administrator',
      );
    }
    const ok = staff.status === 'ACTIVE' && (await verifyPassword(password, staff.passwordHash));
    if (!ok) {
      await this.recordFailure(staff.id, staff.failedLoginCount, client, 'password');
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    const challengeToken = await this.jwt.signAsync(
      { sub: staff.id },
      { audience: 'staff-mfa', expiresIn: CHALLENGE_TTL_S, algorithm: 'HS256' },
    );
    return {
      step: staff.mfaEnrolledAt ? ('MFA_REQUIRED' as const) : ('MFA_ENROLLMENT_REQUIRED' as const),
      challengeToken,
    };
  }

  /** First login only: create a TOTP secret to add to an authenticator app. */
  async startEnrollment(challengeToken: string) {
    const staffId = await this.verifyChallenge(challengeToken);
    const [staff] = await this.db.select().from(staffUsers).where(eq(staffUsers.id, staffId));
    if (!staff || staff.mfaEnrolledAt) {
      throw new AppError(409, 'MFA_ALREADY_ENROLLED', 'Two-step verification is already set up');
    }
    const secret = newTotpSecret();
    await this.db
      .update(staffUsers)
      .set({ totpSecretEncrypted: encryptField(this.env.dataEncryptionKey, secret) })
      .where(eq(staffUsers.id, staffId));
    return { secret, otpauthUri: otpauthUri(secret, staff.email) };
  }

  /** Step 2: authenticator code. Completes enrollment if needed and opens a session. */
  async verifyMfa(challengeToken: string, code: string, client: ClientInfo) {
    const staffId = await this.verifyChallenge(challengeToken);
    const [staff] = await this.db.select().from(staffUsers).where(eq(staffUsers.id, staffId));
    if (!staff || staff.status !== 'ACTIVE' || !staff.totpSecretEncrypted) {
      throw new AppError(401, 'MFA_INVALID', 'Start sign-in again');
    }
    if (staff.lockedUntil && staff.lockedUntil > new Date()) {
      throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many attempts. Try again later');
    }
    const secret = decryptField(this.env.dataEncryptionKey, staff.totpSecretEncrypted);
    const step = matchTotpStep(secret, code);
    if (step === null) {
      await this.recordFailure(staff.id, staff.failedLoginCount, client, 'mfa');
      throw new AppError(401, 'MFA_INVALID', 'The code is incorrect');
    }
    // Each code works once: claim its time step atomically.
    const claimed = await this.db
      .update(staffUsers)
      .set({ totpLastStep: step })
      .where(
        and(
          eq(staffUsers.id, staff.id),
          sql`(${staffUsers.totpLastStep} IS NULL OR ${staffUsers.totpLastStep} < ${step})`,
        ),
      )
      .returning({ id: staffUsers.id });
    if (!claimed.length) {
      throw new AppError(401, 'MFA_CODE_ALREADY_USED', 'Wait for a new code and try again');
    }
    const refreshToken = randomToken();
    const [session] = await this.db
      .insert(staffSessions)
      .values({
        staffUserId: staff.id,
        refreshTokenHash: keyedHash(this.env.HASH_PEPPER, refreshToken),
        mfaVerified: true,
        userAgent: client.userAgent?.slice(0, 300) ?? null,
        ip: client.ip ?? null,
        expiresAt: new Date(Date.now() + SESSION_MS),
      })
      .returning({ id: staffSessions.id });
    await this.db
      .update(staffUsers)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        mfaEnrolledAt: staff.mfaEnrolledAt ?? new Date(),
      })
      .where(eq(staffUsers.id, staff.id));
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staff.id,
      action: staff.mfaEnrolledAt ? 'staff.login' : 'staff.mfa_enrolled_and_login',
      entityType: 'staff_session',
      entityId: session!.id,
      ip: client.ip,
      requestId: client.requestId,
    });
    return this.issue(staff.id, session!.id, refreshToken);
  }

  /** Rotates the refresh token. Sessions end after 12 hours regardless. */
  async refresh(refreshToken: string) {
    const next = randomToken();
    const [session] = await this.db
      .update(staffSessions)
      .set({ refreshTokenHash: keyedHash(this.env.HASH_PEPPER, next) })
      .where(
        and(
          eq(staffSessions.refreshTokenHash, keyedHash(this.env.HASH_PEPPER, refreshToken)),
          isNull(staffSessions.revokedAt),
          gt(staffSessions.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!session) throw new AppError(401, 'SESSION_EXPIRED', 'Please sign in again');
    const [staff] = await this.db
      .select({ status: staffUsers.status })
      .from(staffUsers)
      .where(eq(staffUsers.id, session.staffUserId));
    if (staff?.status !== 'ACTIVE')
      throw new AppError(401, 'SESSION_EXPIRED', 'Please sign in again');
    return this.issue(session.staffUserId, session.id, next);
  }

  async logout(principal: StaffPrincipal) {
    await this.db
      .update(staffSessions)
      .set({ revokedAt: new Date() })
      .where(eq(staffSessions.id, principal.sessionId));
  }

  async changePassword(principal: StaffPrincipal, current: string, next: string) {
    const [staff] = await this.db
      .select()
      .from(staffUsers)
      .where(eq(staffUsers.id, principal.staffId));
    if (!staff || !(await verifyPassword(current, staff.passwordHash))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    }
    const problem = passwordProblem(next);
    if (problem) throw new AppError(400, 'WEAK_PASSWORD', problem);
    await this.db
      .update(staffUsers)
      .set({ passwordHash: await hashPassword(next) })
      .where(eq(staffUsers.id, staff.id));
    // Sign out every other session.
    await this.db
      .update(staffSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(staffSessions.staffUserId, staff.id),
          sql`${staffSessions.id} <> ${principal.sessionId}`,
        ),
      );
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staff.id,
      action: 'staff.password_changed',
      entityType: 'staff_user',
      entityId: staff.id,
    });
  }

  async me(principal: StaffPrincipal) {
    const [staff] = await this.db
      .select()
      .from(staffUsers)
      .where(eq(staffUsers.id, principal.staffId));
    return {
      id: staff!.id,
      email: staff!.email,
      fullName: staff!.fullName,
      roles: principal.roles,
    };
  }

  private async issue(staffId: string, sessionId: string, refreshToken: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: staffId, sid: sessionId },
      { audience: 'staff', expiresIn: ACCESS_TTL_S, algorithm: 'HS256' },
    );
    return { accessToken, refreshToken, accessTokenExpiresInSeconds: ACCESS_TTL_S };
  }

  private async verifyChallenge(token: string): Promise<string> {
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string }>(token, {
        audience: 'staff-mfa',
        algorithms: ['HS256'],
      });
      return claims.sub;
    } catch {
      throw new AppError(401, 'CHALLENGE_EXPIRED', 'Sign-in took too long. Start again');
    }
  }

  private async recordFailure(
    staffId: string,
    previous: number,
    client: ClientInfo,
    stage: string,
  ) {
    const failures = previous + 1;
    await this.db
      .update(staffUsers)
      .set({
        failedLoginCount: failures,
        lockedUntil: failures >= MAX_FAILURES ? new Date(Date.now() + LOCK_MS) : null,
      })
      .where(eq(staffUsers.id, staffId));
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staffId,
      action: 'staff.login_failed',
      entityType: 'staff_user',
      entityId: staffId,
      ip: client.ip,
      requestId: client.requestId,
      metadata: { stage, failures, locked: failures >= MAX_FAILURES },
    });
  }
}

// ---------- guard ----------

const STAFF_ROLES = 'staffRoles';
type StaffRequest = { headers: { authorization?: string }; staff?: StaffPrincipal };

/**
 * Admin routes: valid staff token, live MFA-verified session, active account,
 * and one of the listed roles (SUPER_ADMIN may do anything). Roles are read
 * from the database on every request so revocation is immediate.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<StaffRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue');
    let claims: StaffClaims;
    try {
      claims = await this.jwt.verifyAsync<StaffClaims>(token, {
        audience: 'staff',
        algorithms: ['HS256'],
      });
    } catch {
      throw new AppError(
        401,
        'ACCESS_TOKEN_INVALID',
        'Your session has expired. Please sign in again',
      );
    }
    const [row] = await this.db
      .select({ status: staffUsers.status })
      .from(staffSessions)
      .innerJoin(staffUsers, eq(staffUsers.id, staffSessions.staffUserId))
      .where(
        and(
          eq(staffSessions.id, claims.sid),
          eq(staffSessions.staffUserId, claims.sub),
          eq(staffSessions.mfaVerified, true),
          isNull(staffSessions.revokedAt),
          gt(staffSessions.expiresAt, new Date()),
        ),
      );
    if (!row || row.status !== 'ACTIVE') {
      throw new AppError(401, 'SESSION_REVOKED', 'You have been signed out. Please sign in again');
    }
    const roles = (
      await this.db
        .select({ role: staffRoleAssignments.role })
        .from(staffRoleAssignments)
        .where(eq(staffRoleAssignments.staffUserId, claims.sub))
    ).map((r) => r.role);
    const required = this.reflector.getAllAndOverride<StaffRole[]>(STAFF_ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (
      required?.length &&
      !roles.includes('SUPER_ADMIN') &&
      !required.some((r) => roles.includes(r))
    ) {
      throw new AppError(403, 'FORBIDDEN', 'Your role does not allow this action');
    }
    req.staff = { staffId: claims.sub, sessionId: claims.sid, roles };
    return true;
  }
}

/** Staff-only route. With no roles, any signed-in staff member may call it. */
export const StaffAuth = (...roles: StaffRole[]) =>
  applyDecorators(
    Public(),
    SetMetadata(STAFF_ROLES, roles),
    UseGuards(StaffGuard),
    ApiBearerAuth(),
  );

export const CurrentStaff = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): StaffPrincipal => {
    const staff = ctx.switchToHttp().getRequest<StaffRequest>().staff;
    if (!staff) throw new Error('CurrentStaff used without StaffAuth');
    return staff;
  },
);
