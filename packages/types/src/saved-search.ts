import { z } from 'zod';

import { idSchema } from './common';
import { visibilitySchema } from './enums';

/**
 * Saved views — reusable list configurations ("My hot jobs", "Stale submissions").
 *
 * The filter payload is stored verbatim and replayed by the list page, so it is
 * deliberately schemaless (`Record<string, unknown>`): each entity owns its own
 * query shape, and a view saved before a filter was added must keep working.
 */

export const savedViewEntitySchema = z.enum(['JOB', 'CANDIDATE', 'APPLICATION', 'CLIENT']);
export type SavedViewEntity = z.infer<typeof savedViewEntitySchema>;

export const SAVED_VIEW_ENTITY_LABELS: Record<SavedViewEntity, string> = {
  JOB: 'Jobs',
  CANDIDATE: 'Candidates',
  APPLICATION: 'Applications',
  CLIENT: 'Clients',
};

export const createSavedViewSchema = z.object({
  entity: savedViewEntitySchema,
  name: z.string().trim().min(1, 'Give the view a name').max(80),
  /** The list page's query state, stored as-is and replayed on selection. */
  filters: z.record(z.unknown()).default({}),
  columns: z.array(z.string().trim().max(48)).max(60).default([]),
  sortBy: z.string().trim().max(64).nullable().optional(),
  sortDir: z.enum(['asc', 'desc']).nullable().optional(),
  visibility: visibilitySchema.default('PRIVATE'),
  isDefault: z.boolean().default(false),
});
export type CreateSavedViewRequest = z.infer<typeof createSavedViewSchema>;

export const updateSavedViewSchema = createSavedViewSchema
  .omit({ entity: true })
  .partial();
export type UpdateSavedViewRequest = z.infer<typeof updateSavedViewSchema>;

export const savedViewQuerySchema = z.object({
  entity: savedViewEntitySchema.optional(),
});
export type SavedViewQuery = z.infer<typeof savedViewQuerySchema>;

export interface SavedViewItem {
  id: string;
  entity: SavedViewEntity;
  name: string;
  filters: Record<string, unknown>;
  columns: string[];
  sortBy: string | null;
  sortDir: 'asc' | 'desc' | null;
  visibility: z.infer<typeof visibilitySchema>;
  isDefault: boolean;
  /** Null for a shared (workspace-wide) view. */
  ownerId: string | null;
  isOwn: boolean;
  createdAt: string;
  updatedAt: string;
}

export const savedViewIdParamSchema = z.object({ id: idSchema });
