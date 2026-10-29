import { Controller, Get, HttpCode, Inject, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import Redis from 'ioredis';
import { Public } from '../auth/auth.decorators';
import { DB, Database } from '../database/database.module';
import { REDIS } from '../redis/redis.module';

type Check = 'ok' | 'fail';

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Process is up. Used by the orchestrator to decide whether to restart it. */
  @Get('live')
  @HttpCode(200)
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Dependencies reachable. Traffic is routed only while this returns 200. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const [database, redis] = await Promise.all([
      this.check(() => this.db.execute(sql`SELECT 1`)),
      this.check(() => this.redis.ping()),
    ]);
    const ok = database === 'ok' && redis === 'ok';
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'unavailable', checks: { database, redis } };
  }

  private async check(fn: () => Promise<unknown>): Promise<Check> {
    try {
      await Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]);
      return 'ok';
    } catch {
      return 'fail';
    }
  }
}
