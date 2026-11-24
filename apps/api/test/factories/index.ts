import { randomUUID } from 'node:crypto';

import { hash } from '@node-rs/argon2';
import type { Prisma, Tenant, User } from '@prisma/client';
import {
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_REJECTION_REASONS,
  ROLE_KEY_DESCRIPTIONS,
  ROLE_KEY_LABELS,
  ROLE_PERMISSION_TEMPLATES,
  ROLE_PRIORITY,
  TENANT_ROLE_KEYS,
  type RoleKey,
} from '@talentflow/types';

import { getSystemPrisma } from '../utils/db';

/**
 * Fixture builders.
 *
 * Everything here writes through the **owner** connection (`getSystemPrisma`),
 * not the application's `PrismaService`. That is deliberate: fixtures describe
 * the world a request then runs against, and using the app's tenant-scoped
 * client would silently inherit the scoping the tests are meant to prove.
 */

/** Matches the Argon2id parameters in `.env` so hashes look production-shaped. */
export const TEST_PASSWORD = 'Passw0rd!23';
const ARGON2ID = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID as never,
  memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 19456),
  timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
  parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
};

/** One hash per suite-run: Argon2 is slow on purpose, and the plaintext repeats. */
let passwordHash: string | undefined;

async function hashedTestPassword(): Promise<string> {
  passwordHash ??= await hash(TEST_PASSWORD, ARGON2_OPTIONS);
  return passwordHash;
}

export async function createTenant(
  overrides: Partial<Prisma.TenantUncheckedCreateInput> = {},
): Promise<Tenant> {
  const suffix = randomUUID().slice(0, 8);
  const name = `Test Workspace ${suffix}`;

  return getSystemPrisma().tenant.create({
    data: {
      name,
      slug: `test-${suffix}`,
      status: 'ACTIVE',
      // Mirrors what `AuthService.signup` writes: `buildSessionTenant` parses
      // these keys with `tenantSettingsSchema`, so a tenant without them cannot
      // produce a session at all.
      settings: {
        legalName: name,
        timezone: 'UTC',
        currency: 'USD',
        dateFormat: 'MM/DD/YYYY',
      },
      ...overrides,
    },
  });
}

/**
 * Plans are catalogue rows that `prisma db seed` normally creates in the
 * development database. The test database is migrated but never seeded, and
 * signing a workspace up resolves a plan by code — so the codes the signup
 * schema accepts have to exist here too. Idempotent, and `plans` is excluded
 * from truncation so this runs at most once per database.
 */
const PLAN_CODES = [
  ['STARTER', 'Starter'],
  ['GROWTH', 'Growth'],
  ['PRO', 'Pro'],
  ['ENTERPRISE', 'Enterprise'],
] as const;

export async function ensurePlanCatalogue(): Promise<void> {
  const prisma = getSystemPrisma();

  for (const [index, [code, name]] of PLAN_CODES.entries()) {
    await prisma.plan.upsert({
      where: { code },
      update: {},
      create: { code, name, sortOrder: index + 1 },
    });
  }
}

/**
 * Materialises the five built-in roles for a tenant exactly the way
 * `AuthService.createSystemRoles` does at signup — same templates, same
 * priority ordering. The permission rows are seeded by `RbacService` on boot.
 */
export async function seedTenantRoles(tenantId: string): Promise<Map<RoleKey, string>> {
  const prisma = getSystemPrisma();
  const permissions = await prisma.permission.findMany({ select: { id: true, key: true } });

  if (permissions.length === 0) {
    throw new Error(
      'The permission catalogue is empty. Boot the test app (RbacService seeds it) before creating fixtures.',
    );
  }

  const idByKey = new Map(permissions.map((permission) => [permission.key, permission.id]));
  const roleIdByKey = new Map<RoleKey, string>();

  for (const key of TENANT_ROLE_KEYS) {
    const role = await prisma.role.create({
      data: {
        tenantId,
        key,
        name: ROLE_KEY_LABELS[key],
        description: ROLE_KEY_DESCRIPTIONS[key],
        priority: ROLE_PRIORITY[key],
        isSystem: true,
      },
    });
    roleIdByKey.set(key, role.id);

    const permissionIds = ROLE_PERMISSION_TEMPLATES[key]
      .map((permissionKey) => idByKey.get(permissionKey))
      .filter((id): id is string => Boolean(id));

    if (permissionIds.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ tenantId, roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
  }

  return roleIdByKey;
}

/** Creates the tenant-default pipeline (one row per `DEFAULT_PIPELINE_STAGES`). */
export async function seedDefaultPipeline(tenantId: string): Promise<string[]> {
  const prisma = getSystemPrisma();

  await prisma.jobPipelineStage.createMany({
    data: DEFAULT_PIPELINE_STAGES.map((stage, index) => ({
      tenantId,
      key: stage.key,
      name: stage.name,
      type: stage.type,
      category: stage.category,
      color: stage.color,
      order: index,
      isDefault: 'isDefault' in stage ? Boolean(stage.isDefault) : false,
      isTerminal: 'isTerminal' in stage ? Boolean(stage.isTerminal) : false,
      slaDays: 'slaDays' in stage ? stage.slaDays : null,
    })),
  });

  const stages = await prisma.jobPipelineStage.findMany({
    where: { tenantId },
    orderBy: { order: 'asc' },
    select: { id: true },
  });
  return stages.map((stage) => stage.id);
}

/**
 * Seeds the tenant's built-in rejection reasons exactly as provisioning does.
 * They are `isSystem` rows, so a suite can rely on at least one reason that the
 * API refuses to delete.
 */
export async function seedRejectionReasons(tenantId: string): Promise<string[]> {
  const prisma = getSystemPrisma();

  await prisma.rejectionReason.createMany({
    data: DEFAULT_REJECTION_REASONS.map((reason, index) => ({
      tenantId,
      key: reason.key,
      label: reason.label,
      order: index,
      isActive: true,
      isSystem: true,
    })),
  });

  const reasons = await prisma.rejectionReason.findMany({
    where: { tenantId },
    orderBy: { order: 'asc' },
    select: { id: true },
  });
  return reasons.map((reason) => reason.id);
}

export interface CreateUserOptions {
  tenantId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  /** Built-in role to grant. Omit for a user with no roles at all. */
  roleKey?: RoleKey;
  /** Skips the password hash (an invited user has none yet). */
  withPassword?: boolean;
  status?: Prisma.UserUncheckedCreateInput['status'];
  isSuperAdmin?: boolean;
  /** `null` models an account that has not confirmed its email. */
  emailVerified?: boolean;
}

export async function createUser(options: CreateUserOptions): Promise<User> {
  const prisma = getSystemPrisma();
  const suffix = randomUUID().slice(0, 8);
  const {
    tenantId,
    roleKey,
    withPassword = true,
    status = 'ACTIVE',
    isSuperAdmin = false,
    emailVerified = true,
  } = options;

  const user = await prisma.user.create({
    data: {
      tenantId,
      email: options.email ?? `user-${suffix}@example.test`,
      firstName: options.firstName ?? 'Test',
      lastName: options.lastName ?? 'User',
      status,
      isSuperAdmin,
      emailVerifiedAt: emailVerified ? new Date() : null,
      passwordHash: withPassword ? await hashedTestPassword() : null,
    },
  });

  if (roleKey) {
    const role = await prisma.role.findFirst({ where: { tenantId, key: roleKey } });
    if (!role) {
      throw new Error(`Role ${roleKey} is not provisioned for tenant ${tenantId}.`);
    }
    await prisma.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id } });
  }

  return user;
}

