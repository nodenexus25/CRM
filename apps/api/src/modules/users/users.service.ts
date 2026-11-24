import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

import {
  buildPaginationMeta,
  toSkipTake,
  type AdminResetPasswordRequest,
  type AssignRolesRequest,
  type AssignTeamsRequest,
  type EffectivePermissions,
  type InviteUserRequest,
  type Paginated,
  type UpdateProfileRequest,
  type UpdateUserRequest,
  type UserDetail,
  type UserListItem,
  type UserQuery,
} from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import type { AppConfig } from '@/config/configuration';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { EmailQueueService } from '@/infra/queue/email-queue.service';
import { PasswordService } from '@/modules/auth/password.service';
import { generateOpaqueToken, hashOpaqueToken } from '@/modules/auth/token-hash.util';
import { RbacService } from '@/modules/rbac/rbac.service';

const INVITE_TTL_DAYS = 7;
const SORTABLE_FIELDS = new Set([
  'createdAt',
  'firstName',
  'lastName',
  'email',
  'lastLoginAt',
  'status',
]);

type UserWithRelations = Prisma.UserGetPayload<{
  include: {
    userRoles: {
      include: { role: { select: { id: true; key: true; name: true; deletedAt: true } } };
    };
    teamMemberships: { include: { team: { select: { id: true; name: true } } } };
    _count: { select: { jobAssignments: true; assignedTasks: true } };
  };
}>;

