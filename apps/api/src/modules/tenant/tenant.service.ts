import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  tenantSettingsSchema,
  type TenantDetail,
  type TenantSettings,
  type UpdateTenantRequest,
} from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import { ForbiddenError, NotFoundError } from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import { PrismaService } from '@/infra/prisma/prisma.service';

const TENANT_DEFAULTS = {
  currency: 'USD',
  timezone: 'UTC',
  dateFormat: 'MM/DD/YYYY',
} satisfies Pick<TenantSettings, 'currency' | 'timezone' | 'dateFormat'>;

/**
 * The workspace profile: identity, branding, locale defaults and the
 * high-level submission preferences.
 *
 * Settings live in a single JSON column so a new preference never needs a
 * migration; they are validated by `tenantSettingsSchema` before being written
 * so the column can never hold a shape the client does not understand.
 */
@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async detail(): Promise<TenantDetail> {
    const tenantId = requireTenant();

    const [tenant, memberCounts] = await Promise.all([
      this.prisma.client.tenant.findFirst({
        where: { id: tenantId, deletedAt: null },
        include: {
          subscription: { include: { plan: { select: { code: true, name: true } } } },
        },
      }),
      this.memberCounts(tenantId),
    ]);

    if (!tenant) throw new NotFoundError('Workspace', tenantId);

    const settings = parseSettings(tenant.settings);

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      logoUrl: tenant.logoUrl,
      brandColor: tenant.brandColor,
      timezone: settings.timezone ?? TENANT_DEFAULTS.timezone,
      currency: settings.currency ?? TENANT_DEFAULTS.currency,
      createdAt: tenant.createdAt.toISOString(),
      trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
      primaryDomain: tenant.primaryDomain,
      planCode: tenant.subscription?.plan.code ?? null,
      planName: tenant.subscription?.plan.name ?? null,
      settings,
      memberCounts,
    };
  }

  async update(input: UpdateTenantRequest): Promise<TenantDetail> {
    const tenantId = requireTenant();
    const current = await this.prisma.client.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: { id: true, name: true, settings: true },
    });
    if (!current) throw new NotFoundError('Workspace', tenantId);

    const data: Prisma.TenantUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.logoUrl !== undefined) data.logoUrl = input.logoUrl;
    if (input.brandColor !== undefined) data.brandColor = input.brandColor;
    if (input.primaryDomain !== undefined) data.primaryDomain = input.primaryDomain;

    if (input.settings) {
      // Merge rather than replace: the settings screen submits only the keys it
      // owns, and the rest of the workspace must keep working.
      const merged = { ...parseSettings(current.settings), ...input.settings };
      data.settings = tenantSettingsSchema.partial().parse(merged);
    }

    await this.prisma.client.tenant.update({ where: { id: tenantId }, data });

    await this.audit.record({
      action: 'UPDATE',
      entity: 'Tenant',
      entityId: tenantId,
      description: `Updated workspace settings for ${input.name ?? current.name}`,
      changes: input.settings ? { settings: input.settings } : undefined,
    });

    return this.detail();
  }

  private async memberCounts(tenantId: string): Promise<TenantDetail['memberCounts']> {
    const [total, active, invited] = await Promise.all([
      this.prisma.client.user.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.client.user.count({ where: { tenantId, deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.client.user.count({ where: { tenantId, deletedAt: null, status: 'INVITED' } }),
    ]);

    return { total, active, invited };
  }
}

/** `settings` is JSON, so it must be re-validated on every read. */
function parseSettings(value: unknown): Partial<TenantSettings> {
  const parsed = tenantSettingsSchema.partial().safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

function requireTenant(): string {
  const tenantId = requestContext.tenantId;
  if (!tenantId) throw new ForbiddenError('This action must run inside a workspace.');
  return tenantId;
}
