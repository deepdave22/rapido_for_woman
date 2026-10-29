import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/errors';
import { IdempotencyInterceptor } from './common/idempotency/idempotency';
import { ConfigModule } from './config/config.module';
import { Env } from './config/env';
import { DatabaseModule } from './database/database.module';
import { DriversModule } from './drivers/drivers.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { RidesModule } from './rides/rides.module';
import { HealthController } from './health/health.controller';
import { PlacesController } from './places/places.controller';
import { RedisModule } from './redis/redis.module';
import { UsersController } from './users/users.controller';

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [Env],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          genReqId: (req: IncomingMessage) => {
            const incoming = req.headers['x-request-id'];
            return typeof incoming === 'string' && REQUEST_ID.test(incoming)
              ? incoming
              : randomUUID();
          },
          // Never log credentials, codes or tokens.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.code',
              'req.body.refreshToken',
              'req.body.phone',
            ],
            censor: '[redacted]',
          },
          autoLogging: {
            ignore: (req: IncomingMessage) => req.url?.startsWith('/health') ?? false,
          },
          transport:
            env.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    // In-memory per-instance limits. Move storage to Redis before running more than one instance.
    ThrottlerModule.forRootAsync({
      inject: [Env],
      useFactory: (env: Env) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
        // Tests share one IP; OTP abuse limits stored in Postgres still apply.
        skipIf: () => env.NODE_ENV === 'test',
      }),
    }),
    DatabaseModule,
    RedisModule,
    AuditModule,
    AuthModule,
    IntegrationsModule,
    DriversModule,
    RidesModule,
  ],
  controllers: [HealthController, UsersController, PlacesController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
