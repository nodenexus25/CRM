import { Controller, Delete, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  idSchema,
  placementQuerySchema,
  updatePlacementSchema,
  type Paginated,
  type PlacementListItem,
  type PlacementQuery,
  type PlacementStats,
  type UpdatePlacementRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import { RequireAnyPermission, RequirePermissions } from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { PlacementsService } from './placements.service';

const idParamSchema = z.object({ id: idSchema });

/**
 * Placements. Reads accept either `_all` or `_own` and are narrowed further
 * inside the service; the margin fields are stripped from every response unless
 * the caller holds `placement:view_margin`.
 */
@ApiTags('placements')
@Controller('placements')
export class PlacementsController {
  constructor(private readonly placements: PlacementsService) {}

  @Get()
  @RequireAnyPermission('placement:read_all', 'placement:read_own')
  @ApiOperation({ summary: 'List placements with status, client, recruiter and date filters' })
  list(@ZodQuery(placementQuerySchema) query: PlacementQuery): Promise<Paginated<PlacementListItem>> {
    return this.placements.list(query);
  }

  // Declared before `:id` so the literal path wins the route match.
  @Get('stats')
  @RequireAnyPermission('placement:read_all', 'placement:read_own')
  @ApiOperation({ summary: 'Placement counts, and margin totals when the caller may see them' })
  stats(@ZodQuery(placementQuerySchema) query: PlacementQuery): Promise<PlacementStats> {
    return this.placements.stats(query);
  }

  @Patch(':id')
  @RequirePermissions('placement:update')
  @Audit({ action: 'UPDATE', entity: 'Placement', description: 'Updated a placement' })
  @ApiOperation({ summary: 'Edit a placement’s terms or lifecycle and recompute its margin' })
  update(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updatePlacementSchema) body: UpdatePlacementRequest,
  ): Promise<PlacementListItem> {
    return this.placements.update(params.id, body);
  }

  @Delete(':id')
  @RequirePermissions('placement:delete')
  @Audit({ action: 'DELETE', entity: 'Placement', description: 'Deleted a placement' })
  @ApiOperation({ summary: 'Soft-delete a placement' })
  remove(@ZodParam(idParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.placements.remove(params.id);
  }
}
