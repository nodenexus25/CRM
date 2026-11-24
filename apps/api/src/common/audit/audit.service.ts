import { Injectable, Logger } from '@nestjs/common';

import type { AuditAction } from '@talentflow/types';

import { PrismaService } from '@/infra/prisma/prisma.service';

import { requestContext } from '../request-context';

export interface AuditInput {
  action: AuditAction;
  /** Domain entity name, e.g. `Job`. */
  entity: string;
  entityId?: string | null;
  /** Field-level diff for updates. */
  changes?: unknown;
  /** Redacted snapshot for creates and deletes. */
  snapshot?: unknown;
  description?: string;
  /** Overrides the ambient tenant — used for platform-level actions. */
  tenantId?: string;
  actorId?: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
}

/**
 * Writes the governance trail.
 *
 * Audit writes never fail the caller: a logging problem must not roll back a
 * successful business operation, so failures are swallowed and reported to the
 * logger instead.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    const context = requestContext.get();
    const tenantId = input.tenantId ?? context?.tenantId;

    // Without a tenant there is nowhere meaningful to file the entry.
    if (!tenantId) {
      this.logger.debug(`Skipped audit entry for ${input.action} ${input.entity} — no tenant context`);
      return;
    }

    const data = {
      tenantId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      changes: input.changes === undefined ? undefined : (input.changes as object),
      snapshot: input.snapshot === undefined ? undefined : (input.snapshot as object),
      description: input.description ?? null,
      actorId: input.actorId ?? context?.userId ?? null,
      actorEmail: input.actorEmail ?? null,
      actorName: input.actorName ?? null,
      ipAddress: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
      requestId: context?.requestId ?? null,
      isImpersonated: context?.isImpersonating ?? false,
    };

    try {
      if (context?.tenantId === tenantId) {
        await this.prisma.client.auditLog.create({ data });
      } else {
        // Explicit tenant outside the ambient scope — e.g. the login attempt
        // that resolved which workspace the email belongs to.
        await this.prisma.asSystem(() => this.prisma.client.auditLog.create({ data }));
      }
    } catch (error) {
      this.logger.error(
        `Failed to write audit entry (${input.action} ${input.entity})`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
