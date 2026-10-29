import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export type ClientApp = 'PASSENGER' | 'DRIVER';
export type UserRole = 'PASSENGER' | 'DRIVER';

/** The authenticated caller, attached to the request by JwtAuthGuard. */
export interface AuthUser {
  userId: string;
  /** Session family id; identifies the signed-in device. */
  sessionId: string;
  app: ClientApp;
  roles: UserRole[];
}

export interface AccessTokenClaims {
  sub: string;
  fam: string;
  app: ClientApp;
  roles: UserRole[];
}

export type AuthenticatedRequest = Request & { user?: AuthUser; id?: string };

export const IS_PUBLIC = 'isPublic';
/** Opts a route out of authentication. Everything else requires a valid access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_ROLES = 'requiredRoles';
/** Caller must hold one of these roles and be using the matching app. */
export const Roles = (...roles: UserRole[]) => SetMetadata(REQUIRED_ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new Error('CurrentUser used on a route without authentication');
  return user;
});
