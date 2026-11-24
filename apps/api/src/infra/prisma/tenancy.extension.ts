import { Prisma, type PrismaClient } from '@prisma/client';

import { TenantIsolationError } from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';

import { TENANT_MODELS } from './tenant-models';

type ArgsBag = Record<string, unknown>;

/** Operations whose `where` clause must be widened with `tenantId`. */
const WHERE_OPERATIONS = new Set<string>([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

/** Operations that write new rows and therefore need `tenantId` in `data`. */
const CREATE_OPERATIONS = new Set<string>(['create', 'createMany', 'createManyAndReturn']);

/**
 * Merges `tenantId` into a payload. The tenant always wins over any value the
 * caller supplied, so a crafted request body cannot write into another tenant.
 */
function withTenant(payload: unknown, tenantId: string): ArgsBag {
  return { ...(payload as ArgsBag | undefined), tenantId };
}

/** Rewrites the query arguments so the statement can only touch one tenant. */
function scopeArgs(operation: string, args: unknown, tenantId: string): ArgsBag {
  const next: ArgsBag = { ...(args as ArgsBag | undefined) };

  if (operation === 'upsert') {
    next.where = withTenant(next.where, tenantId);
    next.create = withTenant(next.create, tenantId);
    return next;
  }

  if (WHERE_OPERATIONS.has(operation)) {
    next.where = withTenant(next.where, tenantId);
    return next;
  }

  if (operation === 'create') {
    next.data = withTenant(next.data, tenantId);
    return next;
  }

  if (CREATE_OPERATIONS.has(operation)) {
    next.data = Array.isArray(next.data)
      ? (next.data as unknown[]).map((row) => withTenant(row, tenantId))
      : withTenant(next.data, tenantId);
    return next;
  }

  return next;
}

/**
 * Layer 2 of tenant isolation.
 *
 * Every Prisma operation against a tenant-owned model is rewritten to include
 * `tenantId`, and any attempt to run one without a tenant in context throws a
 * loud `TenantIsolationError` rather than quietly scanning all tenants. Layer 1
 * is the request context; layer 3 is Postgres Row Level Security.
 *
 * Raw SQL (`$queryRaw*`, `$executeRaw*`) is intentionally not intercepted — it
 * is covered by RLS, and callers must set `app.tenant_id` explicitly.
 */
export const tenancyExtension = Prisma.defineExtension({
  name: 'tenant-isolation',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!model || !TENANT_MODELS.has(model)) {
          return query(args);
        }

        const context = requestContext.get();
        if (context?.bypassTenant) {
          return query(args);
        }

        const tenantId = context?.tenantId;
        if (!tenantId) {
          throw new TenantIsolationError(model, operation);
        }

        const scoped = scopeArgs(operation, args, tenantId);
        return query(scoped as typeof args);
      },
    },
  },
});

/** Applies the tenancy extension to a Prisma client instance. */
export function withTenancy(prisma: PrismaClient) {
  return prisma.$extends(tenancyExtension);
}

export type TenantScopedClient = ReturnType<typeof withTenancy>;
