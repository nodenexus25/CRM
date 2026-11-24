import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { IMPERSONATION_HEADER, readHeader } from '../http/headers';

/**
 * Injects the workspace id a platform super admin is currently acting in
 * (`X-Tenant-Id`), or `undefined` when they are in their own workspace.
 */
export const ActiveTenantId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined => {
    const request = context.switchToHttp().getRequest<Request>();
    return readHeader(request.headers, IMPERSONATION_HEADER);
  },
);
