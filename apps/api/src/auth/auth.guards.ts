import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../common/errors';
import { AuthenticatedRequest, IS_PUBLIC, REQUIRED_ROLES, UserRole } from './auth.decorators';
import { TokenValidator } from './token-validator';

/**
 * Global guard. Verifies the bearer access token and that its session is still
 * live and the account active, so logout and suspension take effect at once
 * rather than when the token expires.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenValidator,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    req.user = await this.tokens.validate(
      header?.startsWith('Bearer ') ? header.slice(7) : undefined,
    );
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
