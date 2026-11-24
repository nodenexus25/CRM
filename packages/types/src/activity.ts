import { z } from 'zod';

import { idSchema, paginationQuerySchema } from './common';
import { activityDirectionSchema, activityTypeSchema } from './enums';

/**
 * Activities — the engagement timeline attached to any record.
 *
 * One polymorphic table backs calls, emails, meetings, notes and the automatic
 * `SYSTEM` / `STAGE_CHANGE` entries the rest of the ATS writes, so a candidate
 * or job timeline can be rendered from a single query.
 */

/**
 * Discriminator for the polymorphic tables (`Activity`, `Note`, `Attachment`,
 * `Task`). Mirrors the Prisma `EntityType` enum one-for-one.
 */
export const entityTypeSchema = z.enum([
  'CANDIDATE',
  'CLIENT',
  'CONTACT',
  'JOB',
  'APPLICATION',
  'INTERVIEW',
  'OFFER',
  'PLACEMENT',
  'USER',
  'TEAM',
  'TENANT',
]);
export type EntityType = z.infer<typeof entityTypeSchema>;

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  CANDIDATE: 'Candidate',
  CLIENT: 'Client',
  CONTACT: 'Contact',
  JOB: 'Job',
  APPLICATION: 'Application',
  INTERVIEW: 'Interview',
  OFFER: 'Offer',
  PLACEMENT: 'Placement',
  USER: 'User',
  TEAM: 'Team',
  TENANT: 'Workspace',
};

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export const createActivitySchema = z.object({
  type: activityTypeSchema,
  subject: z.string().trim().min(1, 'Give the activity a subject').max(200),
  body: z.string().trim().max(20000).nullable().optional(),
  occurredAt: z.coerce.date().optional(),
  durationMinutes: z.coerce.number().int().min(0).max(1440).nullable().optional(),
  entityType: entityTypeSchema,
  entityId: idSchema,
  candidateId: idSchema.nullable().optional(),
  clientId: idSchema.nullable().optional(),
  jobId: idSchema.nullable().optional(),
  contactId: idSchema.nullable().optional(),
  applicationId: idSchema.nullable().optional(),
  isPinned: z.boolean().default(false),
});
export type CreateActivityRequest = z.infer<typeof createActivitySchema>;

/**
 * Correcting a logged activity. The polymorphic link is immutable — moving an
 * activity to a different record would silently rewrite two timelines — so only
 * the content, the when and the outcome can change.
 */
export const updateActivitySchema = z.object({
  subject: z.string().trim().min(1, 'Give the activity a subject').max(200).optional(),
  body: z.string().trim().max(20000).nullable().optional(),
  occurredAt: z.coerce.date().optional(),
  durationMinutes: z.coerce.number().int().min(0).max(1440).nullable().optional(),
  outcome: z.string().trim().max(500).nullable().optional(),
  nextStepAt: z.coerce.date().nullable().optional(),
  isPinned: z.boolean().optional(),
});
export type UpdateActivityRequest = z.infer<typeof updateActivitySchema>;

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const activityQuerySchema = paginationQuerySchema.extend({
  entityType: entityTypeSchema.optional(),
  entityId: idSchema.optional(),
  type: z.union([activityTypeSchema, z.array(activityTypeSchema)]).optional(),
  candidateId: idSchema.optional(),
  clientId: idSchema.optional(),
  contactId: idSchema.optional(),
  jobId: idSchema.optional(),
  applicationId: idSchema.optional(),
  /** Only what the caller logged themselves. */
  mine: z.coerce.boolean().default(false),
  /** Inclusive lower bound on `occurredAt`. */
  from: z.coerce.date().optional(),
  /** Inclusive upper bound on `occurredAt`. */
  to: z.coerce.date().optional(),
  /** Include the automatic `SYSTEM` entries the ATS writes. */
  includeSystem: z.coerce.boolean().default(true),
});
export type ActivityQuery = z.infer<typeof activityQuerySchema>;

export interface ActivityItem {
  id: string;
  type: z.infer<typeof activityTypeSchema>;
  subject: string;
  body: string | null;
  direction: z.infer<typeof activityDirectionSchema> | null;
  occurredAt: string;
  durationMinutes: number | null;
  entityType: EntityType;
  entityId: string;
  /** Denormalised links, so a timeline row can deep-link without a second read. */
  candidateId: string | null;
  clientId: string | null;
  jobId: string | null;
  applicationId: string | null;
  outcome: string | null;
  nextStepAt: string | null;
  createdBy: { id: string; fullName: string; avatarUrl: string | null } | null;
  isPinned: boolean;
  createdAt: string;
}
