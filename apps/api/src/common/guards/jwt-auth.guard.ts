import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { UnauthorizedError } from '../errors/domain-errors';
import type { AuthenticatedUser } from '../auth/principal';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { requestContext } from '../request-context';
import { readCookie } from '../http/cookies';
import type { AppConfig } from '@/config/configuration';
import { SessionService } from '@/modules/auth/session.service';
import { TokenService } from '@/modules/auth/token.service';

export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

interface ExtractedToken {
  token: string;
  method: 'cookie' | 'bearer';
}

/**
 * Layer 1 of authentication: turns a credential into a principal.
 *
 * The access token is read from the `tf_at` httpOnly cookie (browsers) or an
 * `Authorization: Bearer` header (server-to-server and tests). It is verified
 * against the access secret, then the database is consulted so a token issued
 * before a role change or a suspension cannot keep working.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly tokens: TokenService,
    private readonly session: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const extracted = this.extractToken(request);
    if (!extracted) {
      throw new UnauthorizedError();
    }

    const payload = await this.tokens.verifyAccessToken(extracted.token);

    // Pin the tenant *before* any scoped read, so the tenancy extension can
    // scope the principal lookup itself.
    requestContext.patch({
      tenantId: payload.tid,
      userId: payload.sub,
      isSuperAdmin: Boolean(payload.sad),
      authMethod: extracted.method,
    });

    const user = await this.session.resolveAuthenticatedUser(payload);

    request.user = user;
    requestContext.patch({
      tenantId: user.tenantId,
      userId: user.id,
      permissions: user.permissions,
      isSuperAdmin: user.isSuperAdmin,
      isImpersonating: user.isImpersonating,
    });

    return true;
  }

  private extractToken(request: AuthenticatedRequest): ExtractedToken | null {
    const authorization = request.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
      const token = authorization.slice('Bearer '.length).trim();
      if (token) return { token, method: 'bearer' };
    }

    const cookie = readCookie(request, this.config.get('cookie', { infer: true }).accessName);
    return cookie ? { token: cookie, method: 'cookie' } : null;
  }
}
