import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from '@talentflow/types';

import { AllowNoTenant } from '@/common/decorators/allow-no-tenant.decorator';
import { NoEnvelope } from '@/common/decorators/no-envelope.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { RedisService } from '@/infra/redis/redis.service';

const SERVICE_VERSION = process.env.APP_VERSION ?? '0.1.0';

/**
 * Liveness and readiness probes.
 *
 * Both are public and unauthenticated on purpose — an orchestrator has no
 * credentials, and neither endpoint reveals anything beyond up/down. They also
 * skip the response envelope so probes see the documented `HealthResponse`.
 */
@ApiTags('health')
@Public()
@AllowNoTenant()
@NoEnvelope()
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Liveness: is the process up and serving requests. */
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  live(): HealthResponse {
    return {
      status: 'ok',
      uptime: this.uptime,
      version: SERVICE_VERSION,
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: can the process actually serve traffic (datastores reachable). */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — checks Postgres and Redis' })
  async ready(): Promise<HealthResponse> {
    const [database, cache] = await Promise.all([
      timed(() => this.prisma.ping()),
      timed(() => this.redis.ping()),
    ]);

    const healthy = database.status === 'up' && cache.status === 'up';

    return {
      status: healthy ? 'ok' : 'error',
      uptime: this.uptime,
      version: SERVICE_VERSION,
      timestamp: new Date().toISOString(),
      dependencies: { database, redis: cache },
    };
  }

  private get uptime(): number {
    return Math.round((Date.now() - this.startedAt) / 1000);
  }
}

/** Runs a dependency check and records how long it took, never throwing. */
async function timed(
  check: () => Promise<unknown>,
): Promise<{ status: 'up' | 'down'; latencyMs?: number; error?: string }> {
  const startedAt = Date.now();
  try {
    await check();
    return { status: 'up', latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