const LIST_INCLUDE = {
  userRoles: {
    include: { role: { select: { id: true, key: true, name: true, deletedAt: true } } },
  },
  teamMemberships: { include: { team: { select: { id: true, name: true } } } },
  _count: {
    select: {
      // "Open work" is what the team page shows: live job assignments and
      // unfinished tasks. Counting every historical row would be misleading.
      jobAssignments: { where: { job: { deletedAt: null, status: 'OPEN' } } },
      assignedTasks: {
        where: { deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      },
    },
  },
} satisfies Prisma.UserInclude;

/**
 * Workspace user administration.
 *
 * Inviting creates a real `User` row in the `INVITED` state — it has roles,
 * teams and team membership from the moment it exists, so the list is accurate
 * before the person ever signs in. The password is only ever set by the invitee
 * through the emailed link, which is why no password is accepted here.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly passwords: PasswordService,
    private readonly mail: EmailQueueService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(query: UserQuery): Promise<Paginated<UserListItem>> {
    const where: Prisma.UserWhereInput = {
      ...(query.includeDeleted ? {} : { deletedAt: null }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.teamId ? { teamMemberships: { some: { teamId: query.teamId } } } : {}),
      ...(query.roleKey
        ? { userRoles: { some: { role: { key: query.roleKey, deletedAt: null } } } }
        : {}),
      ...(query.q
        ? {
            OR: [
              { firstName: { contains: query.q, mode: 'insensitive' } },
              { lastName: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
              { title: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const sortBy = query.sortBy && SORTABLE_FIELDS.has(query.sortBy) ? query.sortBy : 'createdAt';
    const orderBy: Prisma.UserOrderByWithRelationInput[] = [
      { [sortBy]: query.sortDir } as Prisma.UserOrderByWithRelationInput,
      { createdAt: 'desc' },
    ];

    const [rows, total] = await Promise.all([
      this.prisma.client.user.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy,
        ...toSkipTake(query),
      }),
      this.prisma.client.user.count({ where }),
    ]);

    return {
      items: rows.map(toUserListItem),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async detail(userId: string, isSuperAdmin: boolean): Promise<UserDetail> {
    const user = await this.findOrFail(userId);
    const [permissions, sessions, recentActivity] = await Promise.all([
      this.rbac.resolvePermissionKeys(userId, user.tenantId, isSuperAdmin),
      this.prisma.client.refreshToken.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: { id: true, userAgent: true, ip: true, createdAt: true, expiresAt: true },
      }),
      this.prisma.client.auditLog.findMany({
        where: { actorId: userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, action: true, entity: true, entityId: true, createdAt: true },
      }),
    ]);

    return {
      ...toUserListItem(user),
      permissions,
      activeSessions: sessions.map((session) => ({
        id: session.id,
        userAgent: session.userAgent,
        ip: session.ip,
        createdAt: session.createdAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
      })),
      recentActivity: recentActivity.map((entry) => ({
        id: entry.id,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }

  async effectivePermissions(userId: string, isSuperAdmin: boolean): Promise<EffectivePermissions> {
    const user = await this.findOrFail(userId);
    const permissions = await this.rbac.resolvePermissionKeys(
      userId,
      user.tenantId,
      isSuperAdmin,
    );

    return {
      userId,
      roles: user.userRoles
        .filter((userRole) => userRole.role.deletedAt === null)
        .map((userRole) => ({
          id: userRole.role.id,
          key: userRole.role.key,
          name: userRole.role.name,
        })),
      permissions,
    };
  }

  // ---------------------------------------------------------------------------
  // Invite
  // ---------------------------------------------------------------------------

  async invite(input: InviteUserRequest): Promise<UserDetail> {
    const tenantId = requireTenant();
    const actorId = requestContext.userId;

    const existing = await this.prisma.client.user.findFirst({
      where: { email: input.email },
      select: { id: true, deletedAt: true },
    });
    if (existing && existing.deletedAt === null) {
      throw new ConflictError(`${input.email} is already a member of this workspace.`);
    }

    const [roles, tenant] = await Promise.all([
      this.requireRoles(input.roleIds),
      this.prisma.client.tenant.findFirstOrThrow({
        where: { id: tenantId },
        select: { name: true },
      }),
    ]);

    const user = await this.prisma.client.user.create({
      data: {
        tenantId,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        title: input.title ?? null,
        phone: input.phone || null,
        status: 'INVITED',
      },
    });

    await this.prisma.client.userRole.createMany({
      data: roles.map((role) => ({ tenantId, userId: user.id, roleId: role.id, assignedById: actorId })),
      skipDuplicates: true,
    });

    if (input.teamIds.length > 0) {
      await this.requireTeams(input.teamIds);
      await this.prisma.client.teamMember.createMany({
        data: input.teamIds.map((teamId) => ({ tenantId, teamId, userId: user.id })),
        skipDuplicates: true,
      });
    }

    const inviteUrl = await this.issueInviteLink(user.id, user.email, tenantId);

    if (input.sendInvite) {
      await this.sendInviteEmail({
        to: user.email,
        firstName: user.firstName,
        tenantName: tenant.name,
        roleName: describeRoles(roles),
        inviteUrl,
        actorId,
      });
    }

    await this.audit.record({
      action: 'INVITE',
      entity: 'User',
      entityId: user.id,
      description: `Invited ${user.email} as ${describeRoles(roles)}`,
    });

    return this.detail(user.id, false);
  }

  async resendInvite(userId: string): Promise<{ sent: true }> {
    const tenantId = requireTenant();
    const user = await this.findOrFail(userId);

    if (user.status !== 'INVITED') {
      throw new ValidationError('That user has already accepted their invitation.');
    }

    const tenant = await this.prisma.client.tenant.findFirstOrThrow({
      where: { id: tenantId },
      select: { name: true },
    });

    const inviteUrl = await this.issueInviteLink(user.id, user.email, tenantId);

    await this.sendInviteEmail({
      to: user.email,
      firstName: user.firstName,
      tenantName: tenant.name,
      roleName: describeRoles(
        user.userRoles.map((userRole) => ({ name: userRole.role.name })),
      ),
      inviteUrl,
      actorId: requestContext.userId,
    });

    await this.audit.record({
      action: 'INVITE',
      entity: 'User',
      entityId: user.id,
      description: `Re-sent the invitation to ${user.email}`,
    });

    return { sent: true };
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  async update(userId: string, input: UpdateUserRequest): Promise<UserDetail> {
    const tenantId = requireTenant();
    const currentUserId = requestContext.userId;
    const target = await this.findOrFail(userId);

    if (input.roleIds && userId === currentUserId) {
      // Changing your own roles is the classic way to lock a workspace out.
      throw new ForbiddenError('You cannot change your own roles. Ask another administrator.');
    }

    if (target.isSuperAdmin && !requestContext.get()?.isSuperAdmin) {
      throw new ForbiddenError('Platform administrators can only be managed by other platform administrators.');
    }

    if (input.roleIds) await this.requireRoles(input.roleIds);
    if (input.teamIds) await this.requireTeams(input.teamIds);

    const data: Prisma.UserUpdateInput = {};
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.lastName !== undefined) data.lastName = input.lastName;
    if (input.title !== undefined) data.title = input.title;
    if (input.phone !== undefined) data.phone = input.phone || null;
    if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl;
    if (input.timezone !== undefined) data.timezone = input.timezone;
    if (input.locale !== undefined) data.locale = input.locale;
    if (input.status !== undefined) data.status = input.status;

    await this.prisma.client.user.update({ where: { id: userId }, data });

    if (input.roleIds) {
      await this.prisma.client.$transaction([
        this.prisma.client.userRole.deleteMany({ where: { userId } }),
        this.prisma.client.userRole.createMany({
          data: input.roleIds.map((roleId) => ({
            tenantId,
            userId,
            roleId,
            assignedById: currentUserId,
          })),
          skipDuplicates: true,
        }),
      ]);
      // The permission cache is keyed per user, so it must not survive a role change.
      await this.rbac.invalidateUser(userId, tenantId);
    }

    if (input.teamIds) {
      await this.prisma.client.$transaction([
        this.prisma.client.teamMember.deleteMany({ where: { userId } }),
        this.prisma.client.teamMember.createMany({
          data: input.teamIds.map((teamId) => ({ tenantId, teamId, userId })),
          skipDuplicates: true,
        }),
      ]);
    }

    // A suspended or disabled account must lose its live sessions immediately.
    if (input.status === 'SUSPENDED' || input.status === 'DISABLED') {
      await this.prisma.client.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    return this.detail(userId, false);
  }

  async updateOwnProfile(userId: string, input: UpdateProfileRequest): Promise<UserDetail> {
    const data: Prisma.UserUpdateInput = {};
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.lastName !== undefined) data.lastName = input.lastName;
    if (input.title !== undefined) data.title = input.title;
    if (input.phone !== undefined) data.phone = input.phone || null;
    if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl;
    if (input.timezone !== undefined) data.timezone = input.timezone;
    if (input.locale !== undefined) data.locale = input.locale;

    await this.prisma.client.user.update({ where: { id: userId }, data });

    return this.detail(userId, false);
  }

  async assignRoles(userId: string, input: AssignRolesRequest): Promise<UserDetail> {
    const tenantId = requireTenant();
    const currentUserId = requestContext.userId;

    if (userId === currentUserId) {
      throw new ForbiddenError('You cannot change your own roles. Ask another administrator.');
    }

    await this.findOrFail(userId);
    const roles = await this.requireRoles(input.roleIds);

    await this.prisma.client.$transaction([
      this.prisma.client.userRole.deleteMany({ where: { userId } }),
      this.prisma.client.userRole.createMany({
        data: roles.map((role) => ({
          tenantId,
          userId,
          roleId: role.id,
          assignedById: currentUserId,
        })),
        skipDuplicates: true,
      }),
    ]);

    await this.rbac.invalidateUser(userId, tenantId);
    await this.audit.record({
      action: 'PERMISSION_CHANGE',
      entity: 'User',
      entityId: userId,
      description: `Roles changed to ${describeRoles(roles)}`,
      changes: { roles: roles.map((role) => role.name) },
    });

    return this.detail(userId, false);
  }

  async assignTeams(userId: string, input: AssignTeamsRequest): Promise<UserDetail> {
    const tenantId = requireTenant();
    await this.findOrFail(userId);
    await this.requireTeams(input.teamIds);

    await this.prisma.client.$transaction([
      this.prisma.client.teamMember.deleteMany({ where: { userId } }),
      this.prisma.client.teamMember.createMany({
        data: input.teamIds.map((teamId) => ({ tenantId, teamId, userId })),
        skipDuplicates: true,
      }),
    ]);

    return this.detail(userId, false);
  }

  // ---------------------------------------------------------------------------
  // Password & lifecycle
  // ---------------------------------------------------------------------------

  async adminResetPassword(
    userId: string,
    input: AdminResetPasswordRequest,
  ): Promise<{ reset: true }> {
    const tenantId = requireTenant();
    const target = await this.findOrFail(userId);

    if (target.isSuperAdmin && !requestContext.get()?.isSuperAdmin) {
      throw new ForbiddenError('Platform administrators can only be managed by other platform administrators.');
    }

    const passwordHash = await this.passwords.hash(input.newPassword);

    await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword: input.requireChange,
        failedLoginAttempts: 0,
        lockedUntil: null,
        // An invitee who never set a password becomes a full member now.
        ...(target.status === 'INVITED' ? { status: 'ACTIVE' } : {}),
      },
    });

    await this.prisma.client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.audit.record({
      action: 'PASSWORD_RESET',
      entity: 'User',
      entityId: userId,
      description: `An administrator set a new password for ${target.email}`,
    });

    await this.mail.enqueue({
      to: target.email,
      subject: `Your ${this.appName} password was changed`,
      template: 'password-changed',
      context: { firstName: target.firstName },
      tenantId,
    });

    return { reset: true };
  }

  async remove(userId: string): Promise<{ deleted: true }> {
    const currentUserId = requestContext.userId;
    if (userId === currentUserId) {
      throw new ForbiddenError('You cannot remove your own account.');
    }

    const target = await this.findOrFail(userId);

    if (target.isSuperAdmin && !requestContext.get()?.isSuperAdmin) {
      throw new ForbiddenError('Platform administrators can only be managed by other platform administrators.');
    }

    await this.removeAdministratorsGuard(userId);

    await this.prisma.client.$transaction([
      this.prisma.client.user.update({
        where: { id: userId },
        data: { deletedAt: new Date(), status: 'DISABLED' },
      }),
      this.prisma.client.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      action: 'DELETE',
      entity: 'User',
      entityId: userId,
      description: `Removed ${target.email} from the workspace`,
    });

    return { deleted: true };
  }

  async restore(userId: string): Promise<UserDetail> {
    const target = await this.prisma.client.user.findFirst({ where: { id: userId } });
    if (!target) throw new NotFoundError('User', userId);
    if (target.deletedAt === null) {
      throw new ValidationError('That user is already active.');
    }

    await this.prisma.client.user.update({
      where: { id: userId },
      data: { deletedAt: null, status: 'ACTIVE' },
    });

    await this.audit.record({
      action: 'RESTORE',
      entity: 'User',
      entityId: userId,
      description: `Restored ${target.email}`,
    });

    return this.detail(userId, false);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async findOrFail(userId: string): Promise<UserWithRelations> {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: LIST_INCLUDE,
    });
    if (!user) throw new NotFoundError('User', userId);
    return user;
  }

  /** Creates a single-use invite token and returns the link to put in the email. */
  private async issueInviteLink(userId: string, email: string, tenantId: string): Promise<string> {
    const token = generateOpaqueToken();

    // A fresh invite invalidates any earlier one, so only the newest link works.
    await this.prisma.client.$transaction([
      this.prisma.client.authToken.updateMany({
        where: { userId, type: 'INVITE', usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.client.authToken.create({
        data: {
          tenantId,
          userId,
          email,
          type: 'INVITE',
          tokenHash: hashOpaqueToken(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
        },
      }),
    ]);

    return `${this.appUrl}/accept-invite?token=${token}`;
  }

  private async sendInviteEmail(input: {
    to: string;
    firstName: string;
    tenantName: string;
    roleName: string;
    inviteUrl: string;
    actorId?: string;
  }): Promise<void> {
    const inviter = input.actorId
      ? await this.prisma.client.user.findFirst({
          where: { id: input.actorId },
          select: { firstName: true, lastName: true },
        })
      : null;

    const inviterName = inviter
      ? `${inviter.firstName} ${inviter.lastName}`.trim()
      : this.appName;

    await this.mail.enqueue({
      to: input.to,
      subject: `${inviterName} invited you to ${input.tenantName} on ${this.appName}`,
      template: 'invite',
      context: {
        firstName: input.firstName,
        tenantName: input.tenantName,
        inviterName,
        roleName: input.roleName,
        inviteUrl: input.inviteUrl,
        expiresInDays: INVITE_TTL_DAYS,
      },
      requestedBy: input.actorId,
    });
  }

  private async requireRoles(roleIds: string[]): Promise<{ id: string; name: string }[]> {
    const unique = [...new Set(roleIds)];
    const roles = await this.prisma.client.role.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true, name: true },
    });

    const missing = unique.filter((roleId) => !roles.some((role) => role.id === roleId));
    if (missing.length > 0) {
      throw new ValidationError('Some of those roles do not exist.', { roleIds: missing });
    }

    return roles;
  }

  private async requireTeams(teamIds: string[]): Promise<void> {
    const unique = [...new Set(teamIds)];
    if (unique.length === 0) return;

    const found = await this.prisma.client.team.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true },
    });

    const missing = unique.filter((teamId) => !found.some((team) => team.id === teamId));
    if (missing.length > 0) {
      throw new ValidationError('Some of those teams do not exist.', { teamIds: missing });
    }
  }

  /** Refuses to remove the last administrator of a workspace. */
  private async removeAdministratorsGuard(userId: string): Promise<void> {
    const adminRole = await this.prisma.client.role.findFirst({
      where: { key: 'TENANT_ADMIN', deletedAt: null },
      select: { id: true },
    });
    if (!adminRole) return;

    const remaining = await this.prisma.client.userRole.count({
      where: {
        roleId: adminRole.id,
        userId: { not: userId },
        user: { deletedAt: null, status: { not: 'DISABLED' } },
      },
    });

    if (remaining === 0) {
      throw new ConflictError(
        'This is the workspace’s only administrator. Promote someone else first.',
      );
    }
  }

  private get appName(): string {
    return this.config.get('appName', { infer: true });
  }

  private get appUrl(): string {
    return this.config.get('appUrl', { infer: true }).replace(/\/$/, '');
  }
}

