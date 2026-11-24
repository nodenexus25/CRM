import { Controller, Delete, Get, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createPipelineStageSchema,
  createRejectionReasonSchema,
  deletePipelineStageQuerySchema,
  idSchema,
  rejectionReasonQuerySchema,
  reorderPipelineStagesSchema,
  updatePipelineStageSchema,
  updateRejectionReasonSchema,
  type CreatePipelineStageRequest,
  type CreateRejectionReasonRequest,
  type DeletePipelineStageQuery,
  type PipelineStageItem,
  type RejectionReasonItem,
  type RejectionReasonQuery,
  type ReorderPipelineStagesRequest,
  type UpdatePipelineStageRequest,
  type UpdateRejectionReasonRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import { RequirePermissions } from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { PipelineService } from './pipeline.service';

const idParamSchema = z.object({ id: idSchema });

@ApiTags('pipeline')
@Controller('pipeline')
export class PipelineController {
  constructor(private readonly pipeline: PipelineService) {}

  // --- Stages --------------------------------------------------------------

  @Get('stages')
  @RequirePermissions('pipeline:read')
  @ApiOperation({ summary: 'List the workspace pipeline stages in order' })
  listStages(): Promise<PipelineStageItem[]> {
    return this.pipeline.listStages();
  }

  @Post('stages')
  @RequirePermissions('pipeline:manage')
  @Audit({ action: 'CREATE', entity: 'JobPipelineStage' })
  @ApiOperation({ summary: 'Add a stage to the workspace pipeline' })
  createStage(@ZodBody(createPipelineStageSchema) body: CreatePipelineStageRequest): Promise<PipelineStageItem> {
    return this.pipeline.createStage(body);
  }

  @Put('stages/reorder')
  @RequirePermissions('pipeline:manage')
  @Audit({ action: 'UPDATE', entity: 'JobPipelineStage', description: 'Reordered pipeline stages' })
  @ApiOperation({ summary: 'Reorder every stage in one transaction' })
  reorderStages(
    @ZodBody(reorderPipelineStagesSchema) body: ReorderPipelineStagesRequest,
  ): Promise<PipelineStageItem[]> {
    return this.pipeline.reorderStages(body);
  }

  @Patch('stages/:id')
  @RequirePermissions('pipeline:manage')
  @Audit({ action: 'UPDATE', entity: 'JobPipelineStage' })
  @ApiOperation({ summary: 'Rename or restyle a stage' })
  updateStage(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updatePipelineStageSchema) body: UpdatePipelineStageRequest,
  ): Promise<PipelineStageItem> {
    return this.pipeline.updateStage(params.id, body);
  }

  @Delete('stages/:id')
  @RequirePermissions('pipeline:manage')
  @Audit({ action: 'DELETE', entity: 'JobPipelineStage' })
  @ApiOperation({ summary: 'Delete a stage, moving its applications to another stage' })
  removeStage(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodQuery(deletePipelineStageQuerySchema) query: DeletePipelineStageQuery,
  ): Promise<{ deleted: true; movedApplications: number }> {
    return this.pipeline.deleteStage(params.id, query.moveToStageId);
  }

  // --- Rejection reasons ---------------------------------------------------

  @Get('rejection-reasons')
  @RequirePermissions('pipeline:read')
  @ApiOperation({ summary: 'List the workspace rejection reasons' })
  listRejectionReasons(
    @ZodQuery(rejectionReasonQuerySchema) query: RejectionReasonQuery,
  ): Promise<RejectionReasonItem[]> {
    return this.pipeline.listRejectionReasons(query);
  }

  @Post('rejection-reasons')
  @RequirePermissions('pipeline:manage')
  @Audit({ action: 'CREATE', entity: 'RejectionReason' })
  @ApiOperation({ summary: 'Add a rejection reason' })
  createRejectionReason(
    @ZodBody(createRejectionReasonSchema) body: CreateRejectionReasonRequest,
  ): Promise<RejectionReasonItem> {
    return this.pipeline.createRejectionReason(body);
  }

  @Patch('rejection-reasons/:id')
  @RequirePermissions('pipeline:manage')
  @Audit({ action: 'UPDATE', entity: 'RejectionReason' })
  @ApiOperation({ summary: 'Rename, reorder or toggle a rejection reason' })
  updateRejectionReason(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updateRejectionReasonSchema) body: UpdateRejectionReasonRequest,
  ): Promise<RejectionReasonItem> {
    return this.pipeline.updateRejectionReason(params.id, body);
  }

  @Delete('rejection-reasons/:id')
  @RequirePermissions('pipeline:manage')
  @Audit({ action: 'DELETE', entity: 'RejectionReason' })
  @ApiOperation({ summary: 'Delete a custom rejection reason' })
  removeRejectionReason(@ZodParam(idParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.pipeline.deleteRejectionReason(params.id);
  }
}
