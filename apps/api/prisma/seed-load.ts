/**
 * TalentFlow — bulk candidate loader.
 *
 * Run with:  pnpm db:seed:load   (or `pnpm --filter @talentflow/api prisma:seed:load`)
 *
 * The demo seed (`seed.ts`) produces a realistic but small workspace (~100
 * candidates). Search, duplicate detection and the list filters all rely on
 * `pg_trgm` and GIN indexes, and those only start behaving like production once
 * the table has a real volume of rows — a missing or unused index is invisible
 * at 100 rows and a full scan at 100k.
 *
 * This script tops the demo workspace up to `SEED_LOAD_COUNT` (default 100 000)
 * candidates using a single `INSERT ... SELECT FROM generate_series`, so it is
 * bounded by Postgres rather than by Node round-trips. Load rows are prefixed
 * `load_` and deleted before each run, which keeps the script idempotent and
 * leaves the curated demo data untouched.
 *
 * After running it, check a filter plan with:
 *   EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM candidates
 *     WHERE "tenantId" = '...' AND "searchVector" @@ websearch_to_tsquery('simple', 'engineer')
 *     ORDER BY "createdAt" DESC LIMIT 25;
 */
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
loadEnv({ path: resolve(process.cwd(), '.env.local'), quiet: true });
loadEnv({ path: resolve(process.cwd(), '.env'), quiet: true });

const prisma = new PrismaClient();

const DEMO_TENANT_SLUG = 'acme-demo';

const FIRST_NAMES = [
  'Aarav', 'Sofia', 'Liam', 'Mei', 'Noah', 'Amara', 'Ethan', 'Priya',
  'Lucas', 'Zara', 'Mateo', 'Hana', 'Omar', 'Elena', 'Kai', 'Isabel',
  'Ravi', 'Nina', 'Diego', 'Leila', 'Tomas', 'Anya', 'Marco', 'Yuki',
];

const LAST_NAMES = [
  'Sharma', 'Rossi', 'Nakamura', 'Okafor', 'Silva', 'Kowalski', 'Haddad',
  'Nguyen', 'Petrov', 'Almeida', 'Fischer', 'Novak', 'Ibrahim', 'Fernandez',
  'Kaur', 'Larsen', 'Moretti', 'Chen', 'Abadi', 'Duarte',
];

const TITLES = [
  'Backend Engineer', 'Frontend Engineer', 'Full Stack Engineer', 'Platform Engineer',
  'Site Reliability Engineer', 'Data Engineer', 'Machine Learning Engineer',
  'DevOps Engineer', 'Mobile Engineer', 'Engineering Manager', 'Product Designer',
  'QA Engineer', 'Security Engineer', 'Solutions Architect', 'Technical Lead',
];

const COMPANIES = [
  'Northwind Retail Group', 'Globex Financial', 'Initech Payments', 'Umbrella Health',
  'Acme Industrial', 'Stark Logistics', 'Wayne Manufacturing', 'Soylent Foods',
  'Hooli Cloud', 'Vandelay Imports', 'Pied Piper', 'Cyberdyne Robotics',
];

const CITIES = [
  'Austin', 'Seattle', 'Denver', 'Boston', 'Chicago', 'Atlanta', 'Portland',
  'San Diego', 'Minneapolis', 'Phoenix', 'Raleigh', 'Nashville',
];

const STATES = [
  'TX', 'WA', 'CO', 'MA', 'IL', 'GA', 'OR', 'CA', 'MN', 'AZ', 'NC', 'TN',
];

