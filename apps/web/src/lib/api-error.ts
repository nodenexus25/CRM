import { ERROR_CODES, type ApiErrorBody, type ErrorCode, type NextAction } from '@talentflow/types';

/** One field-level issue as returned by the API's Zod validation pipe. */
export interface FieldIssue {
  path: string;
  message: string;
  code?: string;
}

function extractIssues(details: unknown): FieldIssue[] {
  if (!Array.isArray(details)) return [];
  return details.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return [];
    const candidate = entry as { path?: unknown; message?: unknown; code?: unknown };
    if (typeof candidate.path !== 'string' || typeof candidate.message !== 'string') return [];
    return [
      {
        path: candidate.path,
        message: candidate.message,
        code: typeof candidate.code === 'string' ? candidate.code : undefined,
      },
    ];
  });
}

/**
 * Every failure from the API arrives in the `ApiErrorBody` envelope, so callers
 * branch on `code` instead of parsing messages.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | string;
  readonly details: unknown;
  readonly nextAction: NextAction | undefined;
  readonly requestId: string | undefined;
  /** Present only for `VALIDATION_FAILED` responses. */
  readonly issues: FieldIssue[];

  constructor(body: Partial<ApiErrorBody> = {}, fallbackStatus = 500) {
    super(body.message ?? 'Something went wrong. Please try again.');
    this.name = 'ApiError';
    this.status = body.statusCode ?? fallbackStatus;
    this.code = body.code ?? ERROR_CODES.INTERNAL_ERROR;
    this.details = body.details;
    this.nextAction = body.nextAction;
    this.requestId = body.requestId;
    this.issues = extractIssues(body.details);
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  get isValidation(): boolean {
    return this.code === ERROR_CODES.VALIDATION_FAILED || this.status === 422;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get needsEmailVerification(): boolean {
    return this.code === ERROR_CODES.EMAIL_NOT_VERIFIED;
  }

  /** `"tenant:update"`-style field lookup for form error surfaces. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.issues.map((issue) => [issue.path, issue.message]));
  }

  /** Wraps anything thrown by `fetch` so callers always get an `ApiError`. */
  static from(error: unknown): ApiError {
    if (error instanceof ApiError) return error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      return new ApiError({ message: 'The request was cancelled.' }, 499);
    }
    if (error instanceof TypeError) {
      return new ApiError(
        {
          code: ERROR_CODES.SERVICE_UNAVAILABLE,
          message: 'Cannot reach the TalentFlow API. Is it running?',
        },
        503,
      );
    }
    return new ApiError(
      { message: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
}
