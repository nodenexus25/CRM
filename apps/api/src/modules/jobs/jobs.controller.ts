import { Controller, Delete, Get, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  assignRecruitersSchema,
  changeJobStatusSchema,
  cloneJobSchema,
  createJobSchema,
  idSchema,
  jobQuerySchema,
  updateJobSchema,
  type AssignRecruitersRequest,
  type ChangeJobStatusRequest,
  type CloneJobRequest,
  type CreateJobRequest,
  type JobDetail,
  type JobListItem,
  type JobPipelineStageSummary,
  type JobQuery,
  type JobStats,
  type Paginated,
  type UpdateJobRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { JobsService } from './jobs.service';

const idParamSchema = z.object({ id: idSchema });

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  @RequireAnyPermission('job:read_all', 'job:read_own')
  @ApiOperation({ summary: 'List requisitions with filters, search and pagination' })
  list(@ZodQuery(jobQuerySchema) query: JobQuery): Promise<Paginated<JobListItem>> {
    return this.jobs.list(query);
  }

  @Post()
  @RequirePermissions('job:create')
  @Audit({ action: 'CREATE', entity: 'Job' })
  @ApiOperation({ summary: 'Create a requisition and allocate its JOB-#### code' })
  create(@ZodBody(createJobSchema) body: CreateJobRequest): Promise<JobDetail> {
    return this.jobs.create(body);
  }

  @Get(':id')
  @RequireAnyPermission('job:read_all', 'job:read_own')
  @ApiOperation({ summary: 'Read a requisition in full' })
  detail(@ZodParam(idParamSchema) params: { id: string }): Promise<JobDetail> {
    return this.jobs.detail(params.id);
  }

  @Patch(':id')
  @RequirePermissions('job:update')
  @Audit({ action: 'UPDATE', entity: 'Job' })
  @ApiOperation({ summary: 'Edit a requisition' })
  update(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updateJobSchema) body: UpdateJobRequest,
  ): Promise<JobDetail> {
    return this.jobs.update(params.id, body);
  }

  @Delete(':id')
  @RequirePermissions('job:delete')
  @Audit({ action: 'DELETE', entity: 'Job' })
  @ApiOperation({ summary: 'Soft-delete a requisition' })
  remove(@ZodParam(idParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.jobs.remove(params.id);
  }

  @Post(':id/clone')
  @RequirePermissions('job:clone')
  @Audit({ action: 'CREATE', entity: 'Job', description: 'Cloned a requisition' })
  @ApiOperation({ summary: 'Duplicate a requisition as a new draft' })
  clone(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(cloneJobSchema) body: CloneJobRequest,
  ): Promise<JobDetail> {
    return this.jobs.clone(params.id, body);
  }

  @Post(':id/status')
  @RequirePermissions('job:update')
  @Audit({ action: 'STATUS_CHANGE', entity: 'Job' })
  @ApiOperation({ summary: 'Move a requisition through its status state machine' })
  changeStatus(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(changeJobStatusSchema) body: ChangeJobStatusRequest,
  ): Promise<JobDetail> {
    return this.jobs.changeStatus(params.id, body);
  }

  @Put(':id/recruiters')
  @RequirePermissions('job:assign')
  @Audit({ action: 'UPDATE', entity: 'JobAssignment' })
  @ApiOperation({ summary: 'Replace the recruiter assignments on a requisition' })
  assignRecruiters(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(assignRecruitersSchema) body: AssignRecruitersRequest,
  ): Promise<JobDetail> {
    return this.jobs.assignRecruiters(params.id, body);
  }

  @Get(':id/stats')
  @RequireAnyPermission('job:read_all', 'job:read_own')
  @ApiOperation({ summary: 'Roll-up statistics for the job header' })
  stats(@ZodParam(idParamSchema) params: { id: string }): Promise<JobStats> {
    return this.jobs.stats(params.id);
  }

  @Get(':id/pipeline')
  @RequireAnyPermission('job:read_all', 'job:read_own')
  @ApiOperation({ summary: 'The job’s effective pipeline stages' })
  pipeline(
    @ZodParam(idParamSchema) params: { id: string },
  ): Promise<JobPipelineStageSummary[]> {
    return this.jobs.pipelineStages(params.id);
  }
}
