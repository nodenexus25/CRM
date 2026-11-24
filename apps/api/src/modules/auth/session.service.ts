import { Injectable } from '@nestjs/common';
import type { Prisma, RoleKey } from '@prisma/client';

import {
  tenantSettingsSchema,
  type SessionRole,
  type SessionTenant,
  type SessionUser,
} from '@talentflow/types';

import {
  ForbiddenError,
  TenantRequiredError,
  TenantSuspendedError,
  UnauthorizedError,
} from '@/common/errors/domain-errors';
import type { AccessTokenPayload, AuthenticatedUser } from '@/common/auth/principal';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { RbacService } from '@/modules/rbac/rbac.service';

const SUSPENDED_TENANT_STATUSES = new Set(['SUSPENDED', 'CANCELLED']);
const BLOCKED_USER_STATUSES = new Set(['SUSPENDED', 'DISABLED']);

type UserWithRoles = Prisma.UserGetPayload<{
  include: { userRoles: { include: { role: true } } };
}>;

export type TenantWithPlan = Prisma.TenantGetPayload<{
  include: { subscription: { include: { plan: true } } };
}>;

/**
 * Turns token claims into the authenticated principal, and database rows into
 * the session payload the web app boots from.
 *
 * Every read here happens after the guard has pinned the tenant into the
 * request context, so the tenancy extension scopes it automatically.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  async resolveAuthenticatedUser(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const record = await this.prisma.client.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      include: { userRoles: { include: { role: true } } },
    });

    if (!record) {
      throw new UnauthorizedError('Your session is no longer valid. Sign in again.');
    }

    if (BLOCKED_USER_STATUSES.has(record.status)) {
      throw new ForbiddenError('This account has been disabled. Contact your workspace administrator.');
    }

    await this.requireActiveTenant(record.tenantId);

    const permissions = await this.rbac.resolvePermissionKeys(
      record.id,
      record.tenantId,
      record.isSuperAdmin,
    );

    return {
      id: record.id,
      tenantId: record.tenantId,
      sessionId: payload.sid,
      email: record.email,
      firstName: record.firstName,
      lastName: record.lastName,
      isSuperAdmin: record.isSuperAdmin,
      isImpersonating: Boolean(payload.imp),
      roles: toSessionRoles(record),
      permissions,
    };
  }

  /** Loads a tenant without any scoping — `Tenant` is a platform model. */
  async getTenant(tenantId: string): Promise<TenantWithPlan | null> {
    return this.prisma.client.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      include: { subscription: { include: { plan: true } } },
    });
  }

  async requireActiveTenant(tenantId: string): Promise<TenantWithPlan> {
    const tenant = await this.getTenant(tenantId);
    if (!tenant) {
      throw new TenantRequiredError('This workspace no longer exists.');
    }
    if (SUSPENDED_TENANT_STATUSES.has(tenant.status)) {
      throw new TenantSuspendedError();
    }
    return tenant;
  }

  buildSessionUser(
    record: UserWithRoles,
    roles: SessionRole[],
    permissions: string[],
  ): SessionUser {
    return {
      id: record.id,
      tenantId: record.tenantId,
      email: record.email,
      firstName: record.firstName,
      lastName: record.lastName,
      fullName: `${record.firstName} ${record.lastName}`.trim(),
      title: record.title,
      avatarUrl: record.avatarUrl,
      phone: record.phone,
      status: record.status,
      emailVerified: record.emailVerifiedAt !== null,
      isSuperAdmin: record.isSuperAdmin,
      timezone: record.timezone,
      locale: record.locale,
      roles,
      permissions,
      lastLoginAt: record.lastLoginAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
    };
  }

  buildSessionTenant(tenant: TenantWithPlan): SessionTenant {
    const settings = tenantSettingsSchema.parse(tenant.settings ?? {});

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      logoUrl: tenant.logoUrl,
      brandColor: tenant.brandColor,
      timezone: settings.timezone,
      currency: settings.currency,
      dateFormat: settings.dateFormat,
      status: tenant.status,
      trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
      planCode: tenant.subscription?.plan.code ?? null,
      planName: tenant.subscription?.plan.name ?? null,
    };
  }

  /** Tenants a super admin may switch into. Empty for everyone else. */
  async listAvailableTenants(isSuperAdmin: boolean): Promise<SessionTenant[]> {
    if (!isSuperAdmin) return [];

    const tenants = await this.prisma.client.tenant.findMany({
      where: { deletedAt: null, isPlatform: false },
      include: { subscription: { include: { plan: true } } },
      orderBy: { name: 'asc' },
      take: 200,
    });

    return tenants.map((tenant) => this.buildSessionTenant(tenant));
  }

  /** Loads the tenant a user belongs to, with roles, for login and refresh. */
  async loadUserWithRoles(userId: string): Promise<UserWithRoles | null> {
    return this.prisma.client.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { userRoles: { include: { role: true } } },
    });
  }

  rolesOf(record: UserWithRoles): SessionRole[] {
    return toSessionRoles(record);
  }
}

function toSessionRoles(record: UserWithRoles): SessionRole[] {
  return record.userRoles
    .filter((userRole) => userRole.role.deletedAt === null)
    .map((userRole) => ({
      id: userRole.role.id,
      // Custom (tenant-created) roles have no template key; they present as the
      // base recruiter role for display purposes only — permissions are what
      // actually gate behaviour.
      key: (userRole.role.key ?? 'RECRUITER') as RoleKey,
      name: userRole.role.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
