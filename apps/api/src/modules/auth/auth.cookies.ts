import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

import type { AuthTokens } from '@talentflow/types';

import { baseCookieOptions, clearCookie, setCookie } from '@/common/http/cookies';
import type { AppConfig } from '@/config/configuration';

/**
 * Owns the three auth cookies.
 *
 * - `tf_at` / `tf_rt` are httpOnly: no script can read the credentials.
 * - `tf_csrf` is deliberately readable, because the double-submit pattern
 *   requires the client to echo it in a header — which a cross-origin attacker
 *   cannot do.
 *
 * All three share path and domain attributes so a logout clears them together.
 */
@Injectable()
export class AuthCookieService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  /** Sets a fresh cookie set from an issued token pair. */
  issue(response: Response, tokens: AuthTokens): void {
    const cookie = this.config.get('cookie', { infer: true });
    const base = baseCookieOptions(cookie);
    const now = Date.now();

    setCookie(response, cookie.accessName, tokens.accessToken, {
      ...base,
      maxAge: Math.max(0, Date.parse(tokens.accessTokenExpiresAt) - now),
    });

    setCookie(response, cookie.refreshName, tokens.refreshToken, {
      ...base,
      maxAge: Math.max(0, Date.parse(tokens.refreshTokenExpiresAt) - now),
    });

    this.rotateCsrfToken(response);
  }

  /** Issues a new CSRF token without touching the credentials. */
  rotateCsrfToken(response: Response): string {
    const cookie = this.config.get('cookie', { infer: true });
    const token = randomBytes(32).toString('base64url');

    setCookie(response, cookie.csrfName, token, {
      ...baseCookieOptions(cookie, '/'),
      httpOnly: false,
      maxAge: parseMs(this.config.get('jwt', { infer: true }).refreshTtl),
    });

    return token;
  }

  clear(response: Response): void {
    const cookie = this.config.get('cookie', { infer: true });
    const base = baseCookieOptions(cookie);

    clearCookie(response, cookie.accessName, base);
    clearCookie(response, cookie.refreshName, base);
    clearCookie(response, cookie.csrfName, base);
  }
}

/** `"30d"` → milliseconds. Falls back to 30 days. */
function parseMs(value: string): number {
  const match = /^(\d+)\s*([smhdw])$/.exec(value.trim());
  if (!match) return 30 * 24 * 60 * 60 * 1000;

  const amount = Number(match[1]);
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[
    match[2] ?? 'd'
  ];

  return amount * (unit ?? 86_400_000);
}
