import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import type { ApiSuccess } from '@talentflow/types';

import { NO_ENVELOPE_KEY } from '../decorators/no-envelope.decorator';

/**
 * Wraps every successful payload in the `ApiSuccess` envelope defined in
 * `packages/types`.
 *
 * A handler may shape its own envelope (returning `{ data, meta }`) — that is
 * how paginated lists expose `meta` — and it is passed through untouched.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(NO_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip || context.getType() !== 'http') {
      return next.handle();
    }

    return next.handle().pipe(
      map((payload: unknown) => {
        // `undefined` (e.g. a 204-style handler) still returns a valid envelope.
        if (isEnvelope(payload)) {
          return payload;
        }
        return { data: payload ?? null } satisfies ApiSuccess<unknown>;
      }),
    );
  }
}

function isEnvelope(payload: unknown): payload is ApiSuccess<unknown> {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'data' in payload &&
    Object.keys(payload as object).every((key) => key === 'data' || key === 'meta')
  );
}
