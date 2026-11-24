import { z } from 'zod';

import { hexColorSchema, idSchema, slugSchema } from './common';
import { stageCategorySchema, stageTypeSchema } from './enums';

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

export const createPipelineStageSchema = z.object({
  key: slugSchema,
  name: z.string().trim().min(1, 'Give the stage a name').max(60),
  type: stageTypeSchema,
  category: stageCategorySchema.default('ACTIVE'),
  color: hexColorSchema.default('#64748b'),
  /** Days before a candidate in this stage is flagged stale. */
  slaDays: z.coerce.number().int().min(1).max(365).nullable().optional(),
  description: z.string().trim().max(400).nullable().optional(),
  isTerminal: z.boolean().default(false),
  requiredPermission: z.string().trim().max(64).nullable().optional(),
});
export type CreatePipelineStageRequest = z.infer<typeof createPipelineStageSchema>;

export const updatePipelineStageSchema = createPipelineStageSchema
  .omit({ key: true, isTerminal: true, requiredPermission: true })
  .partial();
export type UpdatePipelineStageRequest = z.infer<typeof updatePipelineStageSchema>;

/** Single transactional reorder — one round trip, one audit entry. */
export const reorderPipelineStagesSchema = z.object({
  stages: z
    .array(z.object({ id: idSchema, order: z.coerce.number().int().min(0) }))
    .min(1)
    .max(100),
});
export type ReorderPipelineStagesRequest = z.infer<typeof reorderPipelineStagesSchema>;

/**
 * Deleting a stage that still holds applications requires a destination: the
 * API moves every application (and records stage history) before deleting.
 */
export const deletePipelineStageQuerySchema = z.object({
  moveToStageId: idSchema.optional(),
});
export type DeletePipelineStageQuery = z.infer<typeof deletePipelineStageQuerySchema>;

export interface PipelineStageItem {
  id: string;
  key: string;
  name: string;
  type: z.infer<typeof stageTypeSchema>;
  category: z.infer<typeof stageCategorySchema>;
  color: string;
  order: number;
  isDefault: boolean;
  isTerminal: boolean;
  slaDays: number | null;
  description: string | null;
  requiredPermission: string | null;
  /** Live application count, so the settings screen can block unsafe deletes. */
  applicationCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Full replacement of a job's pipeline, sent by the job pipeline editor. Array
 * order becomes stage order. A stage that already holds applications cannot be
 * dropped — the API rejects the payload rather than silently orphaning them.
 */
export const updateJobStagesSchema = z.object({
  stages: z
    .array(
      z.object({
        /** Present when editing a stage that already exists on the job. */
        id: idSchema.optional(),
        key: slugSchema,
        name: z.string().trim().min(1, 'Give the stage a name').max(60),
        type: stageTypeSchema,
        category: stageCategorySchema.default('ACTIVE'),
        color: hexColorSchema.default('#64748b'),
        slaDays: z.coerce.number().int().min(1).max(365).nullable().optional(),
        description: z.string().trim().max(400).nullable().optional(),
        isTerminal: z.boolean().default(false),
      }),
    )
    .min(1, 'A pipeline needs at least one stage')
    .max(100),
});
export type UpdateJobStagesRequest = z.infer<typeof updateJobStagesSchema>;

// ---------------------------------------------------------------------------
// Rejection reasons
// ---------------------------------------------------------------------------

export const createRejectionReasonSchema = z.object({
  key: slugSchema,
  label: z.string().trim().min(1, 'Give the reason a label').max(80),
  order: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});
export type CreateRejectionReasonRequest = z.infer<typeof createRejectionReasonSchema>;

export const updateRejectionReasonSchema = createRejectionReasonSchema
  .omit({ key: true })
  .partial();
export type UpdateRejectionReasonRequest = z.infer<typeof updateRejectionReasonSchema>;

export const rejectionReasonQuerySchema = z.object({
  includeInactive: z.coerce.boolean().default(false),
});
export type RejectionReasonQuery = z.infer<typeof rejectionReasonQuerySchema>;

export interface RejectionReasonItem {
  id: string;
  key: string;
  label: string;
  order: number;
  isActive: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Default reasons seeded into every workspace. */
export const DEFAULT_REJECTION_REASONS = [
  { key: 'not-a-fit', label: 'Not a fit for the role' },
  { key: 'overqualified', label: 'Overqualified' },
  { key: 'underqualified', label: 'Lacks required experience' },
  { key: 'compensation', label: 'Compensation mismatch' },
  { key: 'location', label: 'Location / relocation' },
  { key: 'work-authorization', label: 'Work authorisation' },
  { key: 'client-rejected', label: 'Rejected by client' },
  { key: 'position-closed', label: 'Position closed' },
  { key: 'no-response', label: 'Unresponsive' },
  { key: 'other', label: 'Other' },
] as const;
