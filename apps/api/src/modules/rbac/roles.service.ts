import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  ROLE_PERMISSION_TEMPLATES,
  buildPaginationMeta,
  toSkipTake,
  type CreateRoleRequest,
  type EffectivePermissions,
  type Paginated,
  type PermissionGroup,
  type RoleDetail,
  type RoleListItem,
  type RoleQuery,
  type UpdateRoleRequest,
} from '@talentflow/types';

import { requestContext } from '@/common/request-context';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/common/errors/domain-errors';
import { PrismaService } from '@/infra/prisma/prisma.service';

import { RbacService } from './rbac.service';

const SORTABLE_FIELDS = new Set(['name', 'createdAt', 'updatedAt', 'priority']);

type RoleWithCounts = Prisma.RoleGetPayload<{
  include: {
    _count: { select: { userRoles: true; rolePermissions: true } };
    rolePermissions: { select: { permission: { select: { key: true } } } };
  };
}>;

/**
 * Role and permission administration.
 *
 * Every workspace gets its system roles provisioned at signup; this service is
 * what lets a tenant admin create custom roles on top of them. Platform
 * permissions (`platform:*`) are never assignable from inside a workspace —
 * they are refused rather than silently dropped.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  async list(query: RoleQuery): Promise<Paginated<RoleListItem>> {
    const where: Prisma.RoleWhereInput = {
      deletedAt: null,
      ...(query.includeSystem ? {} : { isSystem: false }),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const sortBy = query.sortBy && SORTABLE_FIELDS.has(query.sortBy) ? query.sortBy : 'priority';
    const orderBy: Prisma.RoleOrderByWithRelationInput[] = [
      { [sortBy]: query.sortDir } as Prisma.RoleOrderByWithRelationInput,
      { name: 'asc' },
    ];

    const [rows, total] = await Promise.all([
      this.prisma.client.role.findMany({
        where,
        include: {
          _count: { select: { userRoles: true, rolePermissions: true } },
          rolePermissions: { select: { permission: { select: { key: true } } } },
        },
        orderBy,
        ...toSkipTake(query),
      }),
      this.prisma.client.role.count({ where }),
    ]);

    return {
      items: rows.map(toListItem),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async detail(roleId: string): Promise<RoleDetail> {
    const role = await this.prisma.client.role.findFirst({
      where: { id: roleId, deletedAt: null },
      include: {
        _count: { select: { userRoles: true, rolePermissions: true } },
        rolePermissions: { select: { permission: { select: { key: true } } } },
        userRoles: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true },
            },
          },
        },
      },
    });

    if (!role) throw new NotFoundError('Role', roleId);

    const granted = new Set(role.rolePermissions.map((row) => row.permission.key));
    const catalogue = await this.rbac.getCatalogue();

    return {
      ...toListItem(role),
      permissionMatrix: catalogue.map((group) => ({
        group: group.group,
        permissions: group.permissions.map((permission) => ({
          key: permission.key,
          group: permission.group,
          label: permission.label,
          description: permission.description,
          enabled: granted.has(permission.key),
        })),
      })),
      users: role.userRoles
        .filter((userRole) => userRole.user)
        .map((userRole) => ({
          id: userRole.user.id,
          fullName: `${userRole.user.firstName} ${userRole.user.lastName}`.trim(),
          email: userRole.user.email,
          avatarUrl: userRole.user.avatarUrl,
        })),
    };
  }

  async create(input: CreateRoleRequest): Promise<RoleDetail> {
    const tenantId = requireTenant();
    const permissionKeys = this.resolvePermissionKeys(input.permissions, input.basedOn);

    const duplicate = await this.prisma.client.role.findFirst({
      where: { name: input.name, deletedAt: null },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictError(`A role called “${input.name}” already exists.`);
    }

    const role = await this.prisma.client.role.create({
      data: {
        tenantId,
        name: input.name,
        description: input.description ?? null,
        isSystem: false,
        priority: 50,
      },
    });

    await this.replacePermissions(role.id, permissionKeys);
    await this.rbac.invalidateRole(role.id, tenantId);

    return this.detail(role.id);
  }

  async update(roleId: string, input: UpdateRoleRequest): Promise<RoleDetail> {
    const tenantId = requireTenant();
    const role = await this.prisma.client.role.findFirst({
      where: { id: roleId, deletedAt: null },
      select: { id: true, key: true, isSystem: true, name: true },
    });
    if (!role) throw new NotFoundError('Role', roleId);

    // System roles keep their identity so the built-in permission templates
    // stay meaningful; their permission sets are still editable, except for
    // the tenant admin role, which must retain full control of the workspace.
    const isAdminRole = role.key === 'TENANT_ADMIN';

    if (input.name && input.name !== role.name) {
      if (role.isSystem) {
        throw new ForbiddenError('Built-in roles cannot be renamed.');
      }
      const duplicate = await this.prisma.client.role.findFirst({
        where: { name: input.name, deletedAt: null, NOT: { id: roleId } },
        select: { id: true },
      });
      if (duplicate) throw new ConflictError(`A role called “${input.name}” already exists.`);
    }

    if (isAdminRole && input.permissions) {
      throw new ForbiddenError('The Tenant Admin role always holds every workspace permission.');
    }

    await this.prisma.client.role.update({
      where: { id: roleId },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
    });

    if (input.permissions) {
      await this.replacePermissions(roleId, this.resolvePermissionKeys(input.permissions));
      await this.rbac.invalidateRole(roleId, tenantId);
    }

    return this.detail(roleId);
  }

  async remove(roleId: string): Promise<{ deleted: true }> {
    const tenantId = requireTenant();
    const role = await this.prisma.client.role.findFirst({
      where: { id: roleId, deletedAt: null },
      include: { _count: { select: { userRoles: true } } },
    });
    if (!role) throw new NotFoundError('Role', roleId);

    if (role.isSystem) {
      throw new ForbiddenError('Built-in roles cannot be deleted.');
    }
    if (role._count.userRoles > 0) {
      throw new ConflictError(
        'Reassign the users who hold this role before deleting it.',
      );
    }

    await this.prisma.client.role.update({
      where: { id: roleId },
      data: { deletedAt: new Date() },
    });
    await this.rbac.invalidateRole(roleId, tenantId);

    return { deleted: true };
  }

  async catalogue(): Promise<PermissionGroup[]> {
    return this.rbac.getCatalogue();
  }

  /** Effective permissions for the roles & permissions viewer on a user page. */
  async effectivePermissions(
    userId: string,
    isSuperAdmin: boolean,
  ): Promise<EffectivePermissions> {
    const tenantId = requireTenant();

    const [user, permissions] = await Promise.all([
      this.prisma.client.user.findFirst({
        where: { id: userId, deletedAt: null },
        include: { userRoles: { include: { role: true } } },
      }),
      this.rbac.resolvePermissionKeys(userId, tenantId, isSuperAdmin),
    ]);

    if (!user) throw new NotFoundError('User', userId);

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
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Normalises an incoming permission set: platform keys are refused, unknown
   * keys are refused, and `basedOn` supplies the template when the caller did
   * not send an explicit list.
   */
  private resolvePermissionKeys(
    permissions: string[] | undefined,
    basedOn?: CreateRoleRequest['basedOn'],
  ): string[] {
    if (!permissions || permissions.length === 0) {
      return basedOn ? [...ROLE_PERMISSION_TEMPLATES[basedOn]] : [];
    }

    const platformKeys = permissions.filter((key) => key.startsWith('platform:'));
    if (platformKeys.length > 0) {
      throw new ValidationError(
        'Platform permissions cannot be granted from inside a workspace.',
        { keys: platformKeys },
      );
    }

    return [...new Set(permissions)];
  }

  private async replacePermissions(roleId: string, permissionKeys: string[]): Promise<void> {
    const tenantId = requireTenant();

    const known = await this.prisma.client.permission.findMany({
      where: { key: { in: permissionKeys } },
      select: { id: true, key: true },
    });

    const unknown = permissionKeys.filter((key) => !known.some((row) => row.key === key));
    if (unknown.length > 0) {
      throw new ValidationError('Some permissions do not exist.', { keys: unknown });
    }

    await this.prisma.client.$transaction([
      this.prisma.client.rolePermission.deleteMany({ where: { roleId } }),
      this.prisma.client.rolePermission.createMany({
        data: known.map((permission) => ({
          tenantId,
          roleId,
          permissionId: permission.id,
        })),
        skipDuplicates: true,
      }),
    ]);
  }
}

function toListItem(role: RoleWithCounts): RoleListItem {
  const permissions = role.rolePermissions.map((row) => row.permission.key).sort();

  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    priority: role.priority,
    permissions,
    permissionCount: role._count.rolePermissions,
    userCount: role._count.userRoles,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

function requireTenant(): string {
  const tenantId = requestContext.tenantId;
  if (!tenantId) throw new ForbiddenError('This action must run inside a workspace.');
  return tenantId;
}
