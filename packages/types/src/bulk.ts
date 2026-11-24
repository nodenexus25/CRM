import { z } from 'zod';

import { idSchema, paginationQuerySchema } from './common';
import {
  bulkOperationStatusSchema,
  bulkOperationTypeSchema,
  candidateSourceSchema,
  jobStatusSchema,
  prioritySchema,
} from './enums';

import { candidateStatusSchema } from './candidate';

/**
 * A selection is either an explicit id list or "everything matching this
 * filter". The API re-resolves filter-based selections server-side, so a client
 * can never smuggle an unrestricted `all: true`.
 */
export const bulkSelectionSchema = z.union([
  z.object({ ids: z.array(idSchema).min(1).max(5000) }),
  z.object({ all: z.literal(true), filters: z.record(z.unknown()) }),
]);
export type BulkSelection = z.infer<typeof bulkSelectionSchema>;

export const bulkOperationPayloadSchemas = {
  CANDIDATE_TAGS: z.object({
    add: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
    remove: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  }),
  CANDIDATE_OWNER: z.object({ ownerId: idSchema.nullable() }),
  CANDIDATE_STATUS: z.object({ status: candidateStatusSchema }),
  CANDIDATE_ADD_TO_JOB: z.object({
    jobId: idSchema,
    stageId: idSchema.optional(),
    source: candidateSourceSchema.optional(),
  }),
  CANDIDATE_ADD_TO_LIST: z.object({ listId: idSchema }),
  CANDIDATE_DELETE: z.object({}),
  CANDIDATE_EXPORT: z.object({
    columns: z.array(z.string().trim().max(64)).max(60).default([]),
  }),
  JOB_STATUS: z.object({ status: jobStatusSchema, reason: z.string().trim().max(400).optional() }),
  JOB_PRIORITY: z.object({ priority: prioritySchema }),
  JOB_ASSIGN_RECRUITERS: z.object({ userIds: z.array(idSchema).min(1).max(50) }),
} as const;

export type BulkOperationPayload = {
  [K in keyof typeof bulkOperationPayloadSchemas]: z.infer<(typeof bulkOperationPayloadSchemas)[K]>;
};

/**
 * Request body for `POST /bulk-operations`. Discriminated on `type` so the
 * payload is validated against the right schema before it ever reaches a
 * worker.
 */
export const createBulkOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('CANDIDATE_TAGS'),
    selection: bulkSelectionSchema,
    payload: bulkOperationPayloadSchemas.CANDIDATE_TAGS,
  }),
  z.object({
    type: z.literal('CANDIDATE_OWNER'),
    selection: bulkSelectionSchema,
    payload: bulkOperationPayloadSchemas.CANDIDATE_OWNER,
  }),
  z.object({
    type: z.literal('CANDIDATE_STATUS'),
    selection: bulkSelectionSchema,
    payload: bulkOperationPayloadSchemas.CANDIDATE_STATUS,
  }),
  z.object({
    type: z.literal('CANDIDATE_ADD_TO_JOB'),
    selection: bulkSelectionSchema,
    payload: bulkOperationPayloadSchemas.CANDIDATE_ADD_TO_JOB,
  }),
  z.object({
    type: z.literal('CANDIDATE_ADD_TO_LIST'),
    selection: bulkSelectionSchema,
    payload: bulkOperationPayloadSchemas.CANDIDATE_ADD_TO_LIST,
  }),
  z.object({
    type: z.literal('CANDIDATE_DELETE'),
    selection: bulkSelectionSchema,
    payload: bulkOperationPayloadSchemas.CANDIDATE_DELETE,
  }),
  z.object({
    type: z.literal('CANDIDATE_EXPORT'),
    selection: bulkSelectionSchema,
    payload: bulkOperationPayloadSchemas.CANDIDATE_EXPORT,
  }),
  z.object({
    type: z.literal('JOB_STATUS'),
    selection: bulkSelectionSchema,
    payload: bulkOperationPayloadSchemas.JOB_STATUS,
  }),
  z.object({
    type: z.literal('JOB_PRIORITY'),
    selection: bulkSelectionSchema,
    payload: bulkOperationPayloadSchemas.JOB_PRIORITY,
  }),
  z.object({
    type: z.literal('JOB_ASSIGN_RECRUITERS'),
    selection: bulkSelectionSchema,
    payload: bulkOperationPayloadSchemas.JOB_ASSIGN_RECRUITERS,
  }),
]);
export type CreateBulkOperationRequest = z.infer<typeof createBulkOperationSchema>;

export const bulkOperationQuerySchema = paginationQuerySchema.extend({
  status: z.union([bulkOperationStatusSchema, z.array(bulkOperationStatusSchema)]).optional(),
  type: z.union([bulkOperationTypeSchema, z.array(bulkOperationTypeSchema)]).optional(),
  mine: z.coerce.boolean().default(false),
  sortBy: z.enum(['createdAt', 'completedAt', 'status']).default('createdAt'),
});
export type BulkOperationQuery = z.infer<typeof bulkOperationQuerySchema>;

export interface BulkOperationItem {
  id: string;
  type: z.infer<typeof bulkOperationTypeSchema>;
  status: z.infer<typeof bulkOperationStatusSchema>;
  selection: Record<string, unknown>;
  payload: Record<string, unknown>;
  totalItems: number;
  processedItems: number;
  succeededItems: number;
  failedItems: number;
  /** Percentage 0–100, computed server-side for progress bars. */
  progress: number;
  errors: { id: string; message: string }[];
  resultKey: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}
