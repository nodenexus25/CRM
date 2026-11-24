import type { ResumeParserChoice } from '@talentflow/types';

import type { MailTemplate } from '../mail/mailer.service';

/** All BullMQ queue names. Phase 2+ adds resume parsing, CSV import and bulk jobs. */
export const QUEUE_NAMES = {
  email: 'email',
  emailOutbound: 'email-outbound',
  resumeParse: 'resume-parse',
  import: 'import',
  bulk: 'bulk',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface EmailJob {
  to: string | string[];
  subject: string;
  template: MailTemplate;
  context?: Record<string, unknown>;
  replyTo?: string;
  /** Recorded on the job for traceability. */
  tenantId?: string;
  requestedBy?: string;
}

/**
 * Enqueued when a tenant composes an email. Only the id travels on the queue —
 * the subject, body and recipients already live on the `EmailMessage` row, so a
 * retry cannot drift from what the user saw.
 */
export interface EmailOutboundJob {
  tenantId: string;
  messageId: string;
  /** The operator who hit send; `null` for system-initiated sends. */
  userId: string | null;
}

/** Enqueued when a resume upload completes so the worker can extract and parse. */
export interface ResumeParseJob {
  tenantId: string;
  resumeId: string;
  /** Null while the upload is detached and awaiting review. */
  candidateId: string | null;
  storageKey: string;
  /** Parser requested for this run: `auto` reads the LLM config. */
  parser: ResumeParserChoice;
}

/** Enqueued when a CSV/Excel import is started so the worker can apply it. */
export interface ImportJobPayload {
  tenantId: string;
  importJobId: string;
  entity: string;
  storageKey: string;
  /** The operator who started the run; `null` for system-initiated runs. */
  userId: string | null;
}

/** Enqueued when a `BulkOperation` is created so the worker can apply it. */
export interface BulkOperationJob {
  tenantId: string;
  bulkOperationId: string;
  /** The operator who requested the run; `null` for system-initiated runs. */
  userId: string | null;
}
