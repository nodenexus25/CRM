import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  addToPipelineSchema,
  applicationQuerySchema,
  idSchema,
  moveStageSchema,
  rejectApplicationSchema,
  removeFromPipelineQuerySchema,
  updateApplicationSchema,
  withdrawApplicationSchema,
  type AddToPipelineRequest,
  type AddToPipelineResult,
  type ApplicationDetail,
  type ApplicationListItem,
  type ApplicationQuery,
  type MoveStageRequest,
  type Paginated,
  type RejectApplicationRequest,
  type RemoveFromPipelineQuery,
  type StageHistoryItem,
  type UpdateApplicationRequest,
  type WithdrawApplicationRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { ApplicationsService } from './applications.service';

const idParamSchema = z.object({ id: idSchema });

/**
 * Applications and the pipeline operations that move them. The Kanban board
 * lives on its own controller (`/jobs/:jobId/board`) because it is addressed by
 * job rather than by application.
 */
@ApiTags('applications')
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  @RequireAnyPermission('application:read_all', 'application:read_own')
  @ApiOperation({ summary: 'List applications with filters, search and pagination' })
  list(@ZodQuery(applicationQuerySchema) query: ApplicationQuery): Promise<Paginated<ApplicationListItem>> {
    return this.applications.list(query);
  }

  @Post()
  @RequirePermissions('application:create')
  @Audit({ action: 'CREATE', entity: 'Application', description: 'Added candidates to a pipeline' })
  @ApiOperation({ summary: 'Add one or more candidates to a job’s pipeline' })
  addToPipeline(@ZodBody(addToPipelineSchema) body: AddToPipelineRequest): Promise<AddToPipelineResult> {
    return this.applications.addToPipeline(body);
  }

  @Get(':id')
  @RequireAnyPermission('application:read_all', 'application:read_own')
  @ApiOperation({ summary: 'Read an application in full' })
  detail(@ZodParam(idParamSchema) params: { id: string }): Promise<ApplicationDetail> {
    return this.applications.detail(params.id);
  }

  @Patch(':id')
  @RequirePermissions('application:update')
  @Audit({ action: 'UPDATE', entity: 'Application' })
  @ApiOperation({ summary: 'Edit application details (owner, rating, submission state, source)' })
  update(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updateApplicationSchema) body: UpdateApplicationRequest,
  ): Promise<ApplicationDetail> {
    return this.applications.update(params.id, body);
  }

  @Post(':id/move')
  @RequirePermissions('application:move_stage')
  @Audit({ action: 'STATUS_CHANGE', entity: 'Application', description: 'Moved a candidate between stages' })
  @ApiOperation({ summary: 'Move an application to another pipeline stage' })
  move(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(moveStageSchema) body: MoveStageRequest,
  ): Promise<ApplicationDetail> {
    return this.applications.moveStage(params.id, body);
  }

  @Post(':id/reject')
  @RequirePermissions('application:move_stage')
  @Audit({ action: 'STATUS_CHANGE', entity: 'Application', description: 'Rejected a candidate' })
  @ApiOperation({ summary: 'Reject an application (moves it to the rejected stage)' })
  reject(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(rejectApplicationSchema) body: RejectApplicationRequest,
  ): Promise<ApplicationDetail> {
    return this.applications.reject(params.id, body);
  }

  @Post(':id/withdraw')
  @RequirePermissions('application:move_stage')
  @Audit({ action: 'STATUS_CHANGE', entity: 'Application', description: 'Withdrew an application' })
  @ApiOperation({ summary: 'Withdraw an application (moves it to the withdrawn stage)' })
  withdraw(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(withdrawApplicationSchema) body: WithdrawApplicationRequest,
  ): Promise<ApplicationDetail> {
    return this.applications.withdraw(params.id, body);
  }

  @Delete(':id')
  @RequirePermissions('application:delete')
  @Audit({ action: 'DELETE', entity: 'Application' })
  @ApiOperation({ summary: 'Soft-remove (default) or hard-delete an application' })
  remove(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodQuery(removeFromPipelineQuerySchema) query: RemoveFromPipelineQuery,
  ): Promise<{ removed: true }> {
    return this.applications.remove(params.id, query);
  }

  @Get(':id/history')
  @RequireAnyPermission('application:read_all', 'application:read_own')
  @ApiOperation({ summary: 'The application’s stage history, newest first' })
  history(@ZodParam(idParamSchema) params: { id: string }): Promise<StageHistoryItem[]> {
    return this.applications.history(params.id);
  }
}
