import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  acceptResumeSchema,
  completeResumeUploadSchema,
  idSchema,
  reparseResumeSchema,
  resumeQuerySchema,
  resumeUploadRequestSchema,
  updateResumeSchema,
  type AcceptResumeRequest,
  type AcceptResumeResponse,
  type CompleteResumeUploadRequest,
  type Paginated,
  type ReparseResumeRequest,
  type ResumeDetail,
  type ResumeQuery,
  type ResumeSummary,
  type ResumeUploadRequest,
  type ResumeUploadTicket,
  type UpdateResumeRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { ResumesService } from './resumes.service';

const idParamSchema = z.object({ id: idSchema });

/** Every read is gated either workspace-wide or to the caller's own records. */
const READ = ['candidate:read_all', 'candidate:read_own'] as const;

/**
 * Resumes (Phase 2, Module 5).
 *
 * Uploads never stream bytes through the API: `upload-url` reserves the row and
 * returns a presigned `PUT`, `complete` confirms the object landed and queues
 * parsing, and the remaining routes drive the review-and-accept flow. Writes are
 * gated by `candidate:create` — the only resume-specific capability a recruiter
 * needs — while reads accept either candidate read scope.
 */
@ApiTags('resumes')
@Controller('resumes')
export class ResumesController {
  constructor(private readonly resumes: ResumesService) {}

  @Get()
  @RequireAnyPermission(...READ)
  @ApiOperation({ summary: 'List resumes, optionally filtered by candidate or status' })
  list(@ZodQuery(resumeQuerySchema) query: ResumeQuery): Promise<Paginated<ResumeSummary>> {
    return this.resumes.list(query);
  }

  @Post('upload-url')
  @RequirePermissions('candidate:create')
  @Audit({ action: 'CREATE', entity: 'Resume', description: 'Created a resume upload' })
  @ApiOperation({ summary: 'Reserve an upload and return a presigned PUT URL' })
  createUploadUrl(
    @ZodBody(resumeUploadRequestSchema) body: ResumeUploadRequest,
  ): Promise<ResumeUploadTicket> {
    return this.resumes.createUploadTicket(body);
  }

  @Post(':id/complete')
  @RequirePermissions('candidate:create')
  @Audit({ action: 'UPDATE', entity: 'Resume', description: 'Completed a resume upload' })
  @ApiOperation({ summary: 'Confirm the upload finished and queue parsing' })
  complete(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(completeResumeUploadSchema) body: CompleteResumeUploadRequest,
  ): Promise<ResumeDetail> {
    return this.resumes.completeUpload(params.id, body);
  }

  @Post(':id/accept')
  @RequirePermissions('candidate:create')
  @Audit({ action: 'UPDATE', entity: 'Resume', description: 'Accepted a parsed resume' })
  @ApiOperation({ summary: 'Fold a reviewed parse into a candidate' })
  accept(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(acceptResumeSchema) body: AcceptResumeRequest,
  ): Promise<AcceptResumeResponse> {
    return this.resumes.accept(params.id, body);
  }

  @Post(':id/reparse')
  @RequirePermissions('candidate:create')
  @Audit({ action: 'UPDATE', entity: 'Resume', description: 'Re-parsed a resume' })
  @ApiOperation({ summary: 'Queue the resume for parsing again' })
  reparse(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(reparseResumeSchema) body: ReparseResumeRequest,
  ): Promise<ResumeDetail> {
    return this.resumes.reparse(params.id, body);
  }

  @Get(':id')
  @RequireAnyPermission(...READ)
  @ApiOperation({ summary: 'Read a resume, its parsed data and a download link' })
  detail(@ZodParam(idParamSchema) params: { id: string }): Promise<ResumeDetail> {
    return this.resumes.detail(params.id);
  }

  @Patch(':id')
  @RequirePermissions('candidate:create')
  @Audit({ action: 'UPDATE', entity: 'Resume' })
  @ApiOperation({ summary: 'Rename a resume or change its primary flag' })
  update(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updateResumeSchema) body: UpdateResumeRequest,
  ): Promise<ResumeDetail> {
    return this.resumes.update(params.id, body);
  }

  @Delete(':id')
  @RequirePermissions('candidate:create')
  @Audit({ action: 'DELETE', entity: 'Resume' })
  @ApiOperation({ summary: 'Delete a resume' })
  remove(@ZodParam(idParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.resumes.remove(params.id);
  }
}
