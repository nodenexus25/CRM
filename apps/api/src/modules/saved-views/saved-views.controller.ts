import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createSavedViewSchema,
  idSchema,
  savedViewQuerySchema,
  updateSavedViewSchema,
  type CreateSavedViewRequest,
  type SavedViewItem,
  type SavedViewQuery,
  type UpdateSavedViewRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import { RequirePermissions } from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { SavedViewsService } from './saved-views.service';

const idParamSchema = z.object({ id: idSchema });

/**
 * Saved list views. Reading is gated by `tenant:read` because every workspace
 * member may see their own views and those shared with the workspace;
 * create/update/delete are gated by `saved_search:manage`, and the service
 * additionally restricts edits to the view's owner.
 */
@ApiTags('saved-views')
@Controller('saved-views')
export class SavedViewsController {
  constructor(private readonly savedViews: SavedViewsService) {}

  @Get()
  @RequirePermissions('tenant:read')
  @ApiOperation({ summary: 'List the caller’s saved views and those shared with the workspace' })
  list(@ZodQuery(savedViewQuerySchema) query: SavedViewQuery): Promise<SavedViewItem[]> {
    return this.savedViews.list(query);
  }

  @Post()
  @RequirePermissions('saved_search:manage')
  @Audit({ action: 'CREATE', entity: 'SavedView' })
  @ApiOperation({ summary: 'Save the current list configuration as a view' })
  create(@ZodBody(createSavedViewSchema) body: CreateSavedViewRequest): Promise<SavedViewItem> {
    return this.savedViews.create(body);
  }

  @Patch(':id')
  @RequirePermissions('saved_search:manage')
  @Audit({ action: 'UPDATE', entity: 'SavedView' })
  @ApiOperation({ summary: 'Edit an owned saved view' })
  update(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updateSavedViewSchema) body: UpdateSavedViewRequest,
  ): Promise<SavedViewItem> {
    return this.savedViews.update(params.id, body);
  }

  @Delete(':id')
  @RequirePermissions('saved_search:manage')
  @Audit({ action: 'DELETE', entity: 'SavedView' })
  @ApiOperation({ summary: 'Delete an owned saved view' })
  remove(@ZodParam(idParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.savedViews.remove(params.id);
  }
}
