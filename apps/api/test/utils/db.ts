import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

import { ownerTestUrl, rlsTestUrl, testRedisUrl } from './test-env';

/**
 * Database handles used by the integration suite.
 *
 * - `systemPrisma` connects as the **table owner** and is how fixtures are
 *   created, truncated and inspected. It is deliberately not the handle the
 *   application uses: mixing the two would make the RLS suite prove nothing.
 * - `rlsPrisma` connects as `talentflow_app_test` — a login that is neither the
 *   owner, a superuser, nor BYPASSRLS — so Postgres applies the
 *   `tenant_isolation` policies for real.
 *
 * The API under test connects through its own `PrismaService`, wired from
 * `DATABASE_URL` (the owner role) by `setup-e2e.ts`.
 */
let systemClient: PrismaClient | undefined;
let rlsClient: PrismaClient | undefined;

export function getSystemPrisma(): PrismaClient {
  systemClient ??= new PrismaClient({
    datasources: { db: { url: ownerTestUrl() } },
    log: ['error'],
  });
  return systemClient;
}

export function getRlsPrisma(): PrismaClient {
  rlsClient ??= new PrismaClient({
    datasources: { db: { url: rlsTestUrl() } },
    log: ['error'],
  });
  return rlsClient;
}

/**
 * Tables that are *not* tenant data and must survive a truncate.
 *
 * `permissions` and `plans` are catalogue tables shared by every tenant:
 * `RbacService` seeds the first at boot and `ensurePlanCatalogue` seeds the
 * second. Wiping them would leave later suites unable to provision roles or
 * sign a workspace up, for no benefit.
 */
const REFERENCE_TABLES = new Set(['permissions', 'plans']);

/**
 * Every table in the public schema, discovered at runtime rather than listed by
 * hand. A hard-coded list silently goes stale the moment a model is added —
 * which would make cross-suite leakage look like a passing test.
 */
let cachedTables: string[] | undefined;

export async function listTables(): Promise<string[]> {
  if (cachedTables) return cachedTables;

  const rows = await getSystemPrisma().$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  cachedTables = rows.map((row) => row.tablename);
  return cachedTables;
}

/** Empties every table. `CASCADE` covers foreign keys regardless of order. */
export async function truncateAll(): Promise<void> {
  const tables = (await listTables()).filter((table) => !REFERENCE_TABLES.has(table));
  if (tables.length === 0) return;

  const quoted = tables.map((table) => `"public"."${table}"`).join(', ');
  await getSystemPrisma().$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
}

let redisClient: Redis | undefined;

/**
 * Empties the test Redis logical database.
 *
 * RbacService caches a user's permission set in Redis for a minute. Truncating
 * Postgres does not touch that cache, and a suite that changes a user's roles
 * would keep seeing the old set — so the cache is cleared alongside the data.
 */
export async function flushTestRedis(): Promise<void> {
  redisClient ??= new Redis(testRedisUrl(), { lazyConnect: false, maxRetriesPerRequest: 2 });
  await redisClient.flushdb();
}

/** Truncates every tenant table and clears the permission cache. */
export async function resetDatabase(): Promise<void> {
  await truncateAll();
  await flushTestRedis();
}

export async function disconnectTestDatabases(): Promise<void> {
  await Promise.all([systemClient?.$disconnect(), rlsClient?.$disconnect()]);
  redisClient?.disconnect();
  systemClient = undefined;
  rlsClient = undefined;
  redisClient = undefined;
}
