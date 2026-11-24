import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  adminResetPasswordSchema,
  assignRolesSchema,
  assignTeamsSchema,
  idSchema,
  inviteUserSchema,
  updateProfileSchema,
  updateUserSchema,
  userQuerySchema,
  type AdminResetPasswordRequest,
  type AssignRolesRequest,
  type AssignTeamsRequest,
  type EffectivePermissions,
  type InviteUserRequest,
  type Paginated,
  type UpdateProfileRequest,
  type UpdateUserRequest,
  type UserDetail,
  type UserListItem,
  type UserQuery,
} from '@talentflow/types';
import { z } from 'zod';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Audit } from '@/common/decorators/audit.decorator';
import { RequirePermissions } from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { UsersService } from './users.service';

const userIdParamSchema = z.object({ id: idSchema });

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('user:read')
  @ApiOperation({ summary: 'List users in the workspace' })
  list(@ZodQuery(userQuerySchema) query: UserQuery): Promise<Paginated<UserListItem>> {
    return this.users.list(query);
  }

  // Static routes are declared before `:id` so Nest's router matches them first.

  @Get('me/permissions')
  @ApiOperation({ summary: 'Effective permissions of the signed-in user' })
  ownPermissions(
    @CurrentUser('id') userId: string,
    @CurrentUser('isSuperAdmin') isSuperAdmin: boolean,
  ): Promise<EffectivePermissions> {
    return this.users.effectivePermissions(userId, isSuperAdmin);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update the signed-in user’s own profile' })
  updateOwnProfile(
    @CurrentUser('id') userId: string,
    @ZodBody(updateProfileSchema) body: UpdateProfileRequest,
  ): Promise<UserDetail> {
    return this.users.updateOwnProfile(userId, body);
  }

  @Post('invite')
  @RequirePermissions('user:invite')
  @Audit({ action: 'INVITE', entity: 'User' })
  @ApiOperation({ summary: 'Invite a new member to the workspace' })
  invite(@ZodBody(inviteUserSchema) body: InviteUserRequest): Promise<UserDetail> {
    return this.users.invite(body);
  }

  @Get(':id')
  @RequirePermissions('user:read')
  @ApiOperation({ summary: 'User detail with permissions, sessions and recent activity' })
  detail(
    @ZodParam(userIdParamSchema) params: { id: string },
    @CurrentUser('isSuperAdmin') isSuperAdmin: boolean,
  ): Promise<UserDetail> {
    return this.users.detail(params.id, isSuperAdmin);
  }

  @Get(':id/permissions')
  @RequirePermissions('user:read')
  @ApiOperation({ summary: 'Effective permissions of another user' })
  permissions(
    @ZodParam(userIdParamSchema) params: { id: string },
    @CurrentUser('isSuperAdmin') isSuperAdmin: boolean,
  ): Promise<EffectivePermissions> {
    return this.users.effectivePermissions(params.id, isSuperAdmin);
  }

  @Patch(':id')
  @RequirePermissions('user:update')
  @Audit({ action: 'UPDATE', entity: 'User' })
  @ApiOperation({ summary: 'Update a user’s profile, status, roles or teams' })
  update(
    @ZodParam(userIdParamSchema) params: { id: string },
    @ZodBody(updateUserSchema) body: UpdateUserRequest,
  ): Promise<UserDetail> {
    return this.users.update(params.id, body);
  }

  @Patch(':id/roles')
  @RequirePermissions('user:update')
  @Audit({ action: 'PERMISSION_CHANGE', entity: 'User' })
  @ApiOperation({ summary: 'Replace a user’s role assignments' })
  assignRoles(
    @ZodParam(userIdParamSchema) params: { id: string },
    @ZodBody(assignRolesSchema) body: AssignRolesRequest,
  ): Promise<UserDetail> {
    return this.users.assignRoles(params.id, body);
  }

  @Patch(':id/teams')
  @RequirePermissions('user:update')
  @Audit({ action: 'UPDATE', entity: 'User' })
  @ApiOperation({ summary: 'Replace a user’s team memberships' })
  assignTeams(
    @ZodParam(userIdParamSchema) params: { id: string },
    @ZodBody(assignTeamsSchema) body: AssignTeamsRequest,
  ): Promise<UserDetail> {
    return this.users.assignTeams(params.id, body);
  }

  @Post(':id/resend-invite')
  @RequirePermissions('user:invite')
  @Audit({ action: 'INVITE', entity: 'User' })
  @ApiOperation({ summary: 'Re-send a pending invitation' })
  resendInvite(@ZodParam(userIdParamSchema) params: { id: string }): Promise<{ sent: true }> {
    return this.users.resendInvite(params.id);
  }

  @Post(':id/reset-password')
  @RequirePermissions('user:update')
  @Audit({ action: 'PASSWORD_RESET', entity: 'User' })
  @ApiOperation({ summary: 'Set a new password on behalf of a user' })
  resetPassword(
    @ZodParam(userIdParamSchema) params: { id: string },
    @ZodBody(adminResetPasswordSchema) body: AdminResetPasswordRequest,
  ): Promise<{ reset: true }> {
    return this.users.adminResetPassword(params.id, body);
  }

  @Delete(':id')
  @RequirePermissions('user:delete')
  @Audit({ action: 'DELETE', entity: 'User' })
  @ApiOperation({ summary: 'Remove a user from the workspace (soft delete)' })
  remove(@ZodParam(userIdParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.users.remove(params.id);
  }

  @Post(':id/restore')
  @RequirePermissions('user:delete')
  @Audit({ action: 'RESTORE', entity: 'User' })
  @ApiOperation({ summary: 'Restore a previously removed user' })
  restore(@ZodParam(userIdParamSchema) params: { id: string }): Promise<UserDetail> {
    return this.users.restore(params.id);
  }
}
