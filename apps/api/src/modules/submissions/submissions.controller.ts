import { Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  idSchema,
  submissionFeedbackSchema,
  submissionQuerySchema,
  submitApplicationSchema,
  updateSubmissionSchema,
  type Paginated,
  type SubmissionDetail,
  type SubmissionFeedbackRequest,
  type SubmissionListItem,
  type SubmissionQuery,
  type SubmitApplicationRequest,
  type UpdateSubmissionRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { SubmissionsService } from './submissions.service';

const idParamSchema = z.object({ id: idSchema });

/** The workspace-wide view of everything that has gone out to a client. */
@ApiTags('submissions')
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get()
  @RequireAnyPermission('application:read_all', 'application:read_own')
  @ApiOperation({ summary: 'List submissions with client, status, recruiter and date filters' })
  list(@ZodQuery(submissionQuerySchema) query: SubmissionQuery): Promise<Paginated<SubmissionListItem>> {
    return this.submissions.list(query);
  }
}

/**
 * The submission lifecycle, addressed by application. These live on their own
 * controller rather than inside `ApplicationsController` so the client-facing
 * half of an application stays in one file.
 */
@ApiTags('submissions')
@Controller('applications')
export class ApplicationSubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get(':id/submission')
  @RequireAnyPermission('application:read_all', 'application:read_own')
  @ApiOperation({ summary: 'Read a submission: state, tailored résumé, contact and timeline' })
  detail(@ZodParam(idParamSchema) params: { id: string }): Promise<SubmissionDetail> {
    return this.submissions.detail(params.id);
  }

  @Post(':id/submit')
  @RequirePermissions('submission:send')
  @Audit({
    action: 'STATUS_CHANGE',
    entity: 'Application',
    description: 'Submitted a candidate to a client',
  })
  @ApiOperation({ summary: 'Submit a candidate to the client, optionally with a tailored résumé' })
  submit(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(submitApplicationSchema) body: SubmitApplicationRequest,
  ): Promise<SubmissionDetail> {
    return this.submissions.submit(params.id, body);
  }

  @Patch(':id/submission')
  @RequirePermissions('application:update')
  @Audit({ action: 'STATUS_CHANGE', entity: 'Application', description: 'Changed a client submission status' })
  @ApiOperation({ summary: 'Move a submission through the client-facing states' })
  updateStatus(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updateSubmissionSchema) body: UpdateSubmissionRequest,
  ): Promise<SubmissionDetail> {
    return this.submissions.updateStatus(params.id, body);
  }

  @Post(':id/submission/feedback')
  @RequirePermissions('application:update')
  @Audit({ action: 'UPDATE', entity: 'Application', description: 'Recorded client feedback' })
  @ApiOperation({ summary: 'Record what the client said about a submission' })
  addFeedback(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(submissionFeedbackSchema) body: SubmissionFeedbackRequest,
  ): Promise<SubmissionDetail> {
    return this.submissions.addFeedback(params.id, body);
  }
}
