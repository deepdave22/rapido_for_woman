import type { ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Fixed-window rate-limit counters in Redis, shared by every API instance.
 * One atomic script per request: increment, set expiry on first hit, and
 * apply a block once the limit is exceeded.
 */
const SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl < 0 and hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blockTtl = tonumber(ARGV[3])
end
return {hits, ttl, blockTtl}
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `throttle:${throttlerName}:${key}`;
    const [hits, ttlMs, blockMs] = (await this.redis.eval(
      SCRIPT,
      2,
      `${base}:hits`,
      `${base}:block`,
      String(ttl),
      String(limit),
      String(Math.max(1, blockDuration || ttl)),
    )) as [number, number, number];
    return {
      totalHits: hits,
      timeToExpire: Math.max(0, Math.ceil(ttlMs / 1000)),
      isBlocked: blockMs > 0,
      timeToBlockExpire: Math.max(0, Math.ceil(blockMs / 1000)),
    };
  }
}
