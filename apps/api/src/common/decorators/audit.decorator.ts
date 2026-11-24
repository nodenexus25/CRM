import { SetMetadata } from '@nestjs/common';

import type { AuditAction } from '@talentflow/types';

export const AUDIT_KEY = 'audit:metadata';

export interface AuditMetadata {
  action: AuditAction;
  /** Domain entity name written to `AuditLog.entity`, e.g. `Job`. */
  entity: string;
  /** Optional human-readable description appended to the log entry. */
  description?: string;
  /**
   * Reads the record id from the route params. Defaults to `id`.
   */
  idParam?: string;
}

/**
 * Marks a route as security-relevant so `AuditInterceptor` writes an entry to
 * `AuditLog` after it succeeds. Applied to writes and sensitive reads only.
 */
export const Audit = (metadata: AuditMetadata) => SetMetadata(AUDIT_KEY, metadata);
