import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildPaginationMeta,
  toSkipTake,
  type MarkNotificationsRequest,
  type NotificationItem,
  type NotificationQuery,
  type NotificationSummary,
  type Paginated,
} from '@talentflow/types';

import { ForbiddenError } from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import { PrismaService } from '@/infra/prisma/prisma.service';

const SUMMARY_LIMIT = 8;

type NotificationRow = Prisma.NotificationGetPayload<Record<string, never>>;

/**
 * The in-app notification feed behind the header bell.
 *
 * Every row is owned by a single user, so the queries here are filtered by
 * `userId` as well as the tenant that `prisma.client` already applies.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: NotificationQuery): Promise<Paginated<NotificationItem>> {
    const userId = requireUser();

    const where: Prisma.NotificationWhereInput = {
      userId,
      channel: 'IN_APP',
      ...(query.unreadOnly ? { readAt: null } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        ...toSkipTake(query),
      }),
      this.prisma.client.notification.count({ where }),
    ]);

    return {
      items: await this.decorate(rows),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async summary(): Promise<NotificationSummary> {
    const userId = requireUser();

    const [unread, rows] = await Promise.all([
      this.prisma.client.notification.count({
        where: { userId, channel: 'IN_APP', readAt: null },
      }),
      this.prisma.client.notification.findMany({
        where: { userId, channel: 'IN_APP' },
        orderBy: [{ createdAt: 'desc' }],
        take: SUMMARY_LIMIT,
      }),
    ]);

    return { unread, items: await this.decorate(rows) };
  }

  async mark(input: MarkNotificationsRequest): Promise<{ updated: number }> {
    const userId = requireUser();

    const result = await this.prisma.client.notification.updateMany({
      where: { id: { in: input.ids }, userId },
      data: { readAt: input.read ? new Date() : null },
    });

    return { updated: result.count };
  }

  async markAllRead(): Promise<{ updated: number }> {
    const userId = requireUser();

    const result = await this.prisma.client.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    return { updated: result.count };
  }

  /**
   * `Notification` stores the actor as a plain id, so their name is resolved in
   * one extra query rather than a per-row lookup.
   */
  private async decorate(rows: NotificationRow[]): Promise<NotificationItem[]> {
    const actorIds = [...new Set(rows.map((row) => row.actorId).filter((id): id is string => !!id))];

    const actors =
      actorIds.length > 0
        ? await this.prisma.client.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, firstName: true, lastName: true, avatarUrl: true },
          })
        : [];

    const byId = new Map(actors.map((actor) => [actor.id, actor]));

    return rows.map((row) => {
      const actor = row.actorId ? byId.get(row.actorId) : undefined;
      return {
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        link: row.link,
        read: row.readAt !== null,
        actor: actor
          ? {
              id: actor.id,
              fullName: `${actor.firstName} ${actor.lastName}`.trim(),
              avatarUrl: actor.avatarUrl,
            }
          : null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}

function requireUser(): string {
  const userId = requestContext.userId;
  if (!userId) throw new ForbiddenError('Notifications require an authenticated user.');
  return userId;
}
