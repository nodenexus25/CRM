/**
 * Provisions the integration-test database and runtime role.
 *
 *   pnpm --filter @talentflow/api test:db:setup
 *
 * Three things happen, all idempotently:
 *
 *  1. `talentflow_test` exists (created from the `postgres` maintenance
 *     database, because `CREATE DATABASE` cannot run inside a transaction).
 *  2. `talentflow_app_test` exists as a **login role that is neither the table
 *     owner, a superuser, nor BYPASSRLS**. That is what makes Postgres Row
 *     Level Security actually bind — see `apply-rls.ts`, which reports exactly
 *     this when run against the development database.
 *  3. Every migration is applied to the test database and `rls.sql` is re-run
 *     with `__APP_ROLE__` pointed at the test role, so the policies and grants
 *     match the role the RLS suite connects with.
 *
 * `docker/initdb/10-test-database.sql` performs steps 1 and 2 for a brand-new
 * Postgres volume; this script exists so an already-initialised volume (the
 * common case) can be brought up to date without `pnpm infra:reset`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';

for (const file of ['../../.env', '.env.local', '.env']) {
  loadEnv({ path: resolve(process.cwd(), file), quiet: true });
}

/** Must stay in sync with `test/utils/db.ts`. */
const TEST_DATABASE = 'talentflow_test';
const TEST_ROLE = 'talentflow_app_test';
const TEST_ROLE_PASSWORD = 'talentflow_test_pw';

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const PASSWORD = /^[A-Za-z0-9_!@#$%^&*.-]{8,128}$/;

function adminUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env first.');
  }
  const url = new URL(base);
  url.pathname = '/postgres';
  url.searchParams.delete('schema');
  return url.toString();
}

function withDatabase(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  url.searchParams.set('schema', 'public');
  return url.toString();
}

function run(label: string, command: string, env: NodeJS.ProcessEnv): void {
  process.stdout.write(`\n  ▸ ${label}\n`);
  execFileSync(command, {
    cwd: resolve(__dirname, '..'),
    env,
    stdio: 'inherit',
    // `pnpm` is a `.cmd` shim on Windows, so the command must go through a shell.
    shell: true,
  });
}

async function main(): Promise<void> {
  if (!IDENTIFIER.test(TEST_DATABASE) || !IDENTIFIER.test(TEST_ROLE)) {
    throw new Error('Test database and role names must be bare lowercase identifiers.');
  }
  if (!PASSWORD.test(TEST_ROLE_PASSWORD)) {
    throw new Error('Test role password must be 8–128 characters and shell-safe.');
  }

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl() } } });

  try {
    const databaseRows = await admin.$queryRawUnsafe<{ exists: boolean }[]>(
      'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      TEST_DATABASE,
    );
    const dbExists = databaseRows[0]?.exists ?? false;

    if (dbExists) {
      process.stdout.write(`\n  ▸ database ${TEST_DATABASE} already exists\n`);
    } else {
      // `CREATE DATABASE` cannot be parameterised; the identifier is validated above.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DATABASE}"`);
      process.stdout.write(`\n  ▸ created database ${TEST_DATABASE}\n`);
    }

    const roleRows = await admin.$queryRawUnsafe<{ exists: boolean }[]>(
      'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists',
      TEST_ROLE,
    );
    const roleExists = roleRows[0]?.exists ?? false;

    if (roleExists) {
      await admin.$executeRawUnsafe(
        `ALTER ROLE "${TEST_ROLE}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${TEST_ROLE_PASSWORD}'`,
      );
      process.stdout.write(`  ▸ refreshed role ${TEST_ROLE}\n`);
    } else {
      await admin.$executeRawUnsafe(
        `CREATE ROLE "${TEST_ROLE}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${TEST_ROLE_PASSWORD}'`,
      );
      process.stdout.write(`  ▸ created role ${TEST_ROLE}\n`);
    }

    await admin.$executeRawUnsafe(
      `GRANT CONNECT ON DATABASE "${TEST_DATABASE}" TO "${TEST_ROLE}"`,
    );
  } finally {
    await admin.$disconnect();
  }

  const testUrl = withDatabase(process.env.DATABASE_URL as string, TEST_DATABASE);
  const baseEnv = { ...process.env, DATABASE_URL: testUrl };

  run('applying migrations to the test database', 'pnpm exec prisma migrate deploy', baseEnv);

  // RLS is applied with the test role substituted in, so the grants the policy
  // script issues land on the same role the RLS suite connects as. `replaceAll`
  // matters: the token also appears in the script's header comment, and a
  // single-occurrence replace would rewrite the comment while leaving the
  // `app_role` assignment — so grants would land on a literal `__APP_ROLE__`.
  const rlsSql = readFileSync(resolve(__dirname, 'rls.sql'), 'utf8')
    .replaceAll('__APP_ROLE__', TEST_ROLE)
    .replace(/__FORCE_CLAUSE__/g, 'NO FORCE');

  const owner = new PrismaClient({ datasources: { db: { url: testUrl } } });
  try {
    await owner.$executeRawUnsafe(rlsSql);
    process.stdout.write('\n  ▸ RLS policies applied to the test database\n');

    const [role] = await owner.$queryRawUnsafe<
      { current_role: string; is_superuser: boolean; bypass_rls: boolean }[]
    >(
      'SELECT rolname AS current_role, rolsuper AS is_superuser, rolbypassrls AS bypass_rls FROM pg_roles WHERE rolname = $1',
      TEST_ROLE,
    );

    process.stdout.write(
      `  ▸ ${TEST_ROLE}: superuser=${role?.is_superuser} bypassrls=${role?.bypass_rls}\n`,
    );

    if (role?.is_superuser || role?.bypass_rls) {
      throw new Error(
        `Refusing to continue: ${TEST_ROLE} must be NOBYPASSRLS so the RLS suite is meaningful.`,
      );
    }
  } finally {
    await owner.$disconnect();
  }

  process.stdout.write(
    '\n  Test database ready. Run `pnpm --filter @talentflow/api test:e2e`.\n\n',
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(`\n  ${error instanceof Error ? error.message : String(error)}\n\n`);
  process.exit(1);
});
