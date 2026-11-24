/**
 * Constants describing the integration-test database.
 *
 * Kept in one module so `prisma/test-db.ts` (which provisions them) and the
 * suite itself can never disagree about names or credentials.
 */

export const TEST_DATABASE = 'talentflow_test';
export const TEST_ROLE = 'talentflow_app_test';
export const TEST_ROLE_PASSWORD = 'talentflow_test_pw';

/** Redis logical database reserved for tests, so dev queues are untouched. */
export const TEST_REDIS_DB = 1;

/** Rewrites a Postgres URL onto another database (and optionally role). */
export function databaseUrlFor(
  database: string,
  options: { user?: string; password?: string } = {},
): string {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env first.');
  }

  const url = new URL(base);
  url.pathname = `/${database}`;
  url.searchParams.set('schema', 'public');
  if (options.user) {
    url.username = options.user;
    url.password = options.password ?? '';
  }
  return url.toString();
}

/** Connection string for the owner role — used to seed fixtures and truncate. */
export function ownerTestUrl(): string {
  return databaseUrlFor(TEST_DATABASE);
}

/**
 * Connection string for the non-owner, NOBYPASSRLS role. Postgres applies the
 * `tenant_isolation` policies to this connection, which is what makes the RLS
 * suite meaningful.
 */
export function rlsTestUrl(): string {
  return databaseUrlFor(TEST_DATABASE, {
    user: TEST_ROLE,
    password: TEST_ROLE_PASSWORD,
  });
}

/** Redis URL pinned to the test logical database. */
export function testRedisUrl(): string {
  const base = process.env.REDIS_URL ?? 'redis://localhost:6380';
  const url = new URL(base);
  url.pathname = `/${TEST_REDIS_DB}`;
  return url.toString();
}
