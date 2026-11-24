import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ForbiddenError } from '../errors/domain-errors';
import {
  PERMISSIONS_KEY,
  type PermissionRequirement,
} from '../decorators/require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { requestContext } from '../request-context';

/**
 * Enforces `@RequirePermissions(...)`.
 *
 * Permission keys are `resource:action` with an optional record-level scope.
 * A holder of `candidate:read_all` satisfies a `candidate:read_own` requirement
 * — seeing everything includes seeing your own — but not the reverse. Platform
 * super admins short-circuit the check; their access is bounded by the tenant
 * guard's explicit impersonation instead.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requirement = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requirement || requirement.permissions.length === 0) return true;

    const current = requestContext.getOrThrow();
    if (current.isSuperAdmin) return true;

    const granted = current.permissions;
    const satisfied =
      requirement.mode === 'any'
        ? requirement.permissions.some((key) => hasPermission(granted, key))
        : requirement.permissions.every((key) => hasPermission(granted, key));

    if (!satisfied) {
      throw new ForbiddenError('Your role does not allow this action.');
    }

    return true;
  }
}

/** `_all` implies `_own` for the same resource. */
function hasPermission(granted: readonly string[], required: string): boolean {
  if (granted.includes(required)) return true;
  if (required.endsWith('_own')) {
    return granted.includes(`${required.replace(/_own$/, '')}_all`);
  }
  return false;
}
