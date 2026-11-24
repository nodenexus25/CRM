import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** cuid / uuid / any opaque identifier coming from the client. */
export const idSchema = z.string().trim().min(1).max(64);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(48)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'Use lowercase letters, numbers and single hyphens (no leading/trailing hyphen)',
  );

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a hex colour such as #4F46E5');

export const timezoneSchema = z.string().trim().min(1).max(64);

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(3, 'Use a 3-letter ISO 4217 code such as USD or INR');

export const dateFormatSchema = z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'DD MMM YYYY']);
export type DateFormat = z.infer<typeof dateFormatSchema>;

export const phoneSchema = z
  .string()
  .trim()
  .min(6, 'Enter a valid phone number')
  .max(32)
  .regex(/^[+()\d\s.-]+$/, 'Phone numbers may only contain digits, spaces and + ( ) . -');

export const urlSchema = z.string().trim().url('Enter a valid URL').max(2048);

/**
 * Password policy: 10+ characters with at least one lower-case letter, one
 * upper-case letter and one digit. Enforced identically on signup, invite
 * acceptance and password reset so the rules can never diverge.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')
  .regex(/[a-z]/, 'Include at least one lower-case letter')
  .regex(/[A-Z]/, 'Include at least one upper-case letter')
  .regex(/\d/, 'Include at least one number');

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

export const nameSchema = z.string().trim().min(1).max(80);

/**
 * Money is carried in minor units (cents, paise, …) from the database to the
 * form and back, so no rounding is ever introduced by a float. One billion
 * minor units is comfortably above any salary this product will hold.
 */
export const moneyCentsSchema = z.coerce.number().int().min(0).max(1_000_000_000);
/** A percentage stored with two decimals of precision, e.g. `18.5`. */
export const percentageSchema = z.coerce.number().min(0).max(100);

// ---------------------------------------------------------------------------
// Pagination, sorting, filtering
// ---------------------------------------------------------------------------

export const sortDirSchema = z.enum(['asc', 'desc']);
export type SortDir = z.infer<typeof sortDirSchema>;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.string().trim().max(64).optional(),
  sortDir: sortDirSchema.default('desc'),
  /** Free-text search term. */
  q: z.string().trim().max(200).optional(),
  /** Include soft-deleted rows (requires `restore` capability on the resource). */
  includeDeleted: z.coerce.boolean().default(false),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Accepts either a real array (JSON body) or a comma-separated query string
 * (`?skillIds=a,b,c`) and normalises both to a de-duplicated id array.
 */
export const csvIdsSchema = z
  .union([z.array(idSchema), z.string()])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split(','))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .pipe(z.array(idSchema).max(200));

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

export function buildPaginationMeta(total: number, page: number, pageSize: number): PaginationMeta {
  const pageCount = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  return {
    page,
    pageSize,
    total,
    pageCount,
    hasNext: page < pageCount,
    hasPrevious: page > 1,
  };
}

/** Builds a Prisma `skip`/`take` pair from a pagination query. */
export function toSkipTake(query: Pick<PaginationQuery, 'page' | 'pageSize'>): {
  skip: number;
  take: number;
} {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

// ---------------------------------------------------------------------------
// API envelopes
// ---------------------------------------------------------------------------

export interface ApiSuccess<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorBody {
  statusCode: number;
  /** Stable, machine-readable error code, e.g. `TENANT_REQUIRED`. */
  code: string;
  message: string;
  details?: unknown;
  /** Machine-readable hint describing what the caller should do next. */
  nextAction?: NextAction;
  requestId?: string;
  timestamp: string;
  path?: string;
}

export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  TENANT_REQUIRED: 'TENANT_REQUIRED',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  TENANT_ISOLATION_VIOLATION: 'TENANT_ISOLATION_VIOLATION',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_REUSED: 'TOKEN_REUSED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Machine-readable key returned by the API for the action the caller should take. */
export const NEXT_ACTIONS = {
  VERIFY_EMAIL: 'VERIFY_EMAIL',
  RESET_PASSWORD: 'RESET_PASSWORD',
  ACCEPT_INVITE: 'ACCEPT_INVITE',
  UPGRADE_PLAN: 'UPGRADE_PLAN',
  CONTACT_SUPPORT: 'CONTACT_SUPPORT',
} as const;
export type NextAction = (typeof NEXT_ACTIONS)[keyof typeof NEXT_ACTIONS];

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  uptime: number;
  version: string;
  timestamp: string;
  dependencies?: Record<string, { status: 'up' | 'down'; latencyMs?: number; error?: string }>;
}
