import { Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { updateTenantSchema, type TenantDetail, type UpdateTenantRequest } from '@talentflow/types';

import { Audit } from '@/common/decorators/audit.decorator';
import { RequirePermissions } from '@/common/decorators/require-permissions.decorator';
import { ZodBody } from '@/common/decorators/zod.decorator';

import { TenantService } from './tenant.service';

@ApiTags('workspace')
@Controller('workspace')
export class TenantController {
  constructor(private readonly tenant: TenantService) {}

  @Get()
  @RequirePermissions('tenant:read')
  @ApiOperation({ summary: 'Workspace profile, branding, settings and member counts' })
  detail(): Promise<TenantDetail> {
    return this.tenant.detail();
  }

  @Patch()
  @RequirePermissions('tenant:update')
  @Audit({ action: 'UPDATE', entity: 'Tenant' })
  @ApiOperation({ summary: 'Update the workspace profile and settings' })
  update(@ZodBody(updateTenantSchema) body: UpdateTenantRequest): Promise<TenantDetail> {
    return this.tenant.update(body);
  }
}
