import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ForbiddenError, TenantRequiredError } from '../errors/domain-errors';
import { NO_TENANT_KEY } from '../decorators/allow-no-tenant.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { requestContext } from '../request-context';
import { IMPERSONATION_HEADER, readHeader } from '../http/headers';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '@/modules/auth/session.service';
import type { AuthenticatedRequest } from './jwt-auth.guard';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Layer 1 of tenant isolation: decides which workspace the request runs in.
 *
 * By default that is the tenant baked into the access token. A platform super
 * admin may target a different workspace with `X-Tenant-Id`; the switch is
 * validated, recorded in the request context, and audited so impersonation is
 * never silent.
 *
 * Routes that legitimately have no workspace opt out with `@AllowNoTenant()`,
 * which keeps the exceptions in one greppable place.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly session: SessionService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const allowsNoTenant = this.reflector.getAllAndOverride<boolean>(NO_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic || allowsNoTenant) return true;

    const current = requestContext.getOrThrow();
    if (!current.tenantId || !current.userId) {
      throw new TenantRequiredError();
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const requested = readHeader(request.headers, IMPERSONATION_HEADER);
    const user = request.user;

    if (!requested || requested === current.tenantId || !user) {
      return true;
    }

    if (!user.isSuperAdmin) {
      throw new ForbiddenError('You cannot access another workspace.');
    }

    const tenant = await this.session.requireActiveTenant(requested);

    request.user = { ...user, tenantId: tenant.id, isImpersonating: true };
    requestContext.patch({ tenantId: tenant.id, isImpersonating: true });

    // Reads are not audited individually — that would bury the trail in
    // noise — but any state-changing impersonated call is.
    if (MUTATING_METHODS.has(request.method)) {
      await this.audit.record({
        action: 'IMPERSONATE',
        entity: 'Tenant',
        entityId: tenant.id,
        description: `${user.email} acted in ${tenant.name} as a platform super admin`,
        tenantId: tenant.id,
        actorId: user.id,
        actorEmail: user.email,
      });
    }

    return true;
  }
}
