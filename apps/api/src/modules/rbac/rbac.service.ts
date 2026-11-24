import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';

import { ALL_PERMISSION_KEYS, PERMISSIONS, type PermissionKey } from '@talentflow/types';

import { PrismaService } from '@/infra/prisma/prisma.service';
import { RedisService } from '@/infra/redis/redis.service';

/** Permission sets are cached per user for this long before a database re-read. */
const PERMISSION_CACHE_TTL_SECONDS = 60;

@Injectable()
export class RbacService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RbacService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Seeds the global permission catalogue from `packages/types`, which is the
   * single source of truth shared with the web app. Runs on every boot so a
   * newly added permission key is available without a manual migration.
   */
  async onApplicationBootstrap(): Promise<void> {
    const created = await this.syncPermissionCatalogue();
    if (created > 0) {
      this.logger.log(`Permission catalogue synced (${created} new key(s))`);
    }
  }

  async syncPermissionCatalogue(): Promise<number> {
    const existing = await this.prisma.client.permission.findMany({ select: { key: true } });
    const known = new Set(existing.map((row) => row.key));
    const missing = PERMISSIONS.filter((permission) => !known.has(permission.key));

    if (missing.length === 0) return 0;

    await this.prisma.client.permission.createMany({
      data: missing.map((permission) => ({
        key: permission.key,
        group: permission.group,
        label: permission.label,
        description: permission.description,
        isPlatform: permission.key.startsWith('platform:'),
      })),
      skipDuplicates: true,
    });

    return missing.length;
  }

  /**
   * Effective permissions for a user: the union of the ALLOW permissions across
   * their active roles. Super admins hold every key in the catalogue.
   */
  async resolvePermissionKeys(
    userId: string,
    tenantId: string,
    isSuperAdmin: boolean,
  ): Promise<string[]> {
    if (isSuperAdmin) return [...ALL_PERMISSION_KEYS];

    const cacheKey = this.cacheKey(tenantId, userId);
    const cached = await this.redis.client.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as string[];
      } catch {
        await this.redis.client.del(cacheKey);
      }
    }

    const rows = await this.prisma.client.rolePermission.findMany({
      where: {
        effect: 'ALLOW',
        role: {
          deletedAt: null,
          userRoles: { some: { userId } },
        },
      },
      select: { permission: { select: { key: true } } },
    });

    const keys = [...new Set(rows.map((row) => row.permission.key))].sort();
    await this.redis.client.set(cacheKey, JSON.stringify(keys), 'EX', PERMISSION_CACHE_TTL_SECONDS);
    return keys;
  }

  /** Call after a user's roles change, or after their role's permissions change. */
  async invalidateUser(userId: string, tenantId: string): Promise<void> {
    await this.redis.client.del(this.cacheKey(tenantId, userId));
  }

  /** Call after a role's permission set changes — clears every affected user. */
  async invalidateRole(roleId: string, tenantId: string): Promise<void> {
    const holders = await this.prisma.client.userRole.findMany({
      where: { roleId },
      select: { userId: true },
    });

    const keys = holders.map((holder) => this.cacheKey(tenantId, holder.userId));
    if (keys.length > 0) {
      await this.redis.client.del(...keys);
    }
  }

  /** Full catalogue, grouped for the roles & permissions editor. */
  async getCatalogue() {
    const permissions = await this.prisma.client.permission.findMany({
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
    });

    const groups = new Map<string, typeof permissions>();
    for (const permission of permissions) {
      const bucket = groups.get(permission.group) ?? [];
      bucket.push(permission);
      groups.set(permission.group, bucket);
    }

    return [...groups.entries()].map(([group, items]) => ({
      group,
      permissions: items.map((item) => ({
        key: item.key as PermissionKey,
        label: item.label,
        description: item.description,
        group: item.group,
        isPlatform: item.isPlatform,
      })),
    }));
  }

  private cacheKey(tenantId: string, userId: string): string {
    return `perm:${tenantId}:${userId}`;
  }
}
