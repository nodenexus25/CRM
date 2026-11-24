import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  candidateEducationInputSchema,
  candidateEmailInputSchema,
  candidateExperienceInputSchema,
  candidateLanguageInputSchema,
  candidatePhoneInputSchema,
  candidateQuerySchema,
  candidateSkillInputSchema,
  candidateCertificationInputSchema,
  createCandidateSchema,
  duplicateCheckSchema,
  idSchema,
  mergeCandidatesSchema,
  updateCandidateOwnerSchema,
  updateCandidateSchema,
  type CandidateDetail,
  type CandidateDuplicateResponse,
  type CandidateListItem,
  type CandidateQuery,
  type CreateCandidateRequest,
  type DuplicateCheckRequest,
  type MergeCandidatesRequest,
  type Paginated,
  type UpdateCandidateOwnerRequest,
  type UpdateCandidateRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { CandidatesService } from './candidates.service';

const idParamSchema = z.object({ id: idSchema });
const childParamSchema = z.object({ id: idSchema, childId: idSchema });
const skillParamSchema = z.object({ id: idSchema, skillId: idSchema });

const updateEmailSchema = candidateEmailInputSchema.partial();
const updatePhoneSchema = candidatePhoneInputSchema.partial();
const updateExperienceSchema = candidateExperienceInputSchema.partial();
const updateEducationSchema = candidateEducationInputSchema.partial();
const updateSkillSchema = candidateSkillInputSchema.partial();
const updateCertificationSchema = candidateCertificationInputSchema.partial();
const updateLanguageSchema = candidateLanguageInputSchema.partial();

/** Every read is gated either workspace-wide or to the caller's own records. */
const READ = ['candidate:read_all', 'candidate:read_own'] as const;

@ApiTags('candidates')
@Controller('candidates')
export class CandidatesController {
  constructor(private readonly candidates: CandidatesService) {}

  @Get()
  @RequireAnyPermission(...READ)
  @ApiOperation({ summary: 'List candidates with filters, boolean search and pagination' })
  list(@ZodQuery(candidateQuerySchema) query: CandidateQuery): Promise<Paginated<CandidateListItem>> {
    return this.candidates.list(query);
  }

  @Post()
  @RequirePermissions('candidate:create')
  @Audit({ action: 'CREATE', entity: 'Candidate' })
  @ApiOperation({ summary: 'Create a candidate, warning on likely duplicates' })
  create(@ZodBody(createCandidateSchema) body: CreateCandidateRequest): Promise<CandidateDetail> {
    return this.candidates.create(body);
  }

  @Post('duplicates')
  @RequireAnyPermission(...READ)
  @ApiOperation({ summary: 'Check for likely duplicates before saving' })
  duplicates(
    @ZodBody(duplicateCheckSchema) body: DuplicateCheckRequest,
  ): Promise<CandidateDuplicateResponse> {
    return this.candidates.duplicates(body);
  }

  @Post('merge')
  @RequirePermissions('candidate:merge')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Merged duplicate candidates' })
  @ApiOperation({ summary: 'Merge duplicate records into a primary candidate' })
  merge(@ZodBody(mergeCandidatesSchema) body: MergeCandidatesRequest): Promise<CandidateDetail> {
    return this.candidates.merge(body);
  }

  @Get(':id')
  @RequireAnyPermission(...READ)
  @ApiOperation({ summary: 'Read a candidate in full' })
  detail(@ZodParam(idParamSchema) params: { id: string }): Promise<CandidateDetail> {
    return this.candidates.detail(params.id);
  }

