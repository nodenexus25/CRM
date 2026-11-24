import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { tap } from 'rxjs';

import { AUDIT_KEY, type AuditMetadata } from '../decorators/audit.decorator';
import { AuditService } from '../audit/audit.service';

/**
 * Writes an `AuditLog` entry for routes decorated with `@Audit(...)`.
 *
 * The entry is written after the handler succeeds, and never awaited by the
 * response — auditing must not add latency to the request path.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const metadata = this.reflector.getAllAndOverride<AuditMetadata | undefined>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!metadata || context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const idParam = metadata.idParam ?? 'id';
    const rawParamId = request.params?.[idParam];
    const paramId = Array.isArray(rawParamId) ? rawParamId[0] : rawParamId;

    return next.handle().pipe(
      tap((payload: unknown) => {
        const entityId = paramId ?? readId(payload);

        void this.audit.record({
          action: metadata.action,
          entity: metadata.entity,
          entityId,
          description: metadata.description,
          snapshot: metadata.action === 'UPDATE' ? undefined : redact(payload),
          changes: metadata.action === 'UPDATE' ? redact(payload) : undefined,
        });
      }),
    );
  }
}

function readId(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object' && 'id' in payload) {
    const id = (payload as { id?: unknown }).id;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}

/** Drops values that must never be persisted in an audit trail. */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
]);

function redact(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload.map(redact);
  if (!payload || typeof payload !== 'object') return payload;

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    output[key] = REDACTED_KEYS.has(key) ? '[redacted]' : redact(value);
  }
  return output;
}
