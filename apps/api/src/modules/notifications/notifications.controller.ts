import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  markNotificationsSchema,
  notificationQuerySchema,
  type MarkNotificationsRequest,
  type NotificationItem,
  type NotificationQuery,
  type NotificationSummary,
  type Paginated,
} from '@talentflow/types';

import { ZodBody, ZodQuery } from '@/common/decorators/zod.decorator';

import { NotificationsService } from './notifications.service';

/**
 * Personal notification feed. No `@RequirePermissions` here: every user may
 * read and clear their own notifications, and the service scopes by `userId`.
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List the signed-in user’s notifications' })
  list(@ZodQuery(notificationQuerySchema) query: NotificationQuery): Promise<Paginated<NotificationItem>> {
    return this.notifications.list(query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Unread count plus the most recent notifications' })
  summary(): Promise<NotificationSummary> {
    return this.notifications.summary();
  }

  @Post('read')
  @ApiOperation({ summary: 'Mark specific notifications read or unread' })
  mark(@ZodBody(markNotificationsSchema) body: MarkNotificationsRequest): Promise<{ updated: number }> {
    return this.notifications.mark(body);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark every notification as read' })
  markAllRead(): Promise<{ updated: number }> {
    return this.notifications.markAllRead();
  }
}
