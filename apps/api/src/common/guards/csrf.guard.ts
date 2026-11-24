import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { ForbiddenError } from '../errors/domain-errors';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { requestContext } from '../request-context';
import { readCookie } from '../http/cookies';
import type { AppConfig } from '@/config/configuration';
import type { AuthenticatedRequest } from './jwt-auth.guard';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Header name is configurable so a deployment can align it with its gateway. */
const CSRF_HEADER_FALLBACK = 'x-csrf-token';

/**
 * Double-submit CSRF protection for cookie-authenticated writes.
 *
 * The access cookie is `SameSite=Lax`, which already blocks cross-site POSTs in
 * modern browsers; this is the second lock. The token lives in a
 * JavaScript-readable cookie that an attacker on another origin cannot read, so
 * echoing it in a header proves the request came from the app itself.
 *
 * Bearer-authenticated calls are exempt: nothing is sent ambiently, so there is
 * nothing to forge.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (SAFE_METHODS.has(request.method)) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const current = requestContext.get();
    if (current?.authMethod !== 'cookie') return true;

    const cookie = this.config.get('cookie', { infer: true });
    const expected = readCookie(request, cookie.csrfName);
    const provided = request.headers[cookie.csrfHeader ?? CSRF_HEADER_FALLBACK];

    if (!expected || typeof provided !== 'string' || provided !== expected) {
      throw new ForbiddenError(
        'Your security token is missing or stale. Reload the page and try again.',
      );
    }

    return true;
  }
}
