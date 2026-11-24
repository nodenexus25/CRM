import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  activityQuerySchema,
  createActivitySchema,
  idSchema,
  updateActivitySchema,
  type ActivityItem,
  type ActivityQuery,
  type CreateActivityRequest,
  type Paginated,
  type UpdateActivityRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import { RequirePermissions } from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { ActivitiesService } from './activities.service';

const idParamSchema = z.object({ id: idSchema });

/**
 * The engagement timeline. Reads and writes are gated by `activity:*`; the
 * service scopes every query to the tenant that `prisma.client` already applies.
 */
@ApiTags('activities')
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  @RequirePermissions('activity:read')
  @ApiOperation({ summary: 'List an entity’s activities, newest first' })
  list(@ZodQuery(activityQuerySchema) query: ActivityQuery): Promise<Paginated<ActivityItem>> {
    return this.activities.list(query);
  }

  @Post()
  @RequirePermissions('activity:create')
  @Audit({ action: 'CREATE', entity: 'Activity' })
  @ApiOperation({ summary: 'Log a call, email, meeting or note' })
  create(@ZodBody(createActivitySchema) body: CreateActivityRequest): Promise<ActivityItem> {
    return this.activities.create(body);
  }

  @Patch(':id')
  @RequirePermissions('activity:update')
  @Audit({ action: 'UPDATE', entity: 'Activity' })
  @ApiOperation({ summary: 'Correct a logged activity' })
  update(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updateActivitySchema) body: UpdateActivityRequest,
  ): Promise<ActivityItem> {
    return this.activities.update(params.id, body);
  }

  @Delete(':id')
  @RequirePermissions('activity:delete')
  @Audit({ action: 'DELETE', entity: 'Activity' })
  @ApiOperation({ summary: 'Soft-delete a logged activity' })
  remove(@ZodParam(idParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.activities.remove(params.id);
  }
}
