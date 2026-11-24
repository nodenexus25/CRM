import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  candidateListMembershipSchema,
  candidateListQuerySchema,
  createCandidateListSchema,
  idSchema,
  updateCandidateListSchema,
  type CandidateListQuery,
  type CandidateListSummary,
  type CandidateListMembershipRequest,
  type CreateCandidateListRequest,
  type Paginated,
  type UpdateCandidateListRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { CandidateListsService } from './candidate-lists.service';

const idParamSchema = z.object({ id: idSchema });

@ApiTags('candidate-lists')
@Controller('candidate-lists')
export class CandidateListsController {
  constructor(private readonly lists: CandidateListsService) {}

  @Get()
  @RequireAnyPermission('list:read', 'candidate:read_own')
  @ApiOperation({ summary: 'List hotlists and talent pools' })
  list(@ZodQuery(candidateListQuerySchema) query: CandidateListQuery): Promise<Paginated<CandidateListSummary>> {
    return this.lists.list(query);
  }

  @Post()
  @RequirePermissions('list:manage')
  @Audit({ action: 'CREATE', entity: 'CandidateList' })
  @ApiOperation({ summary: 'Create a hotlist' })
  create(@ZodBody(createCandidateListSchema) body: CreateCandidateListRequest): Promise<CandidateListSummary> {
    return this.lists.create(body);
  }

  @Get(':id')
  @RequireAnyPermission('list:read', 'candidate:read_own')
  @ApiOperation({ summary: 'Read a hotlist' })
  detail(@ZodParam(idParamSchema) params: { id: string }): Promise<CandidateListSummary> {
    return this.lists.detail(params.id);
  }

  @Patch(':id')
  @RequirePermissions('list:manage')
  @Audit({ action: 'UPDATE', entity: 'CandidateList' })
  @ApiOperation({ summary: 'Edit a hotlist' })
  update(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updateCandidateListSchema) body: UpdateCandidateListRequest,
  ): Promise<CandidateListSummary> {
    return this.lists.update(params.id, body);
  }

  @Delete(':id')
  @RequirePermissions('list:manage')
  @Audit({ action: 'DELETE', entity: 'CandidateList' })
  @ApiOperation({ summary: 'Delete a hotlist' })
  remove(@ZodParam(idParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.lists.remove(params.id);
  }

  @Post(':id/members')
  @RequirePermissions('list:manage')
  @Audit({ action: 'UPDATE', entity: 'CandidateList', description: 'Added candidates to a hotlist' })
  @ApiOperation({ summary: 'Add candidates to a hotlist' })
  addMembers(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(candidateListMembershipSchema) body: CandidateListMembershipRequest,
  ): Promise<CandidateListSummary> {
    return this.lists.addMembers(params.id, body);
  }

  @Delete(':id/members')
  @RequirePermissions('list:manage')
  @Audit({ action: 'UPDATE', entity: 'CandidateList', description: 'Removed candidates from a hotlist' })
  @ApiOperation({ summary: 'Remove candidates from a hotlist' })
  removeMembers(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(candidateListMembershipSchema) body: CandidateListMembershipRequest,
  ): Promise<CandidateListSummary> {
    return this.lists.removeMembers(params.id, body);
  }
}