  @Patch(':id')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate' })
  @ApiOperation({ summary: 'Edit a candidate profile' })
  update(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updateCandidateSchema) body: UpdateCandidateRequest,
  ): Promise<CandidateDetail> {
    return this.candidates.update(params.id, body);
  }

  @Patch(':id/owner')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Reassigned candidate owner' })
  @ApiOperation({ summary: 'Reassign a candidate to another owner' })
  updateOwner(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updateCandidateOwnerSchema) body: UpdateCandidateOwnerRequest,
  ): Promise<CandidateDetail> {
    return this.candidates.updateOwner(params.id, body);
  }

  @Delete(':id')
  @RequirePermissions('candidate:delete')
  @Audit({ action: 'DELETE', entity: 'Candidate' })
  @ApiOperation({ summary: 'Soft-delete a candidate' })
  remove(@ZodParam(idParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.candidates.remove(params.id);
  }

  // ---------------------------------------------------------------------------
  // Sub-resources — every write returns the refreshed candidate detail
  // ---------------------------------------------------------------------------

  @Post(':id/emails')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Added a candidate email' })
  @ApiOperation({ summary: 'Add an email address to a candidate' })
  addEmail(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(candidateEmailInputSchema) body: z.infer<typeof candidateEmailInputSchema>,
  ): Promise<CandidateDetail> {
    return this.candidates.addEmail(params.id, body);
  }

  @Patch(':id/emails/:childId')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Edited a candidate email' })
  @ApiOperation({ summary: 'Edit a candidate email address' })
  updateEmail(
    @ZodParam(childParamSchema) params: { id: string; childId: string },
    @ZodBody(updateEmailSchema) body: z.infer<typeof updateEmailSchema>,
  ): Promise<CandidateDetail> {
    return this.candidates.updateEmail(params.id, params.childId, body);
  }

  @Delete(':id/emails/:childId')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Removed a candidate email' })
  @ApiOperation({ summary: 'Remove a candidate email address' })
  removeEmail(@ZodParam(childParamSchema) params: { id: string; childId: string }): Promise<CandidateDetail> {
    return this.candidates.removeEmail(params.id, params.childId);
  }

  @Post(':id/phones')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Added a candidate phone' })
  @ApiOperation({ summary: 'Add a phone number to a candidate' })
  addPhone(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(candidatePhoneInputSchema) body: z.infer<typeof candidatePhoneInputSchema>,
  ): Promise<CandidateDetail> {
    return this.candidates.addPhone(params.id, body);
  }

  @Patch(':id/phones/:childId')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Edited a candidate phone' })
  @ApiOperation({ summary: 'Edit a candidate phone number' })
  updatePhone(
    @ZodParam(childParamSchema) params: { id: string; childId: string },
    @ZodBody(updatePhoneSchema) body: z.infer<typeof updatePhoneSchema>,
  ): Promise<CandidateDetail> {
    return this.candidates.updatePhone(params.id, params.childId, body);
  }

  @Delete(':id/phones/:childId')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Removed a candidate phone' })
  @ApiOperation({ summary: 'Remove a candidate phone number' })
  removePhone(@ZodParam(childParamSchema) params: { id: string; childId: string }): Promise<CandidateDetail> {
    return this.candidates.removePhone(params.id, params.childId);
  }

  @Post(':id/experiences')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Added candidate experience' })
  @ApiOperation({ summary: 'Add a work experience entry' })
  addExperience(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(candidateExperienceInputSchema) body: z.infer<typeof candidateExperienceInputSchema>,
  ): Promise<CandidateDetail> {
    return this.candidates.addExperience(params.id, body);
  }

  @Patch(':id/experiences/:childId')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Edited candidate experience' })
  @ApiOperation({ summary: 'Edit a work experience entry' })
  updateExperience(
    @ZodParam(childParamSchema) params: { id: string; childId: string },
    @ZodBody(updateExperienceSchema) body: z.infer<typeof updateExperienceSchema>,
  ): Promise<CandidateDetail> {
    return this.candidates.updateExperience(params.id, params.childId, body);
  }

  @Delete(':id/experiences/:childId')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Removed candidate experience' })
  @ApiOperation({ summary: 'Remove a work experience entry' })
  removeExperience(@ZodParam(childParamSchema) params: { id: string; childId: string }): Promise<CandidateDetail> {
    return this.candidates.removeExperience(params.id, params.childId);
  }

  @Post(':id/educations')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Added candidate education' })
  @ApiOperation({ summary: 'Add an education entry' })
  addEducation(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(candidateEducationInputSchema) body: z.infer<typeof candidateEducationInputSchema>,
  ): Promise<CandidateDetail> {
    return this.candidates.addEducation(params.id, body);
  }

  @Patch(':id/educations/:childId')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Edited candidate education' })
  @ApiOperation({ summary: 'Edit an education entry' })
  updateEducation(
    @ZodParam(childParamSchema) params: { id: string; childId: string },
    @ZodBody(updateEducationSchema) body: z.infer<typeof updateEducationSchema>,
  ): Promise<CandidateDetail> {
    return this.candidates.updateEducation(params.id, params.childId, body);
  }

  @Delete(':id/educations/:childId')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Removed candidate education' })
  @ApiOperation({ summary: 'Remove an education entry' })
  removeEducation(@ZodParam(childParamSchema) params: { id: string; childId: string }): Promise<CandidateDetail> {
    return this.candidates.removeEducation(params.id, params.childId);
  }

  @Post(':id/skills')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Added a candidate skill' })
  @ApiOperation({ summary: 'Add or update a candidate skill' })
  addSkill(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(candidateSkillInputSchema) body: z.infer<typeof candidateSkillInputSchema>,
  ): Promise<CandidateDetail> {
    return this.candidates.addSkill(params.id, body);
  }

  @Patch(':id/skills/:skillId')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Edited a candidate skill' })
  @ApiOperation({ summary: 'Edit a candidate skill' })
  updateSkill(
    @ZodParam(skillParamSchema) params: { id: string; skillId: string },
    @ZodBody(updateSkillSchema) body: z.infer<typeof updateSkillSchema>,
  ): Promise<CandidateDetail> {
    return this.candidates.updateSkill(params.id, params.skillId, body);
  }

  @Delete(':id/skills/:skillId')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Removed a candidate skill' })
  @ApiOperation({ summary: 'Remove a candidate skill' })
  removeSkill(@ZodParam(skillParamSchema) params: { id: string; skillId: string }): Promise<CandidateDetail> {
    return this.candidates.removeSkill(params.id, params.skillId);
  }

  @Post(':id/certifications')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Added a certification' })
  @ApiOperation({ summary: 'Add a certification' })
  addCertification(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(candidateCertificationInputSchema) body: z.infer<typeof candidateCertificationInputSchema>,
  ): Promise<CandidateDetail> {
    return this.candidates.addCertification(params.id, body);
  }

  @Patch(':id/certifications/:childId')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Edited a certification' })
  @ApiOperation({ summary: 'Edit a certification' })
  updateCertification(
    @ZodParam(childParamSchema) params: { id: string; childId: string },
    @ZodBody(updateCertificationSchema) body: z.infer<typeof updateCertificationSchema>,
  ): Promise<CandidateDetail> {
    return this.candidates.updateCertification(params.id, params.childId, body);
  }

  @Delete(':id/certifications/:childId')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Removed a certification' })
  @ApiOperation({ summary: 'Remove a certification' })
  removeCertification(@ZodParam(childParamSchema) params: { id: string; childId: string }): Promise<CandidateDetail> {
    return this.candidates.removeCertification(params.id, params.childId);
  }

  @Post(':id/languages')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Added a language' })
  @ApiOperation({ summary: 'Add a spoken language' })
  addLanguage(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(candidateLanguageInputSchema) body: z.infer<typeof candidateLanguageInputSchema>,
  ): Promise<CandidateDetail> {
    return this.candidates.addLanguage(params.id, body);
  }

  @Patch(':id/languages/:childId')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Edited a language' })
  @ApiOperation({ summary: 'Edit a spoken language' })
  updateLanguage(
    @ZodParam(childParamSchema) params: { id: string; childId: string },
    @ZodBody(updateLanguageSchema) body: z.infer<typeof updateLanguageSchema>,
  ): Promise<CandidateDetail> {
    return this.candidates.updateLanguage(params.id, params.childId, body);
  }

  @Delete(':id/languages/:childId')
  @RequirePermissions('candidate:update')
  @Audit({ action: 'UPDATE', entity: 'Candidate', description: 'Removed a language' })
  @ApiOperation({ summary: 'Remove a spoken language' })
  removeLanguage(@ZodParam(childParamSchema) params: { id: string; childId: string }): Promise<CandidateDetail> {
    return this.candidates.removeLanguage(params.id, params.childId);
  }
}
