import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  boardQuerySchema,
  idSchema,
  type BoardQuery,
  type BoardResponse,
} from '@talentflow/types';
import { z } from 'zod';

import { RequireAnyPermission } from '@/common/decorators/require-permissions.decorator';
import { ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { ApplicationsService } from './applications.service';

const jobIdParamSchema = z.object({ jobId: idSchema });

/**
 * The Kanban board for a job. It lives with the applications module because it
 * returns applications grouped by pipeline stage, but it is addressed under
 * `/jobs` alongside the rest of the job resources.
 */
@ApiTags('jobs')
@Controller('jobs')
export class JobBoardController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get(':jobId/board')
  @RequireAnyPermission('application:read_all', 'application:read_own', 'job:read_all', 'job:read_own')
  @ApiOperation({ summary: 'The job’s pipeline board: one column per stage, cards pre-sorted' })
  board(
    @ZodParam(jobIdParamSchema) params: { jobId: string },
    @ZodQuery(boardQuerySchema) query: BoardQuery,
  ): Promise<BoardResponse> {
    return this.applications.board(params.jobId, query);
  }
}
