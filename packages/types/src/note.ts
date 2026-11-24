import { z } from 'zod';

import { entityTypeSchema, type EntityType } from './activity';
import { idSchema, paginationQuerySchema } from './common';

/**
 * Notes — free-form, pinnable memos attached to any record.
 *
 * Distinct from `Activity`: a note is always editable and never carries a
 * direction, duration or outcome, so the two are kept apart rather than folded
 * into one polymorphic table with half the columns unused.
 */

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export const createNoteSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(20000),
  entityType: entityTypeSchema,
  entityId: idSchema,
  candidateId: idSchema.nullable().optional(),
  isPinned: z.boolean().default(false),
});
export type CreateNoteRequest = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(20000).optional(),
  isPinned: z.boolean().optional(),
});
export type UpdateNoteRequest = z.infer<typeof updateNoteSchema>;

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const noteQuerySchema = paginationQuerySchema.extend({
  entityType: entityTypeSchema.optional(),
  entityId: idSchema.optional(),
  candidateId: idSchema.optional(),
  /** Pinned-first ordering is the default; this keeps *only* the pinned ones. */
  pinnedOnly: z.coerce.boolean().default(false),
});
export type NoteQuery = z.infer<typeof noteQuerySchema>;

export interface NoteItem {
  id: string;
  body: string;
  isPinned: boolean;
  entityType: EntityType;
  entityId: string;
  candidateId: string | null;
  createdBy: { id: string; fullName: string; avatarUrl: string | null } | null;
  createdAt: string;
  updatedAt: string;
}
