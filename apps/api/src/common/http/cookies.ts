import type { CookieOptions, Request, Response } from 'express';

/** Populated by `cookie-parser`, registered in `main.ts`. */
type RequestWithCookies = Request & { cookies?: Record<string, string> };

export function readCookie(request: Request, name: string): string | undefined {
  return (request as RequestWithCookies).cookies?.[name];
}

export interface CookieConfig {
  domain: string;
  secure: boolean;
}

/**
 * Base options shared by every auth cookie.
 *
 * `sameSite: 'lax'` is deliberate: the app is a first-party SPA talking to a
 * sibling origin, and `lax` still blocks cross-site POSTs — the attack CSRF
 * tokens exist to stop.
 */
export function baseCookieOptions(config: CookieConfig, path = '/'): CookieOptions {
  const options: CookieOptions = {
    httpOnly: true,
    secure: config.secure,
    sameSite: 'lax',
    path,
  };

  // A `Domain=` attribute on `localhost` is rejected by some browsers, and is
  // unnecessary when the cookie is only read by the host that set it.
  if (config.domain && config.domain !== 'localhost') {
    options.domain = config.domain;
  }

  return options;
}

export function setCookie(
  response: Response,
  name: string,
  value: string,
  options: CookieOptions,
): void {
  response.cookie(name, value, options);
}

export function clearCookie(response: Response, name: string, options: CookieOptions): void {
  // `maxAge`/`expires` are stripped so the browser drops the value immediately
  // while keeping the path and domain attributes identical to the set call.
  const { maxAge: _maxAge, expires: _expires, ...rest } = options;
  response.clearCookie(name, rest);
}
