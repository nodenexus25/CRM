/**
 * Applies `prisma/rls.sql` and verifies the result.
 *
 * Run with:  pnpm --filter @talentflow/api prisma:rls
 *
 * Layer 3 of tenant isolation is Row Level Security in Postgres. It only
 * actually binds a connection when the connecting role is neither the table
 * owner, a superuser, nor a member of `BYPASSRLS` — so this script finishes by
 * reporting exactly which of those applies to the current `DATABASE_URL` role.
 * That report is the difference between "RLS is configured" and "RLS is doing
 * something".
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';

import { TENANT_MODELS } from '../src/infra/prisma/tenant-models';

for (const file of ['../../.env', '.env.local', '.env']) {
  loadEnv({ path: resolve(process.cwd(), file), quiet: true });
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

interface TableRlsRow {
  relname: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
  policy_count: number;
}

interface RoleRow {
  current_role: string;
  is_superuser: boolean;
  bypass_rls: boolean;
}

interface CountRow {
  owned_tables: number;
  tenant_tables: number;
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const appRole = process.env.RLS_APP_ROLE ?? 'talentflow_app';
  if (!IDENTIFIER.test(appRole)) {
    fail(`RLS_APP_ROLE must be a bare lowercase identifier (got "${appRole}")`);
  }

  const force = (process.env.RLS_FORCE ?? 'false').toLowerCase() === 'true';
  const sqlPath = resolve(__dirname, 'rls.sql');
  // `replaceAll`: the token is also mentioned in the script's header comment,
  // so a single-occurrence replace would rewrite the comment while leaving the
  // `app_role` assignment — sending every GRANT to a literal `__APP_ROLE__`.
  const script = readFileSync(sqlPath, 'utf8')
    .replaceAll('__APP_ROLE__', appRole)
    .replace(/__FORCE_CLAUSE__/g, force ? 'FORCE' : 'NO FORCE');

  const prisma = new PrismaClient();

  try {
    console.log(`\n  Applying RLS from ${sqlPath}`);
    console.log(`  app role: ${appRole}   force: ${force}\n`);

    await prisma.$executeRawUnsafe(script);

    const tables = await prisma.$queryRawUnsafe<TableRlsRow[]>(`
      SELECT c.relname,
             c.relrowsecurity,
             c.relforcerowsecurity,
             (SELECT count(*)::int
                FROM pg_policies p
               WHERE p.schemaname = 'public'
                 AND p.tablename = c.relname
                 AND p.policyname = 'tenant_isolation') AS policy_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
         AND EXISTS (
               SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = c.oid
                  AND a.attname = 'tenantId'
                  AND a.attnum > 0
                  AND NOT a.attisdropped
             )
       ORDER BY c.relname
    `);

    const missingPolicy = tables.filter((t) => !t.relrowsecurity || t.policy_count !== 1);
    if (missingPolicy.length > 0) {
      fail(
        `RLS is incomplete on: ${missingPolicy
          .map((t) => `${t.relname} (enabled=${t.relrowsecurity}, policies=${t.policy_count})`)
          .join(', ')}`,
      );
    }

    if (tables.length !== TENANT_MODELS.size) {
      console.warn(
        `  Warning: ${tables.length} tables carry a "tenantId" column but TENANT_MODELS lists ${TENANT_MODELS.size} models.\n` +
          '  Add the new table to the array inside prisma/rls.sql (and to tenant-models.ts).\n',
      );
    }

    const [role] = await prisma.$queryRawUnsafe<RoleRow[]>(`
      SELECT current_user AS current_role, rolsuper AS is_superuser, rolbypassrls AS bypass_rls
        FROM pg_roles
       WHERE rolname = current_user
    `);

    const [counts] = await prisma.$queryRawUnsafe<CountRow[]>(`
      SELECT (SELECT count(*)::int
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relkind = 'r'
                 AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)) AS owned_tables,
             (SELECT count(*)::int
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relkind = 'r'
                 AND EXISTS (
                       SELECT 1 FROM pg_attribute a
                        WHERE a.attrelid = c.oid AND a.attname = 'tenantId'
                          AND a.attnum > 0 AND NOT a.attisdropped
                     )) AS tenant_tables
    `);

    const rlsBindsCurrentRole =
      role !== undefined &&
      counts !== undefined &&
      !role.is_superuser &&
      !role.bypass_rls &&
      counts.owned_tables === 0;

    console.log(`  Policies created : ${tables.length} tables (tenant_isolation)`);
    console.log(`  Runtime role     : ${role?.current_role ?? 'unknown'}`);
    console.log(
      `  Role attributes  : superuser=${role?.is_superuser ?? '?'} bypassrls=${role?.bypass_rls ?? '?'} owns=${counts?.owned_tables ?? '?'} table(s)`,
    );

    if (rlsBindsCurrentRole) {
      console.log('\n  RLS binds the current DATABASE_URL role. Layer 3 is active.\n');
    } else {
      console.log(
        '\n  RLS does NOT bind the current DATABASE_URL role (it is the table owner and/or BYPASSRLS).\n' +
          `  Layer 2 (the Prisma tenancy extension) remains the enforcement path for app traffic.\n` +
          `  To activate layer 3, point the API at a non-owner login that is a member of "${appRole}"\n` +
          '  and set app.tenant_id per transaction, e.g.\n' +
          '      SELECT set_config(\'app.tenant_id\', $1, true);\n' +
          '  inside the same transaction as the query.\n',
      );
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await prisma.$disconnect();
  }
}

void main();