export interface TenantScenario {
  tenant: Tenant;
  /** TENANT_ADMIN — holds every tenant permission. */
  admin: User;
  /** RECRUITER — holds `job:*_all`, `candidate:*_all` and the `list:*` keys. */
  recruiter: User;
  /** VIEWER — read-only, so any mutating request must be rejected. */
  viewer: User;
  /** Tenant-default stage ids, in order. */
  stages: string[];
  /** Built-in rejection-reason ids, in order. */
  rejectionReasons: string[];
  roles: Map<RoleKey, string>;
}

/**
 * A fully provisioned workspace: tenant, built-in roles, default pipeline and
 * three users spanning the permission spectrum. This is what most suites need,
 * and building it once per test keeps every suite's `beforeEach` a single line.
 */
export async function createTenantScenario(
  overrides: Partial<Prisma.TenantUncheckedCreateInput> = {},
): Promise<TenantScenario> {
  const tenant = await createTenant(overrides);
  const roles = await seedTenantRoles(tenant.id);
  const stages = await seedDefaultPipeline(tenant.id);
  const rejectionReasons = await seedRejectionReasons(tenant.id);
  const suffix = randomUUID().slice(0, 6);

  const [admin, recruiter, viewer] = await Promise.all([
    createUser({
      tenantId: tenant.id,
      roleKey: 'TENANT_ADMIN',
      email: `admin-${suffix}@example.test`,
      firstName: 'Ada',
      lastName: 'Admin',
    }),
    createUser({
      tenantId: tenant.id,
      roleKey: 'RECRUITER',
      email: `recruiter-${suffix}@example.test`,
      firstName: 'Rex',
      lastName: 'Recruiter',
    }),
    createUser({
      tenantId: tenant.id,
      roleKey: 'VIEWER',
      email: `viewer-${suffix}@example.test`,
      firstName: 'Vic',
      lastName: 'Viewer',
    }),
  ]);

  return { tenant, admin, recruiter, viewer, stages, rejectionReasons, roles };
}

export async function createClient(
  tenantId: string,
  overrides: Partial<Prisma.ClientUncheckedCreateInput> = {},
) {
  const suffix = randomUUID().slice(0, 8);

  return getSystemPrisma().client.create({
    data: {
      tenantId,
      name: `Client ${suffix}`,
      status: 'ACTIVE',
      ...overrides,
    },
  });
}

export async function createJob(
  tenantId: string,
  overrides: Partial<Prisma.JobUncheckedCreateInput> = {},
) {
  const suffix = randomUUID().slice(0, 8);

  return getSystemPrisma().job.create({
    data: {
      tenantId,
      title: `Job ${suffix}`,
      referenceCode: `JOB-${suffix.toUpperCase()}`,
      status: 'OPEN',
      ...overrides,
    },
  });
}

export async function createCandidate(
  tenantId: string,
  overrides: Partial<Prisma.CandidateUncheckedCreateInput> = {},
) {
  const suffix = randomUUID().slice(0, 8);

  return getSystemPrisma().candidate.create({
    data: {
      tenantId,
      firstName: 'Casey',
      lastName: `Candidate ${suffix}`,
      email: `candidate-${suffix}@example.test`,
      ...overrides,
    },
  });
}

export interface CreateApplicationOptions {
  tenantId: string;
  jobId: string;
  candidateId: string;
  /** Defaults to the first stage of the tenant pipeline. */
  stageId: string;
  ownerId?: string;
}

export async function createApplication(options: CreateApplicationOptions) {
  return getSystemPrisma().application.create({
    data: {
      tenantId: options.tenantId,
      jobId: options.jobId,
      candidateId: options.candidateId,
      stageId: options.stageId,
      ownerId: options.ownerId ?? null,
    },
  });
}
