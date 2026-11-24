import { z } from 'zod';

import { idSchema, paginationQuerySchema, sortDirSchema, timezoneSchema, urlSchema } from './common';
import { interviewStatusSchema, interviewTypeSchema } from './enums';

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Scheduling an interview. `scheduledEnd` is optional: when it is supplied the
 * duration is derived from it, otherwise `scheduledStart` is extended by
 * `durationMinutes`. Accepting both keeps the two columns consistent instead of
 * letting a caller store an end that contradicts the duration.
 */
export const createInterviewSchema = z.object({
  applicationId: idSchema,
  type: interviewTypeSchema.default('VIDEO'),
  round: z.coerce.number().int().min(1).max(20).default(1),
  title: z.string().trim().max(200).nullable().optional(),
  scheduledStart: z.coerce.date(),
  scheduledEnd: z.coerce.date().nullable().optional(),
  durationMinutes: z.coerce.number().int().min(5).max(600).default(60),
  timezone: timezoneSchema.default('UTC'),
  location: z.string().trim().max(300).nullable().optional(),
  meetingUrl: urlSchema.nullable().optional(),
  /** Workspace users sitting on the panel. The first one is marked as lead. */
  interviewerIds: z.array(idSchema).max(25).default([]),
  /** A client-side name, for interviewers who have no account here. */
  externalInterviewer: z.string().trim().max(200).nullable().optional(),
});
export type CreateInterviewRequest = z.infer<typeof createInterviewSchema>;

/**
 * Editing or rescheduling. A `scheduledStart` change flips the status to
 * `RESCHEDULED` unless the caller states a status explicitly.
 */
export const updateInterviewSchema = z.object({
  type: interviewTypeSchema.optional(),
  status: interviewStatusSchema.optional(),
  round: z.coerce.number().int().min(1).max(20).optional(),
  title: z.string().trim().max(200).nullable().optional(),
  scheduledStart: z.coerce.date().optional(),
  scheduledEnd: z.coerce.date().nullable().optional(),
  durationMinutes: z.coerce.number().int().min(5).max(600).optional(),
  timezone: timezoneSchema.optional(),
  location: z.string().trim().max(300).nullable().optional(),
  meetingUrl: urlSchema.nullable().optional(),
  interviewerIds: z.array(idSchema).max(25).optional(),
  externalInterviewer: z.string().trim().max(200).nullable().optional(),
});
export type UpdateInterviewRequest = z.infer<typeof updateInterviewSchema>;

/** An interviewer's scorecard. Recording one also marks the interview done. */
export const interviewFeedbackSchema = z.object({
  feedback: z.string().trim().min(1, 'Add the interviewer’s feedback').max(4000),
  rating: z.coerce.number().int().min(1, 'Rate from 1 to 5').max(5, 'Rate from 1 to 5'),
  strengths: z.string().trim().max(2000).nullable().optional(),
  concerns: z.string().trim().max(2000).nullable().optional(),
});
export type InterviewFeedbackRequest = z.infer<typeof interviewFeedbackSchema>;

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const interviewQuerySchema = paginationQuerySchema.extend({
  status: z.union([interviewStatusSchema, z.array(interviewStatusSchema)]).optional(),
  type: z.union([interviewTypeSchema, z.array(interviewTypeSchema)]).optional(),
  applicationId: idSchema.optional(),
  jobId: idSchema.optional(),
  candidateId: idSchema.optional(),
  /** Interviews this user is on the panel of. */
  interviewerId: idSchema.optional(),
  /** Inclusive lower bound on `scheduledEnd` — the window overlaps this instant or later. */
  from: z.coerce.date().optional(),
  /** Inclusive upper bound on `scheduledStart`. */
  to: z.coerce.date().optional(),
  /** `true` keeps only what is still ahead; `false` keeps the rest. */
  upcoming: z.coerce.boolean().optional(),
  sortBy: z.enum(['scheduledStart', 'createdAt', 'updatedAt']).default('scheduledStart'),
  sortDir: sortDirSchema.default('asc'),
});
export type InterviewQuery = z.infer<typeof interviewQuerySchema>;

/** A calendar needs the whole window, not a page of it. */
export const interviewCalendarQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  interviewerId: idSchema.optional(),
  jobId: idSchema.optional(),
});
export type InterviewCalendarQuery = z.infer<typeof interviewCalendarQuerySchema>;

export interface InterviewParticipant {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  isLead: boolean;
}

export interface InterviewApplicationRef {
  id: string;
  job: { id: string; title: string; referenceCode: string };
  candidate: { id: string; fullName: string };
  client: { id: string; name: string } | null;
}

export interface InterviewListItem {
  id: string;
  type: z.infer<typeof interviewTypeSchema>;
  status: z.infer<typeof interviewStatusSchema>;
  round: number;
  title: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  durationMinutes: number;
  timezone: string;
  location: string | null;
  meetingUrl: string | null;
  externalInterviewer: string | null;
  application: InterviewApplicationRef;
  interviewers: InterviewParticipant[];
  /** Whole days since the interview was scheduled, for the "age" hint. */
  ageDays: number;
  hasFeedback: boolean;
  rating: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface InterviewDetail extends InterviewListItem {
  feedback: string | null;
  strengths: string | null;
  concerns: string | null;
  feedbackAt: string | null;
  submittedBy: { id: string; fullName: string; avatarUrl: string | null } | null;
}

/** The lean shape a calendar cell renders. */
export interface InterviewCalendarItem {
  id: string;
  title: string;
  type: z.infer<typeof interviewTypeSchema>;
  status: z.infer<typeof interviewStatusSchema>;
  round: number;
  scheduledStart: string;
  scheduledEnd: string;
  timezone: string;
  durationMinutes: number;
  applicationId: string;
  candidateName: string;
  jobTitle: string;
  interviewers: { id: string; fullName: string; avatarUrl: string | null }[];
}
