import { SetMetadata } from '@nestjs/common';

import type { PermissionKey } from '@talentflow/types';

export const PERMISSIONS_KEY = 'auth:permissions';

export interface PermissionRequirement {
  permissions: readonly PermissionKey[];
  mode: 'all' | 'any';
}

/**
 * Requires every listed permission. Permission keys are `resource:action` and
 * may carry a record-level scope (`candidate:update_own`).
 */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, { permissions, mode: 'all' } satisfies PermissionRequirement);

/** Requires at least one of the listed permissions. */
export const RequireAnyPermission = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, { permissions, mode: 'any' } satisfies PermissionRequirement);
