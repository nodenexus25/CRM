import type { SessionRole } from '@talentflow/types';

/** Decoded access token. Kept deliberately small — no PII beyond identifiers. */
export interface AccessTokenPayload {
  /** User id. */
  sub: string;
  /** Tenant id the session was issued for. */
  tid: string;
  /** Refresh-token family id, used to revoke a whole session. */
  sid: string;
  /** True when the user holds the platform `SUPER_ADMIN` role. */
  sad?: boolean;
  /** True when a super admin is acting inside a tenant they do not belong to. */
  imp?: boolean;
  iat?: number;
  exp?: number;
}

/** Decoded refresh token. */
export interface RefreshTokenPayload {
  sub: string;
  tid: string;
  /** Rotation family — every rotation keeps the same id. */
  fid: string;
  /** Id of this specific refresh token row. */
  jti: string;
  iat?: number;
  exp?: number;
}

/**
 * The authenticated principal attached to a request by `JwtAuthGuard` and
 * mirrored into the ambient request context.
 */
export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  sessionId: string;
  email: string;
  firstName: string;
  lastName: string;
  isSuperAdmin: boolean;
  isImpersonating: boolean;
  roles: SessionRole[];
  permissions: readonly string[];
}
