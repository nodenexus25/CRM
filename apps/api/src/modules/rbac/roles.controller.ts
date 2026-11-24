import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createRoleSchema,
  idSchema,
  roleQuerySchema,
  updateRoleSchema,
  type CreateRoleRequest,
  type Paginated,
  type PermissionGroup,
  type RoleDetail,
  type RoleListItem,
  type RoleQuery,
  type UpdateRoleRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import { RequirePermissions } from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { RolesService } from './roles.service';

const roleIdParamSchema = z.object({ id: idSchema });

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('role:read')
  @ApiOperation({ summary: 'List roles in the workspace' })
  list(@ZodQuery(roleQuerySchema) query: RoleQuery): Promise<Paginated<RoleListItem>> {
    return this.roles.list(query);
  }

  @Get('catalogue')
  @RequirePermissions('role:read')
  @ApiOperation({ summary: 'Full permission catalogue, grouped for the role editor' })
  catalogue(): Promise<PermissionGroup[]> {
    return this.roles.catalogue();
  }

  @Get(':id')
  @RequirePermissions('role:read')
  @ApiOperation({ summary: 'Role detail with its permission matrix and holders' })
  detail(@ZodParam(roleIdParamSchema) params: { id: string }): Promise<RoleDetail> {
    return this.roles.detail(params.id);
  }

  @Post()
  @RequirePermissions('role:manage')
  @Audit({ action: 'CREATE', entity: 'Role' })
  @ApiOperation({ summary: 'Create a custom role' })
  create(@ZodBody(createRoleSchema) body: CreateRoleRequest): Promise<RoleDetail> {
    return this.roles.create(body);
  }

  @Patch(':id')
  @RequirePermissions('role:manage')
  @Audit({ action: 'UPDATE', entity: 'Role' })
  @ApiOperation({ summary: 'Rename a role or change its permissions' })
  update(
    @ZodParam(roleIdParamSchema) params: { id: string },
    @ZodBody(updateRoleSchema) body: UpdateRoleRequest,
  ): Promise<RoleDetail> {
    return this.roles.update(params.id, body);
  }

  @Delete(':id')
  @RequirePermissions('role:manage')
  @Audit({ action: 'DELETE', entity: 'Role' })
  @ApiOperation({ summary: 'Delete a custom role' })
  remove(@ZodParam(roleIdParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.roles.remove(params.id);
  }
}
