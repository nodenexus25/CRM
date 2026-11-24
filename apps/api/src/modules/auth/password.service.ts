import { hash, verify, type Algorithm } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { PasswordStrength } from '@talentflow/types';

import type { AppConfig } from '@/config/configuration';

/**
 * `@node-rs/argon2` ships `Algorithm` as an ambient const enum, which
 * `isolatedModules` forbids referencing at runtime. Argon2id is the third
 * member of that enum, value 2.
 */
const ARGON2ID = 2 as Algorithm;

/**
 * Password hashing with argon2id.
 *
 * Cost parameters come from the environment so a deployment can raise them
 * without a code change; the defaults (19 MiB, 2 iterations, 1 lane) follow the
 * OWASP recommendation for interactive logins.
 */
@Injectable()
export class PasswordService {
  private readonly options: {
    algorithm: Algorithm;
    memoryCost: number;
    timeCost: number;
    parallelism: number;
  };

  constructor(config: ConfigService<AppConfig, true>) {
    const argon2 = config.get('argon2', { infer: true });
    this.options = {
      algorithm: ARGON2ID,
      memoryCost: argon2.memoryCost,
      timeCost: argon2.timeCost,
      parallelism: argon2.parallelism,
    };
  }

  hash(plain: string): Promise<string> {
    return hash(plain, this.options);
  }

  async verify(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain, this.options);
    } catch {
      // A malformed hash must never authenticate anybody.
      return false;
    }
  }

  /**
   * Strength meter shared with the signup form. Kept server-side so the score
   * the user sees is the score the API enforced.
   */
  measureStrength(password: string): PasswordStrength {
    const checks = {
      minLength: password.length >= 10,
      lower: /[a-z]/.test(password),
      upper: /[A-Z]/.test(password),
      digit: /\d/.test(password),
      symbol: /[^A-Za-z0-9]/.test(password),
    };

    let score = 0;
    if (password.length >= 8) score += 1;
    if (checks.minLength && checks.lower && checks.upper && checks.digit) score += 1;
    if (password.length >= 14) score += 1;
    if (checks.symbol) score += 1;
    if (password.length >= 20) score += 1;

    const clamped = Math.min(score, 4) as PasswordStrength['score'];
    const labels: Record<PasswordStrength['score'], PasswordStrength['label']> = {
      0: 'Very weak',
      1: 'Weak',
      2: 'Fair',
      3: 'Strong',
      4: 'Very strong',
    };

    return { score: clamped, label: labels[clamped], checks };
  }
}
