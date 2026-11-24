import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createTeamSchema,
  idSchema,
  updateTeamSchema,
  type CreateTeamRequest,
  type TeamListItem,
  type UpdateTeamRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import { RequirePermissions } from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam } from '@/common/decorators/zod.decorator';

import { TeamsService } from './teams.service';

const teamIdParamSchema = z.object({ id: idSchema });

@ApiTags('teams')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @RequirePermissions('user:read')
  @ApiOperation({ summary: 'List teams in the workspace' })
  list(): Promise<TeamListItem[]> {
    return this.teams.list();
  }

  @Post()
  @RequirePermissions('user:update')
  @Audit({ action: 'CREATE', entity: 'Team' })
  @ApiOperation({ summary: 'Create a team and set its members' })
  create(@ZodBody(createTeamSchema) body: CreateTeamRequest): Promise<TeamListItem> {
    return this.teams.create(body);
  }

  @Patch(':id')
  @RequirePermissions('user:update')
  @Audit({ action: 'UPDATE', entity: 'Team' })
  @ApiOperation({ summary: 'Rename a team, move it in the hierarchy or change members' })
  update(
    @ZodParam(teamIdParamSchema) params: { id: string },
    @ZodBody(updateTeamSchema) body: UpdateTeamRequest,
  ): Promise<TeamListItem> {
    return this.teams.update(params.id, body);
  }

  @Delete(':id')
  @RequirePermissions('user:update')
  @Audit({ action: 'DELETE', entity: 'Team' })
  @ApiOperation({ summary: 'Delete a team' })
  remove(@ZodParam(teamIdParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.teams.remove(params.id);
  }
}
