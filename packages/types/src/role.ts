import { z } from 'zod';

import { idSchema, paginationQuerySchema } from './common';
import { permissionEffectSchema, roleKeySchema } from './enums';
import { isPermissionKey, type PermissionDefinition } from './permissions';

/** Validates a permission key against the catalogue at runtime. */
export const permissionKeySchema = z
  .string()
  .trim()
  .refine(isPermissionKey, { message: 'Unknown permission key' });

export const roleQuerySchema = paginationQuerySchema.extend({
  includeSystem: z.coerce.boolean().default(true),
});
export type RoleQuery = z.infer<typeof roleQuerySchema>;

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(400).optional(),
  /** Copied from this built-in template when the role is created. */
  basedOn: roleKeySchema.optional(),
  permissions: z.array(permissionKeySchema).max(200).default([]),
});
export type CreateRoleRequest = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(400).nullable().optional(),
  permissions: z.array(permissionKeySchema).max(200).optional(),
});
export type UpdateRoleRequest = z.infer<typeof updateRoleSchema>;

export const assignRoleSchema = z.object({
  userId: idSchema,
  roleId: idSchema,
  effect: permissionEffectSchema.default('ALLOW'),
});
export type AssignRoleRequest = z.infer<typeof assignRoleSchema>;

export interface RoleListItem {
  id: string;
  key: z.infer<typeof roleKeySchema> | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  priority: number;
  permissions: string[];
  permissionCount: number;
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoleDetail extends RoleListItem {
  /** Full catalogue with an `enabled` flag, ready for the permission editor. */
  permissionMatrix: {
    group: string;
    permissions: (PermissionDefinition & { enabled: boolean })[];
  }[];
  users: { id: string; fullName: string; email: string; avatarUrl: string | null }[];
}

export interface PermissionGroup {
  group: string;
  permissions: PermissionDefinition[];
}

export interface EffectivePermissions {
  userId: string;
  roles: { id: string; key: z.infer<typeof roleKeySchema> | null; name: string }[];
  permissions: string[];
}
