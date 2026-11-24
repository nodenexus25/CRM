import { Controller, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  idSchema,
  updateJobStagesSchema,
  type PipelineStageItem,
  type UpdateJobStagesRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import { RequirePermissions } from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam } from '@/common/decorators/zod.decorator';

import { PipelineService } from './pipeline.service';

const jobIdParamSchema = z.object({ jobId: idSchema });

/**
 * The per-job pipeline override. It lives with the pipeline module because the
 * editor is the same screen; the jobs module owns everything else under `/jobs`.
 */
@ApiTags('jobs')
@Controller('jobs')
export class JobPipelineController {
  constructor(private readonly pipeline: PipelineService) {}

  @Put(':jobId/stages')
  @RequirePermissions('pipeline:manage')
  @Audit({ action: 'UPDATE', entity: 'JobPipelineStage', idParam: 'jobId' })
  @ApiOperation({ summary: 'Replace a job’s own pipeline stages' })
  replace(
    @ZodParam(jobIdParamSchema) params: { jobId: string },
    @ZodBody(updateJobStagesSchema) body: UpdateJobStagesRequest,
  ): Promise<PipelineStageItem[]> {
    return this.pipeline.replaceJobStages(params.jobId, body);
  }
}
