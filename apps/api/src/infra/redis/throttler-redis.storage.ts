import { Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';

import { RedisService } from './redis.service';

/**
 * Mirrors `ThrottlerStorageRecord` from `@nestjs/throttler`, which is not
 * re-exported from the package root.
 */
export interface RateLimitRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Counts hits and applies the block window in one atomic round trip.
 *
 * `KEYS[1]` is the rolling hit counter, `KEYS[2]` the block marker. `ARGV` is
 * `ttl`, `limit`, `blockDuration` in milliseconds.
 */
const INCREMENT_SCRIPT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])

local blockedFor = redis.call('PTTL', blockKey)
if blockedFor > 0 then
  local hits = tonumber(redis.call('GET', hitsKey) or '0')
  local hitsTtl = redis.call('PTTL', hitsKey)
  return { hits, math.max(hitsTtl, 0), 1, blockedFor }
end

local totalHits = redis.call('INCR', hitsKey)
if totalHits == 1 then
  redis.call('PEXPIRE', hitsKey, ttl)
end
local timeToExpire = redis.call('PTTL', hitsKey)

if totalHits > limit then
  redis.call('SET', blockKey, '1', 'PX', blockDuration)
  return { totalHits, math.max(timeToExpire, 0), 1, blockDuration }
end

return { totalHits, math.max(timeToExpire, 0), 0, 0 }
`;

/**
 * Redis-backed rate-limit storage.
 *
 * The default `@nestjs/throttler` storage keeps counters in process memory,
 * which means each replica enforces its own budget and every restart hands an
 * attacker a clean slate. Sharing the counters through the Redis instance this
 * app already runs makes the limit global and durable.
 *
 * When Redis is unreachable the check fails *open* — an availability incident
 * must not turn into a full API outage — but the failure is logged so it is
 * visible.
 */
@Injectable()
export class ThrottlerRedisStorage implements ThrottlerStorage {
  private readonly logger = new Logger(ThrottlerRedisStorage.name);

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<RateLimitRecord> {
    const hitsKey = `throttle:hits:${throttlerName}:${key}`;
    const blockKey = `throttle:block:${throttlerName}:${key}`;

    try {
      const [totalHits, timeToExpire, blocked, timeToBlockExpire] = (await this.redis.client.eval(
        INCREMENT_SCRIPT,
        2,
        hitsKey,
        blockKey,
        String(ttl),
        String(limit),
        String(blockDuration),
      )) as [number, number, number, number];

      return {
        totalHits,
        timeToExpire,
        isBlocked: blocked === 1,
        timeToBlockExpire,
      };
    } catch (error) {
      this.logger.error(
        `Rate-limit check failed for ${hitsKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
