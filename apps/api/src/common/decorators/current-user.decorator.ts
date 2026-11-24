import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { ForbiddenError } from '../errors/domain-errors';
import { requestContext, type RequestContext } from '../request-context';
import type { AuthenticatedUser } from '../auth/principal';

/**
 * Injects the authenticated principal, or a single field of it:
 * `@CurrentUser() user: AuthenticatedUser` / `@CurrentUser('id') userId: string`.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenError('This route requires an authenticated user');
    }
    return field ? user[field] : user;
  },
);

/** Injects the ambient request context, guaranteeing a tenant is present. */
export const CurrentContext = createParamDecorator((_data: unknown, _ctx: ExecutionContext) => {
  const context = requestContext.get();
  if (!context) {
    throw new ForbiddenError('No request context is active');
  }
  return context;
});

/** Injects the resolved tenant id, failing loudly when it is missing. */
export const CurrentTenantId = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): string => {
    const context = requestContext.get();
    if (!context?.tenantId) {
      throw new ForbiddenError('This route must run inside a workspace');
    }
    return context.tenantId;
  },
);

export type { RequestContext };
