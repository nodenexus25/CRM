import { HttpStatus } from '@nestjs/common';

import { ERROR_CODES, type ErrorCode, type NextAction } from '@talentflow/types';

/**
 * Base class for every error the API raises deliberately.
 *
 * `AllExceptionsFilter` converts these into the stable error envelope defined
 * in `packages/types`, so clients only ever branch on `code`.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  /** Machine-readable hint telling the client what to do next. */
  readonly nextAction?: NextAction;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: ErrorCode;
      details?: unknown;
      nextAction?: NextAction;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.status = options.status ?? HttpStatus.BAD_REQUEST;
    this.code = options.code ?? ERROR_CODES.INTERNAL_ERROR;
    this.details = options.details;
    this.nextAction = options.nextAction;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The submitted data is invalid', details?: unknown) {
    super(message, { status: HttpStatus.UNPROCESSABLE_ENTITY, code: ERROR_CODES.VALIDATION_FAILED, details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'You need to sign in to continue', nextAction?: NextAction) {
    super(message, { status: HttpStatus.UNAUTHORIZED, code: ERROR_CODES.UNAUTHENTICATED, nextAction });
  }
}

export class InvalidCredentialsError extends AppError {
  constructor(message = 'Incorrect email or password') {
    super(message, { status: HttpStatus.UNAUTHORIZED, code: ERROR_CODES.INVALID_CREDENTIALS });
  }
}

export class EmailNotVerifiedError extends AppError {
  constructor(message = 'Verify your email address to continue') {
    super(message, {
      status: HttpStatus.FORBIDDEN,
      code: ERROR_CODES.EMAIL_NOT_VERIFIED,
      nextAction: 'VERIFY_EMAIL',
    });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that', details?: unknown) {
    super(message, { status: HttpStatus.FORBIDDEN, code: ERROR_CODES.FORBIDDEN, details });
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', id?: string) {
    super(id ? `${resource} ${id} was not found` : `${resource} was not found`, {
      status: HttpStatus.NOT_FOUND,
      code: ERROR_CODES.NOT_FOUND,
    });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'That record already exists', details?: unknown) {
    super(message, { status: HttpStatus.CONFLICT, code: ERROR_CODES.CONFLICT, details });
  }
}

export class TenantRequiredError extends AppError {
  constructor(message = 'This request must be scoped to a workspace') {
    super(message, { status: HttpStatus.BAD_REQUEST, code: ERROR_CODES.TENANT_REQUIRED });
  }
}

export class TenantSuspendedError extends AppError {
  constructor(message = 'This workspace is suspended. Contact billing to restore access.') {
    super(message, {
      status: HttpStatus.PAYMENT_REQUIRED,
      code: ERROR_CODES.TENANT_SUSPENDED,
      nextAction: 'CONTACT_SUPPORT',
    });
  }
}

/**
 * Raised by the Prisma tenancy extension when a tenant-scoped query runs with
 * no tenant in context. This is a programming error, never a user error — it is
 * surfaced as a 500 to make it loud in logs and monitoring.
 */
export class TenantIsolationError extends AppError {
  constructor(model: string, operation: string) {
    super(
      `Blocked a ${operation} on ${model} because the request has no tenant context.`,
      {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ERROR_CODES.TENANT_ISOLATION_VIOLATION,
        details: { model, operation },
      },
    );
  }
}

export class TokenInvalidError extends AppError {
  constructor(message = 'This link is invalid or has already been used') {
    super(message, { status: HttpStatus.BAD_REQUEST, code: ERROR_CODES.TOKEN_INVALID });
  }
}

export class TokenExpiredError extends AppError {
  constructor(message = 'This link has expired. Request a new one.') {
    super(message, { status: HttpStatus.GONE, code: ERROR_CODES.TOKEN_EXPIRED });
  }
}

/** Replaying a rotated refresh token revokes the whole token family. */
export class TokenReuseError extends AppError {
  constructor(message = 'This session was revoked for security reasons. Sign in again.') {
    super(message, { status: HttpStatus.UNAUTHORIZED, code: ERROR_CODES.TOKEN_REUSED });
  }
}

/** A downstream dependency (storage, mail, queue) is not reachable. */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'This service is temporarily unavailable. Please try again.', cause?: unknown) {
    super(message, {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      cause,
    });
  }
}

/** Quota exhaustion — surfaced with an actionable upgrade hint. */
export class PlanLimitError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, {
      status: HttpStatus.PAYMENT_REQUIRED,
      code: ERROR_CODES.FORBIDDEN,
      details,
      nextAction: 'UPGRADE_PLAN',
    });
  }
}
