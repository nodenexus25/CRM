/**
 * Public runtime configuration.
 *
 * Only `NEXT_PUBLIC_*` values reach the browser, so everything here is safe to
 * ship. Each variable is referenced statically — Next.js inlines these at build
 * time and a dynamic lookup (`process.env[name]`) would resolve to `undefined`
 * in the client bundle.
 */

const apiOrigin = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/+$/, '');

const apiPrefix = (process.env.NEXT_PUBLIC_API_PREFIX || 'api/v1').replace(/^\/+|\/+$/g, '');

const appUrl = (
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_URL ||
  'http://localhost:3000'
).replace(/\/+$/, '');

export const env = {
  appName: process.env.NEXT_PUBLIC_APP_NAME || 'TalentFlow',
  /** Public origin of this app, without a trailing slash. */
  appUrl,
  /** Origin of the NestJS API, without a trailing slash. */
  apiOrigin,
  /** Versioned prefix every API route is mounted under. */
  apiPrefix,
  rootDomain: process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'talentflow.app',
} as const;

/** Absolute base URL the API client builds every request from. */
export const apiBaseUrl = `${env.apiOrigin}/${env.apiPrefix}`;
