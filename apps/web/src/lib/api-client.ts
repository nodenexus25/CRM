'use client';

import type { ApiErrorBody, ApiSuccess } from '@talentflow/types';

import { ApiError } from './api-error';
import { apiBaseUrl } from './env';

/** JavaScript-readable cookie the API rotates on every token issue/refresh. */
const CSRF_COOKIE_NAME = 'tf_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | readonly (string | number)[];

export interface ApiRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  /** Serialised onto the query string; empty values are dropped. */
  query?: Record<string, QueryValue>;
  headers?: HeadersInit;
  signal?: AbortSignal;
  /** Suppresses the silent refresh-and-retry used on 401 (refresh calls itself). */
  skipAuthRetry?: boolean;
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    // Dates go out as ISO-8601; `String(date)` would emit a locale-dependent,
    // space-laden form that the API's `z.coerce.date()` still parses but that
    // no cache key or log line wants to read.
    if (value instanceof Date) {
      url.searchParams.set(key, value.toISOString());
      continue;
    }
    // Arrays are emitted as repeated keys (`?status=A&status=B`) so the API's
    // Zod array branches receive a real array rather than a comma-joined string.
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry === undefined || entry === null || entry === '') continue;
        url.searchParams.append(key, String(entry));
      }
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    const text = await response.text().catch(() => '');
    return text || undefined;
  }
  return response.json().catch(() => undefined);
}

/** Unwraps the `ApiSuccess` envelope; a bare payload is passed through. */
function unwrap<T>(payload: unknown): T {
  if (payload !== null && typeof payload === 'object' && 'data' in payload) {
    const envelope = payload as ApiSuccess<unknown>;
    const keys = Object.keys(envelope);
    if (keys.every((key) => key === 'data' || key === 'meta')) {
      return envelope.data as T;
    }
  }
  return payload as T;
}

function toApiError(payload: unknown, status: number): ApiError {
  const body = (payload !== null && typeof payload === 'object' ? payload : {}) as ApiErrorBody;
  return new ApiError(
    {
      ...body,
      statusCode: body.statusCode ?? status,
      message:
        body.message ??
        (typeof payload === 'string' && payload.trim().length > 0
          ? `Request failed with status ${status}`
          : `Request failed with status ${status}`),
    },
    status,
  );
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Single-flight refresh. The API revokes the presented refresh token as soon as
 * it is used, so concurrent 401s must share one rotation rather than race.
 */
function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Calls the API and returns the unwrapped payload.
 *
 * - credentials are always included (the session lives in httpOnly cookies)
 * - unsafe methods echo the double-submit CSRF token
 * - an expired access token triggers one silent refresh, then one retry
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, headers: extraHeaders, skipAuthRetry, signal } = options;

  const headers = new Headers(extraHeaders);
  headers.set('accept', 'application/json');
  if (body !== undefined) headers.set('content-type', 'application/json');

  const csrf = readCookie(CSRF_COOKIE_NAME);
  if (UNSAFE_METHODS.has(method) && csrf) headers.set(CSRF_HEADER_NAME, csrf);

  const response = await fetch(buildUrl(path, query), {
    method,
    headers,
    credentials: 'include',
    cache: 'no-store',
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const isAuthEndpoint = path.startsWith('/auth/');
  if (response.status === 401 && !skipAuthRetry && path !== '/auth/refresh') {
    if (await refreshSession()) {
      return apiRequest<T>(path, { ...options, skipAuthRetry: true });
    }
    // Only surface a session expiry for authenticated screens; a failed login
    // attempt must keep the API's own `INVALID_CREDENTIALS` message.
    if (!isAuthEndpoint) {
      throw toApiError(await parseBody(response), response.status);
    }
  }

  const payload = await parseBody(response);
  if (!response.ok) throw toApiError(payload, response.status);

  return unwrap<T>(payload);
}

type ReadOptions = Omit<ApiRequestOptions, 'method' | 'body'>;

/** Thin verb helpers so callers never spell out a method twice. */
export const api = {
  get: <T>(path: string, options?: ReadOptions) => apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: ReadOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: ReadOptions) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: ReadOptions) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: ReadOptions) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
