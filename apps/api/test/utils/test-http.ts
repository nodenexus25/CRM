import type { Server } from 'node:http';

import supertest from 'supertest';

import { COOKIE_NAMES, CSRF_HEADER } from '@/config/configuration';

import { apiPath } from './test-app';

export interface HttpResponse {
  status: number;
  body: any;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}

interface RequestBuilder {
  set(field: Record<string, string>): RequestBuilder;
  send(body: unknown): RequestBuilder;
}

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Methods that carry a JSON body in the browser client. */
const UNSAFE_METHODS = new Set<HttpMethod>(['post', 'put', 'patch']);

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  /**
   * Echo the CSRF cookie in the configured header. On by default so ordinary
   * calls succeed; the CSRF suite turns it off to prove the guard rejects them.
   */
  csrf?: boolean;
}

/**
 * A cookie-aware HTTP client for the in-process Nest app.
 *
 * supertest does not persist cookies between requests, but this codebase
 * authenticates with httpOnly cookies and a double-submit CSRF token — so the
 * suite has to behave like a browser. This keeps a cookie jar, replays it, and
 * mirrors the CSRF cookie into the request header exactly as the web client
 * does. Nothing is stubbed: the guards under test see a normal request.
 */
export class TestHttpClient {
  private readonly cookies = new Map<string, string>();

  constructor(
    private readonly server: Server,
    private readonly prefix: string,
  ) {}

  /** Value of the readable CSRF cookie, or `undefined` before the first auth. */
  get csrfToken(): string | undefined {
    return this.cookies.get(COOKIE_NAMES.csrf);
  }

  get accessToken(): string | undefined {
    return this.cookies.get(COOKIE_NAMES.access);
  }

  get refreshToken(): string | undefined {
    return this.cookies.get(COOKIE_NAMES.refresh);
  }

  /** Overwrites a cookie — used by tests that forge a stale CSRF token. */
  setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  clearCookies(): void {
    this.cookies.clear();
  }

  get(path: string, options: RequestOptions = {}): Promise<HttpResponse> {
    return this.send('get', path, options);
  }

  post(path: string, options: RequestOptions = {}): Promise<HttpResponse> {
    return this.send('post', path, options);
  }

  put(path: string, options: RequestOptions = {}): Promise<HttpResponse> {
    return this.send('put', path, options);
  }

  patch(path: string, options: RequestOptions = {}): Promise<HttpResponse> {
    return this.send('patch', path, options);
  }

  delete(path: string, options: RequestOptions = {}): Promise<HttpResponse> {
    return this.send('delete', path, options);
  }

  /** Signs in and keeps the resulting cookies. Returns the session body. */
  async login(email: string, password: string): Promise<HttpResponse> {
    const response = await this.post('/auth/login', { body: { email, password } });
    return response;
  }

  private async send(
    method: HttpMethod,
    path: string,
    options: RequestOptions,
  ): Promise<HttpResponse> {
    const headers: Record<string, string> = { ...options.headers };

    const cookieHeader = this.cookieHeader();
    if (cookieHeader) headers.cookie = cookieHeader;

    if (options.csrf !== false && this.csrfToken) {
      headers[CSRF_HEADER] = this.csrfToken;
    }

    const invoke = supertest(this.server)[method] as unknown as (
      url: string,
    ) => RequestBuilder;

    let builder = invoke(apiPath(this.prefix, path));
    if (Object.keys(headers).length > 0) builder = builder.set(headers);
    // The web client always posts a JSON object on unsafe methods, even when
    // there is nothing to say (`refreshSession` sends `{}`), so mirror that
    // rather than sending a body-less request no browser would make.
    const payload = options.body ?? (UNSAFE_METHODS.has(method) ? {} : undefined);
    if (payload !== undefined) builder = builder.send(payload);

    const response = await (builder as unknown as Promise<HttpResponse>);
    this.captureCookies(response);
    return response;
  }

  private captureCookies(response: HttpResponse): void {
    const raw = response.headers['set-cookie'];
    if (!raw) return;

    const list = Array.isArray(raw) ? raw : [raw];
    for (const cookie of list) {
      const separator = cookie.indexOf('=');
      if (separator === -1) continue;

      const name = cookie.slice(0, separator).trim();
      const value = cookie.slice(separator + 1, cookie.indexOf(';') === -1 ? undefined : cookie.indexOf(';'));

      // `clearCookie` sends an empty value with a past expiry — mirror that as
      // a removal so a logged-out client cannot keep replaying a dead session.
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}
