import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createInterviewSchema,
  idSchema,
  interviewCalendarQuerySchema,
  interviewFeedbackSchema,
  interviewQuerySchema,
  updateInterviewSchema,
  type CreateInterviewRequest,
  type InterviewCalendarItem,
  type InterviewCalendarQuery,
  type InterviewDetail,
  type InterviewFeedbackRequest,
  type InterviewListItem,
  type InterviewQuery,
  type Paginated,
  type UpdateInterviewRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import { RequirePermissions } from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { InterviewsService } from './interviews.service';

const idParamSchema = z.object({ id: idSchema });

/**
 * Interviews. `interview:read` is a single workspace-wide permission rather than
 * an `_all`/`_own` pair, so every read is scoped by the workspace alone and no
 * owner filter is applied.
 */
@ApiTags('interviews')
@Controller('interviews')
export class InterviewsController {
  constructor(private readonly interviews: InterviewsService) {}

  @Get()
  @RequirePermissions('interview:read')
  @ApiOperation({ summary: 'List interviews with status, type, panel and date filters' })
  list(@ZodQuery(interviewQuerySchema) query: InterviewQuery): Promise<Paginated<InterviewListItem>> {
    return this.interviews.list(query);
  }

  // Declared before `:id` so the literal path wins the route match.
  @Get('calendar')
  @RequirePermissions('interview:read')
  @ApiOperation({ summary: 'Every live interview overlapping a window, for a calendar' })
  calendar(
    @ZodQuery(interviewCalendarQuerySchema) query: InterviewCalendarQuery,
  ): Promise<InterviewCalendarItem[]> {
    return this.interviews.calendar(query);
  }

  @Post()
  @RequirePermissions('interview:create')
  @Audit({ action: 'CREATE', entity: 'Interview' })
  @ApiOperation({ summary: 'Schedule an interview and put the panel on it' })
  create(@ZodBody(createInterviewSchema) body: CreateInterviewRequest): Promise<InterviewDetail> {
    return this.interviews.create(body);
  }

  @Get(':id')
  @RequirePermissions('interview:read')
  @ApiOperation({ summary: 'Read an interview with its panel and scorecard' })
  detail(@ZodParam(idParamSchema) params: { id: string }): Promise<InterviewDetail> {
    return this.interviews.detail(params.id);
  }

  @Patch(':id')
  @RequirePermissions('interview:update')
  @Audit({ action: 'UPDATE', entity: 'Interview' })
  @ApiOperation({ summary: 'Edit, reschedule or re-status an interview' })
  update(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updateInterviewSchema) body: UpdateInterviewRequest,
  ): Promise<InterviewDetail> {
    return this.interviews.update(params.id, body);
  }

  @Delete(':id')
  @RequirePermissions('interview:delete')
  @Audit({ action: 'DELETE', entity: 'Interview' })
  @ApiOperation({ summary: 'Cancel and soft-delete an interview' })
  remove(@ZodParam(idParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.interviews.remove(params.id);
  }

  @Post(':id/feedback')
  @RequirePermissions('interview:feedback')
  @Audit({ action: 'UPDATE', entity: 'Interview', description: 'Recorded interview feedback' })
  @ApiOperation({ summary: 'Record an interviewer’s scorecard' })
  addFeedback(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(interviewFeedbackSchema) body: InterviewFeedbackRequest,
  ): Promise<InterviewDetail> {
    return this.interviews.addFeedback(params.id, body);
  }
}
