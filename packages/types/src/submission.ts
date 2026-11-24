import { z } from 'zod';

import { idSchema, paginationQuerySchema } from './common';
import { applicationStatusSchema, submissionStatusSchema } from './enums';

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * The client-facing states a submission can be moved between once it has left
 * the workspace. `DRAFT` is excluded: reaching it is the submit action, not a
 * transition, and `SUBMITTED` is excluded because it is where submitting lands.
 */
export const submissionTransitionStatusSchema = z.enum([
  'CLIENT_VIEWED',
  'SHORTLISTED',
  'INTERVIEWING',
  'OFFERED',
  'REJECTED',
  'WITHDRAWN',
]);
export type SubmissionTransitionStatus = z.infer<typeof submissionTransitionStatusSchema>;

/** Submitting a candidate to the client, optionally with a tailored résumé. */
export const submitApplicationSchema = z.object({
  /**
   * Strips the candidate's contact details from the résumé that goes out, so
   * the client cannot bypass the agency. Recorded for the audit trail.
   */
  hideContact: z.coerce.boolean().default(false),
  /** A tailored résumé snapshot; defaults to the candidate's primary résumé. */
  resumeId: idSchema.nullable().optional(),
  /** The client contact the submission is addressed to. */
  contactId: idSchema.nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type SubmitApplicationRequest = z.infer<typeof submitApplicationSchema>;

export const updateSubmissionSchema = z.object({
  status: submissionTransitionStatusSchema,
  note: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateSubmissionRequest = z.infer<typeof updateSubmissionSchema>;

export const submissionFeedbackSchema = z.object({
  feedback: z.string().trim().min(1, 'Add the client’s feedback').max(4000),
  /** When the client gave the feedback; defaults to now. */
  feedbackAt: z.coerce.date().nullable().optional(),
});
export type SubmissionFeedbackRequest = z.infer<typeof submissionFeedbackSchema>;

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const submissionQuerySchema = paginationQuerySchema.extend({
  /** Submission state — the client-facing lifecycle, not the pipeline stage. */
  status: z.union([submissionStatusSchema, z.array(submissionStatusSchema)]).optional(),
  /** Internal application state (`ACTIVE`, `REJECTED`, …). */
  applicationStatus: z
    .union([applicationStatusSchema, z.array(applicationStatusSchema)])
    .optional(),
  clientId: idSchema.optional(),
  jobId: idSchema.optional(),
  /** The recruiting user who owns the application. */
  recruiterId: idSchema.optional(),
  /** Inclusive lower bound on `submittedAt`. */
  from: z.coerce.date().optional(),
  /** Inclusive upper bound on `submittedAt`. */
  to: z.coerce.date().optional(),
  sortBy: z.enum(['submittedAt', 'updatedAt', 'appliedAt']).default('submittedAt'),
});
export type SubmissionQuery = z.infer<typeof submissionQuerySchema>;

export interface SubmissionUserRef {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface SubmissionListItem {
  id: string;
  submissionStatus: z.infer<typeof submissionStatusSchema>;
  applicationStatus: z.infer<typeof applicationStatusSchema>;
  job: { id: string; title: string; referenceCode: string };
  client: { id: string; name: string } | null;
  candidate: { id: string; fullName: string; avatarUrl: string | null };
  stage: { id: string; name: string; color: string };
  owner: { id: string; fullName: string } | null;
  submittedAt: string | null;
  submittedBy: SubmissionUserRef | null;
  /** Whole days since the submission went out; powers the list's age column. */
  ageDays: number;
  hasFeedback: boolean;
}

/** One entry on the submission's timeline. */
export interface SubmissionEventItem {
  id: string;
  kind: 'SUBMITTED' | 'STATUS' | 'FEEDBACK';
  subject: string;
  body: string | null;
  author: SubmissionUserRef | null;
  createdAt: string;
}

export interface SubmissionContactRef {
  id: string;
  fullName: string;
  email: string | null;
  title: string | null;
}

export interface SubmissionDetail {
  /** The application id — a submission has no identity of its own. */
  id: string;
  submissionStatus: z.infer<typeof submissionStatusSchema>;
  applicationStatus: z.infer<typeof applicationStatusSchema>;
  job: { id: string; title: string; referenceCode: string };
  client: { id: string; name: string } | null;
  candidate: { id: string; fullName: string; avatarUrl: string | null; email: string | null };
  stage: { id: string; name: string; color: string };
  owner: { id: string; fullName: string } | null;
  submittedAt: string | null;
  submittedBy: SubmissionUserRef | null;
  ageDays: number;
  /** The contact the submission was last addressed to. */
  contact: SubmissionContactRef | null;
  /** The tailored résumé snapshot that was sent, when one was chosen. */
  resume: { id: string; fileName: string } | null;
  /** The most recent feedback, mirrored from the application row. */
  clientFeedback: string | null;
  clientFeedbackAt: string | null;
  events: SubmissionEventItem[];
}
