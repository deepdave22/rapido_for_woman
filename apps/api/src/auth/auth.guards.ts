import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { DB, Database } from '../database/database.module';
import { sessions, users } from '../database/schema';
import {
  AccessTokenClaims,
  AuthenticatedRequest,
  IS_PUBLIC,
  REQUIRED_ROLES,
  UserRole,
} from './auth.decorators';

/**
 * Global guard. Verifies the bearer access token and that its session is still
 * live and the account active, so logout and suspension take effect at once
 * rather than when the token expires.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue');

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, { algorithms: ['HS256'] });
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
    if (!row)
      throw new AppError(401, 'SESSION_REVOKED', 'You have been signed out. Please sign in again');
    if (row.status !== 'ACTIVE') {
      throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is not active. Contact support');
    }

    req.user = { userId: claims.sub, sessionId: claims.fam, app: claims.app, roles: claims.roles };
    return true;
  }
}

/** Enforces @Roles(). A driver token cannot call passenger routes and vice versa. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(REQUIRED_ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;
    const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
    const allowed = user && required.some((r) => user.roles.includes(r) && user.app === r);
    if (!allowed) throw new AppError(403, 'FORBIDDEN', 'You do not have access to this action');
    return true;
  }
}
