import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { DB, Database } from '../database/database.module';
import { sessions, users } from '../database/schema';
import { AccessTokenClaims, AuthUser } from './auth.decorators';

/**
 * Validates an access token for HTTP and WebSocket alike: signature, expiry,
 * a live session, and an active account.
 */
@Injectable()
export class TokenValidator {
  constructor(
    private readonly jwt: JwtService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async validate(token: string | undefined): Promise<AuthUser> {
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue');

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        algorithms: ['HS256'],
        audience: 'app',
      });
    } catch {
      throw new AppError(
        401,
        'ACCESS_TOKEN_INVALID',
        'Your session has expired. Please sign in again',
      );
    }

    const [row] = await this.db
      .select({ status: users.status })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.familyId, claims.fam),
          eq(sessions.userId, claims.sub),
          isNull(sessions.revokedAt),
          isNull(sessions.rotatedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row) {
      throw new AppError(401, 'SESSION_REVOKED', 'You have been signed out. Please sign in again');
    }
    if (row.status !== 'ACTIVE') {
      throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is not active. Contact support');
    }
    return { userId: claims.sub, sessionId: claims.fam, app: claims.app, roles: claims.roles };
  }
}