async function main(): Promise<void> {
  const startedAt = Date.now();
  const target = Number(process.env.SEED_LOAD_COUNT ?? 100_000);

  if (!Number.isFinite(target) || target <= 0) {
    throw new Error(`SEED_LOAD_COUNT must be a positive integer (received "${process.env.SEED_LOAD_COUNT}")`);
  }

  const tenant = await prisma.tenant.findFirst({
    where: { slug: DEMO_TENANT_SLUG },
    select: { id: true, name: true },
  });

  if (!tenant) {
    throw new Error(`Workspace "${DEMO_TENANT_SLUG}" not found — run \`pnpm db:seed\` first.`);
  }

  const recruiter = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: { endsWith: '@acme-demo.test' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  console.log('\nTalentFlow bulk load\n--------------------');
  console.log(`  workspace        ${tenant.name} (${tenant.id})`);
  console.log(`  target           ${target.toLocaleString()} candidates`);

  console.log('  clearing previous load rows…');
  const removed = await prisma.$executeRawUnsafe(
    'DELETE FROM candidates WHERE "tenantId" = $1 AND id LIKE $2',
    tenant.id,
    'load_%',
  );
  if (removed > 0) console.log(`  removed          ${removed.toLocaleString()} rows`);

  const inserted = await prisma.$executeRawUnsafe(
    `
    INSERT INTO candidates (
      id, "tenantId",
      "firstName", "lastName", email, phone,
      "currentTitle", "currentCompany",
      "locationCity", "locationState", "locationCountry",
      "totalExperienceMonths", "relevantExperienceMonths", "experienceLevel",
      "workAuthorization", availability, "noticePeriodDays",
      "expectedSalaryCents", "expectedSalaryCurrency",
      source, status, "isHot", tags, "customFields",
      "dedupeKey", "emailNormalized", "phoneNormalized",
      "ownerId", "createdAt", "updatedAt"
    )
    SELECT
      'load_' || lpad(i::text, 6, '0'),
      $1::text,
      ($2::text[])[1 + (i % array_length($2::text[], 1))],
      ($3::text[])[1 + ((i * 7) % array_length($3::text[], 1))],
      lower(($2::text[])[1 + (i % array_length($2::text[], 1))]) || '.' ||
        lower(($3::text[])[1 + ((i * 7) % array_length($3::text[], 1))]) || i || '@load-mail.test',
      '+1 ' || (200 + (i % 790)) || ' 555 ' || lpad((1000 + (i % 9000))::text, 4, '0'),
      ($4::text[])[1 + ((i * 3) % array_length($4::text[], 1))],
      ($5::text[])[1 + ((i * 5) % array_length($5::text[], 1))],
      ($6::text[])[1 + ((i * 11) % array_length($6::text[], 1))],
      ($7::text[])[1 + ((i * 13) % array_length($7::text[], 1))],
      'United States',
      24 + (i % 192),
      24 + (i % 192) - (i % 12),
      (ARRAY['JUNIOR','MID','SENIOR','LEAD','PRINCIPAL'])[1 + (i % 5)]::"ExperienceLevel",
      'UNKNOWN'::"WorkAuthorization",
      (ARRAY['IMMEDIATE','TWO_WEEKS','ONE_MONTH','TWO_MONTHS','THREE_MONTHS'])[1 + (i % 5)]::"Availability",
      (ARRAY[0,14,30,60])[1 + (i % 4)],
      12000000 + (i % 9000000),
      'USD',
      (ARRAY['LINKEDIN','INDEED','JOB_BOARD','REFERRAL','WEBSITE','AGENCY','MANUAL'])[1 + (i % 7)]::"CandidateSource",
      'ACTIVE',
      (i % 9 = 0),
      ARRAY['load-test'],
      '{}'::jsonb,
      lower(($2::text[])[1 + (i % array_length($2::text[], 1))]) || ' ' ||
        lower(($3::text[])[1 + ((i * 7) % array_length($3::text[], 1))]) || '|' || i,
      lower(($2::text[])[1 + (i % array_length($2::text[], 1))]) || '.' ||
        lower(($3::text[])[1 + ((i * 7) % array_length($3::text[], 1))]) || i || '@load-mail.test',
      (200 + (i % 790))::text || '555' || lpad((1000 + (i % 9000))::text, 4, '0'),
      $8::text,
      now() - ((i % 120) * interval '1 day'),
      now() - ((i % 120) * interval '1 day')
    FROM generate_series(1, $9::int) AS i
    `,
    tenant.id,
    FIRST_NAMES,
    LAST_NAMES,
    TITLES,
    COMPANIES,
    CITIES,
    STATES,
    recruiter?.id ?? null,
    target,
  );

  const total = await prisma.candidate.count({ where: { tenantId: tenant.id } });

  console.log(`  inserted         ${inserted.toLocaleString()} rows`);
  console.log(`  tenant total     ${total.toLocaleString()} candidates`);
  console.log(`\n  done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
}

main()
  .catch((error: unknown) => {
    console.error('\n  Load failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
