import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import { catchError, from, Observable, of, switchMap, throwError } from 'rxjs';
import type { AuthenticatedRequest } from '../../auth/auth.decorators';
import { DB, Database } from '../../database/database.module';
import { idempotencyRecords } from '../../database/schema';
import { AppError } from '../errors';

const IDEMPOTENT = 'idempotent';
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Marks a state-changing route as requiring an `Idempotency-Key` header. A
 * retried request with the same key and body gets the original response
 * instead of repeating the action.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Database,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = ctx.getHandler();
    if (!this.reflector.get<boolean>(IDEMPOTENT, handler)) return next.handle();

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
      throw new AppError(
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'An Idempotency-Key header (8-100 letters, digits, - or _) is required',
      );
    }
    const scope = `${req.user?.userId ?? 'anon'}:${req.method} ${req.route?.path ?? req.path}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ params: req.params, body: req.body ?? null }))
      .digest('base64url');
    const successStatus: number =
      this.reflector.get<number>(HTTP_CODE_METADATA, handler) ??
      (req.method === 'POST' ? 201 : 200);
    const where = and(eq(idempotencyRecords.scope, scope), eq(idempotencyRecords.key, key));

    return from(
      this.db
        .insert(idempotencyRecords)
        .values({ scope, key, requestHash, expiresAt: new Date(Date.now() + RETENTION_MS) })
        .onConflictDoNothing()
        .returning({ key: idempotencyRecords.key }),
    ).pipe(
      switchMap((inserted) => {
        if (inserted.length) {
          return next.handle().pipe(
            switchMap((body) =>
              from(
                this.db
                  .update(idempotencyRecords)
                  .set({ responseStatus: successStatus, responseBody: body ?? null })
                  .where(where),
              ).pipe(switchMap(() => of(body))),
            ),
            // A failed attempt may be retried with the same key.
            catchError((err: unknown) =>
              from(this.db.delete(idempotencyRecords).where(where)).pipe(
                switchMap(() => throwError(() => err)),
              ),
            ),
          );
        }
        return from(this.db.select().from(idempotencyRecords).where(where)).pipe(
          switchMap(([existing]) => {
            if (!existing) {
              throw new AppError(
                409,
                'REQUEST_IN_PROGRESS',
                'This request is still being processed',
              );
            }
            if (existing.requestHash !== requestHash) {
              throw new AppError(
                422,
                'IDEMPOTENCY_KEY_REUSED',
                'This Idempotency-Key was already used for a different request',
              );
            }
            if (existing.responseStatus === null) {
              throw new AppError(
                409,
                'REQUEST_IN_PROGRESS',
                'This request is still being processed',
              );
            }
            res.status(existing.responseStatus);
            res.setHeader('Idempotent-Replayed', 'true');
            return of(existing.responseBody);
          }),
        );
      }),
    );
  }
}
