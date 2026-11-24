import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { createRequestContext, requestContext } from '@/common/request-context';

import { assertTenantModelCoverage } from './tenant-models';
import { withTenancy, type TenantScopedClient } from './tenancy.extension';

const isDevelopment = (process.env.NODE_ENV ?? 'development') === 'development';
const isQueryLoggingEnabled = isDevelopment && process.env.PRISMA_LOG === 'true';

/**
 * Prisma access point for the whole API.
 *
 * - `client` is the tenant-scoped client — use it everywhere in request paths.
 * - `raw` is the unscoped client. Reach for it only when you have already
 *   handled scoping yourself (health checks, migrations, seeding).
 * - `asSystem` temporarily lifts tenant scoping for the wrapped work. It is the
 *   sanctioned escape hatch for cross-tenant operations such as resolving a
 *   login by email before the tenant is known.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  /** Tenant-scoped client. All feature code uses this. */
  readonly client: TenantScopedClient;

  /** Unscoped client, for health checks and tooling. */
  readonly raw: PrismaClient;

  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    this.raw = new PrismaClient({
      log: isQueryLoggingEnabled
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'stdout', level: 'warn' },
            { emit: 'stdout', level: 'error' },
          ]
        : [
            { emit: 'stdout', level: 'warn' },
            { emit: 'stdout', level: 'error' },
          ],
    });

    this.client = withTenancy(this.raw);
  }

  async onModuleInit(): Promise<void> {
    await this.raw.$connect();
    this.verifyTenantModelCoverage();
  }

  async onModuleDestroy(): Promise<void> {
    await this.raw.$disconnect();
  }

  /**
   * Verifies every Prisma model is either tenant-scoped or an explicit platform
   * model, so a newly added model can never silently escape isolation.
   *
   * The model names come from the DMMF (PascalCase, as declared in the schema)
   * rather than from the client's own properties, which are camelCase delegate
   * names and would never match the sets in `tenant-models.ts`.
   */
  private verifyTenantModelCoverage(): void {
    const uncovered = assertTenantModelCoverage(
      Prisma.dmmf.datamodel.models.map((model) => model.name),
    );
    if (uncovered.length > 0) {
      this.logger.warn(
        `Prisma models without an isolation decision: ${uncovered.join(', ')}. ` +
          'Add them to TENANT_MODELS or PLATFORM_MODELS in tenant-models.ts.',
      );
    }
  }

  /**
   * Runs `work` without tenant scoping. Nested/scoped callers are unaffected —
   * the previous flag is restored in a `finally`, so this cannot leak.
   */
  async asSystem<T>(work: () => Promise<T>): Promise<T> {
    const current = requestContext.get();
    if (!current) {
      return requestContext.run(createRequestContext({ bypassTenant: true }), work);
    }

    const previous = current.bypassTenant;
    current.bypassTenant = true;
    try {
      return await work();
    } finally {
      current.bypassTenant = previous;
    }
  }

  /** Cheap liveness probe used by the health module. */
  async ping(): Promise<void> {
    await this.raw.$queryRaw`SELECT 1`;
  }
}
