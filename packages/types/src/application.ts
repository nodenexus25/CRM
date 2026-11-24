import { z } from 'zod';

import { idSchema, paginationQuerySchema } from './common';
import {
  applicationStatusSchema,
  candidateSourceSchema,
  submissionStatusSchema,
} from './enums';

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export const addToPipelineSchema = z.object({
  jobId: idSchema,
  candidateIds: z.array(idSchema).min(1, 'Pick at least one candidate').max(200),
  /** Defaults to the job's first stage when omitted. */
  stageId: idSchema.optional(),
  source: candidateSourceSchema.optional(),
  ownerId: idSchema.nullable().optional(),
  note: z.string().trim().max(600).nullable().optional(),
});
export type AddToPipelineRequest = z.infer<typeof addToPipelineSchema>;

export const moveStageSchema = z.object({
  toStageId: idSchema,
  /** Fractional index inside the destination column; appended when omitted. */
  boardOrder: z.coerce.number().nullable().optional(),
  note: z.string().trim().max(600).nullable().optional(),
  /**
   * Required by the service when the destination stage's category is
   * `REJECTED`; must reference an active `RejectionReason` in this tenant.
   */
  rejectionReasonId: idSchema.nullable().optional(),
});
export type MoveStageRequest = z.infer<typeof moveStageSchema>;

export const bulkMoveStageSchema = moveStageSchema.extend({
  applicationIds: z.array(idSchema).min(1).max(200),
});
export type BulkMoveStageRequest = z.infer<typeof bulkMoveStageSchema>;

export const rejectApplicationSchema = z.object({
  rejectionReasonId: idSchema,
  note: z.string().trim().max(1000).nullable().optional(),
});
export type RejectApplicationRequest = z.infer<typeof rejectApplicationSchema>;

export const withdrawApplicationSchema = z.object({
  note: z.string().trim().max(600).nullable().optional(),
});
export type WithdrawApplicationRequest = z.infer<typeof withdrawApplicationSchema>;

export const updateApplicationSchema = z.object({
  ownerId: idSchema.nullable().optional(),
  rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  submissionStatus: submissionStatusSchema.optional(),
  source: candidateSourceSchema.nullable().optional(),
});
export type UpdateApplicationRequest = z.infer<typeof updateApplicationSchema>;

export const removeFromPipelineQuerySchema = z.object({
  /** `SOFT` (default) hides the row; `HARD` deletes it. */
  mode: z.enum(['SOFT', 'HARD']).default('SOFT'),
  note: z.string().trim().max(600).optional(),
});
export type RemoveFromPipelineQuery = z.infer<typeof removeFromPipelineQuerySchema>;

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const applicationQuerySchema = paginationQuerySchema.extend({
  jobId: idSchema.optional(),
  candidateId: idSchema.optional(),
  stageId: idSchema.optional(),
  status: z.union([applicationStatusSchema, z.array(applicationStatusSchema)]).optional(),
  ownerId: idSchema.optional(),
  submittedOnly: z.coerce.boolean().default(false),
  /** Flag applications that have exceeded their stage's SLA. */
  staleOnly: z.coerce.boolean().default(false),
  sortBy: z
    .enum(['appliedAt', 'updatedAt', 'stageEnteredAt', 'boardOrder', 'rating'])
    .default('appliedAt'),
});
export type ApplicationQuery = z.infer<typeof applicationQuerySchema>;

/** Kanban payload for a job board: one column per stage, cards pre-sorted. */
export const boardQuerySchema = z.object({
  stageIds: z.string().trim().max(1000).optional(),
  ownerId: idSchema.optional(),
  limitPerStage: z.coerce.number().int().min(1).max(200).default(50),
});
export type BoardQuery = z.infer<typeof boardQuerySchema>;

export interface ApplicationCard {
  id: string;
  candidateId: string;
  candidateName: string;
  candidateAvatarUrl: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  location: string | null;
  rating: number | null;
  stageId: string;
  boardOrder: number;
  status: z.infer<typeof applicationStatusSchema>;
  submissionStatus: z.infer<typeof submissionStatusSchema>;
  owner: { id: string; fullName: string } | null;
  tags: string[];
  isRejected: boolean;
  daysInStage: number;
  slaBreached: boolean;
  appliedAt: string;
  stageEnteredAt: string;
}

export interface BoardColumn {
  stage: {
    id: string;
    key: string;
    name: string;
    category: string;
    color: string;
    order: number;
    isTerminal: boolean;
    slaDays: number | null;
  };
  total: number;
  cards: ApplicationCard[];
}

export interface BoardResponse {
  job: { id: string; title: string; referenceCode: string; status: string };
  columns: BoardColumn[];
}

export interface ApplicationListItem {
  id: string;
  job: { id: string; title: string; referenceCode: string };
  candidate: { id: string; fullName: string; avatarUrl: string | null };
  stage: { id: string; name: string; color: string; category: string };
  status: z.infer<typeof applicationStatusSchema>;
  submissionStatus: z.infer<typeof submissionStatusSchema>;
  owner: { id: string; fullName: string } | null;
  rating: number | null;
  appliedAt: string;
  stageEnteredAt: string;
  daysInStage: number;
  slaBreached: boolean;
  rejectedReason: string | null;
}

export interface StageHistoryItem {
  id: string;
  fromStage: { id: string; name: string; color: string } | null;
  toStage: { id: string; name: string; color: string };
  note: string | null;
  changedBy: { id: string; fullName: string; avatarUrl: string | null } | null;
  durationSeconds: number | null;
  createdAt: string;
}

export interface ApplicationDetail extends ApplicationListItem {
  candidate: { id: string; fullName: string; avatarUrl: string | null; email: string | null };
  source: z.infer<typeof candidateSourceSchema> | null;
  submittedAt: string | null;
  clientFeedback: string | null;
  clientFeedbackAt: string | null;
  rejectedAt: string | null;
  rejectedStageId: string | null;
  resumeId: string | null;
  history: StageHistoryItem[];
  interviews: {
    id: string;
    type: string;
    status: string;
    round: number;
    title: string | null;
    scheduledAt: string | null;
  }[];
  offers: { id: string; status: string; createdAt: string }[];
  placement: { id: string; status: string; startDate: string | null } | null;
}

/**
 * Outcome of adding candidates to a job's pipeline. Candidates already on the
 * job are reported in `skipped` rather than failing the whole request.
 */
export interface AddToPipelineResult {
  added: ApplicationDetail[];
  skipped: { candidateId: string; reason: string }[];
}