// -----------------------------------------------------------------------------
// Presentation
// -----------------------------------------------------------------------------

function toUserListItem(user: UserWithRelations): UserListItem {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    title: user.title,
    avatarUrl: user.avatarUrl,
    phone: user.phone,
    status: user.status,
    emailVerified: user.emailVerifiedAt !== null,
    timezone: user.timezone,
    locale: user.locale,
    roles: user.userRoles
      .filter((userRole) => userRole.role.deletedAt === null)
      .map((userRole) => ({
        id: userRole.role.id,
        // Custom roles have no template key; they present as `RECRUITER` for
        // display only — permissions are what actually gate behaviour.
        key: userRole.role.key ?? 'RECRUITER',
        name: userRole.role.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    teams: user.teamMemberships
      .map((membership) => ({ id: membership.team.id, name: membership.team.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    openJobs: user._count.jobAssignments,
    openTasks: user._count.assignedTasks,
  };
}

function describeRoles(roles: { name: string }[]): string {
  if (roles.length === 0) return 'no role';
  if (roles.length === 1) return roles[0]!.name;
  return `${roles.length} roles`;
}

function requireTenant(): string {
  const tenantId = requestContext.tenantId;
  if (!tenantId) throw new ForbiddenError('This action must run inside a workspace.');
  return tenantId;
}
