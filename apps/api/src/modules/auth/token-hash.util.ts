import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque, single-use tokens (email verification, password reset, invites) are
 * stored as a SHA-256 digest. A leaked database row therefore cannot be turned
 * back into a working link.
 */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
