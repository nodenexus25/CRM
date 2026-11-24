import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';

import { UnauthorizedError } from '@/common/errors/domain-errors';
import type { AccessTokenPayload, RefreshTokenPayload } from '@/common/auth/principal';
import type { AppConfig } from '@/config/configuration';

type ExpiresIn = NonNullable<JwtSignOptions['expiresIn']>;

export interface IssuedToken<T> {
  token: string;
  payload: T;
  expiresAt: Date;
}

/**
 * Signs and verifies the two JWT families.
 *
 * Access tokens are short-lived and carry the tenant, so a request can be
 * scoped before it touches the database. Refresh tokens are long-lived, stored
 * hashed, and rotated on every use.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private get accessSecret(): string {
    return this.config.get('jwt', { infer: true }).accessSecret;
  }

  private get refreshSecret(): string {
    return this.config.get('jwt', { infer: true }).refreshSecret;
  }

  private get accessTtl(): ExpiresIn {
    return this.config.get('jwt', { infer: true }).accessTtl as ExpiresIn;
  }

  private get refreshTtl(): ExpiresIn {
    return this.config.get('jwt', { infer: true }).refreshTtl as ExpiresIn;
  }

  async issueAccessToken(
    payload: Omit<AccessTokenPayload, 'iat' | 'exp'>,
  ): Promise<IssuedToken<AccessTokenPayload>> {
    const token = await this.jwt.signAsync(payload, {
      secret: this.accessSecret,
      expiresIn: this.accessTtl,
    });
    return { token, payload, expiresAt: this.expiryOf(token) };
  }

  async issueRefreshToken(
    payload: Omit<RefreshTokenPayload, 'iat' | 'exp'>,
  ): Promise<IssuedToken<RefreshTokenPayload>> {
    const token = await this.jwt.signAsync(payload, {
      secret: this.refreshSecret,
      expiresIn: this.refreshTtl,
    });
    return { token, payload, expiresAt: this.expiryOf(token) };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token, { secret: this.accessSecret });
    } catch {
      throw new UnauthorizedError('Your session has expired. Sign in again.');
    }
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      return await this.jwt.verifyAsync<RefreshTokenPayload>(token, { secret: this.refreshSecret });
    } catch {
      throw new UnauthorizedError('Your session has expired. Sign in again.');
    }
  }

  /** Reads the `exp` claim without verifying — used to persist token expiry. */
  expiryOf(token: string): Date {
    const decoded = this.jwt.decode(token) as { exp?: number } | null;
    if (!decoded?.exp) {
      return new Date(Date.now() + 1000 * 60 * 15);
    }
    return new Date(decoded.exp * 1000);
  }

  refreshTtlSeconds(): number {
    const raw = this.config.get('jwt', { infer: true }).refreshTtl;
    return parseDurationToSeconds(raw, 60 * 60 * 24 * 30);
  }
}

const DURATION_UNITS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 60 * 60 * 24,
  w: 60 * 60 * 24 * 7,
};

/** Parses durations such as `15m`, `30d`, `900s`. */
export function parseDurationToSeconds(value: string, fallback: number): number {
  const match = /^(\d+)\s*([smhdw])$/.exec(value.trim());
  if (!match) return fallback;
  const amount = Number(match[1]);
  const unit = DURATION_UNITS[match[2] ?? 's'] ?? 1;
  return amount * unit;
}
