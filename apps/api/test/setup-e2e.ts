/**
 * Runs before any application module is imported (Jest `setupFiles`).
 *
 * Two things have to happen in this order:
 *
 *  1. `.env` is loaded, because `src/env.ts` and `src/config/validation.ts`
 *     expect the same defaults a normal boot would have.
 *  2. The environment is then *overridden* onto the test database, the test
 *     Redis logical database and a throttler limit high enough that a suite
 *     making dozens of requests never trips a 429.
 *
 * `src/env.ts` calls `dotenv.config()` without `override`, so anything assigned
 * here wins — which is exactly the guarantee the suite relies on.
 */
import { resolve } from 'node:path';

import { config as loadEnv } from 'dotenv';

for (const file of ['../../.env', '.env.local', '.env']) {
  loadEnv({ path: resolve(process.cwd(), file), quiet: true });
}

import { ownerTestUrl, testRedisUrl } from './utils/test-env';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = ownerTestUrl();
process.env.REDIS_URL = testRedisUrl();

// Integration suites fire many requests from one IP; per-route limits are baked
// into decorators when the controller class is defined, so they must be lifted
// before the module graph is imported.
process.env.THROTTLE_LIMIT = '1000000';
process.env.THROTTLE_AUTH_LIMIT = '1000000';
process.env.THROTTLE_TTL = '60';
process.env.THROTTLE_AUTH_TTL = '60';

process.env.LOG_LEVEL = 'silent';
process.env.PRISMA_LOG = 'false';
