import { Throttle } from '@nestjs/throttler';

function readPositiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const AUTH_LIMIT = readPositiveNumber('THROTTLE_AUTH_LIMIT', 10);
const AUTH_TTL_MS = readPositiveNumber('THROTTLE_AUTH_TTL', 60) * 1000;

/**
 * A tighter budget for credential endpoints.
 *
 * Sign-in, signup, password reset and token refresh are the routes worth
 * brute-forcing, so they get their own, stricter window regardless of how
 * generous the global limit is.
 */
export const AuthRateLimit = () => Throttle({ default: { limit: AUTH_LIMIT, ttl: AUTH_TTL_MS } });
