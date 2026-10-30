import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/errors';
import { RedisThrottlerStorage } from './common/redis-throttler-storage';
import { IdempotencyInterceptor } from './common/idempotency/idempotency';
import { ConfigModule } from './config/config.module';
import { Env } from './config/env';
import { DatabaseModule } from './database/database.module';
import { DriversModule } from './drivers/drivers.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { PaymentsModule } from './payments/payments.module';
import { RidesModule } from './rides/rides.module';
import { SafetyModule } from './safety/safety.module';
import { AppLinksController } from './health/app-links.controller';
import { HealthController } from './health/health.controller';
import { PlacesController } from './places/places.controller';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { NotificationsModule } from './notifications/notifications.module';
import { REDIS, RedisModule } from './redis/redis.module';
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
          transport: env.LOG_PRETTY
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        },
      }),
    }),
    // Counters live in Redis so limits hold across every API instance.
    ThrottlerModule.forRootAsync({
      inject: [Env, REDIS],
      useFactory: (env: Env, redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
        storage: new RedisThrottlerStorage(redis),
        // Tests share one IP; OTP abuse limits stored in Postgres still apply.
        skipIf: () => env.NODE_ENV === 'test',
      }),
    }),
    DatabaseModule,
    RedisModule,
    AuditModule,
    NotificationsModule,
    AuthModule,
    IntegrationsModule,
    DriversModule,
    RidesModule,
    PaymentsModule,
    SafetyModule,
    AdminModule,
    MaintenanceModule,
  ],
  controllers: [HealthController, AppLinksController, UsersController, PlacesController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
