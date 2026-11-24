import { z } from 'zod';

import { csvIdsSchema, currencySchema, idSchema, paginationQuerySchema } from './common';
import {
  jobStatusSchema,
  jobTypeSchema,
  prioritySchema,
  remoteTypeSchema,
  workAuthorizationSchema,
} from './enums';

/** How the pay/bill rates are expressed. */
export const rateTypeSchema = z.enum(['HOURLY', 'DAILY', 'MONTHLY', 'ANNUAL']);
export type RateType = z.infer<typeof rateTypeSchema>;
export const RATE_TYPE_LABELS: Record<RateType, string> = {
  HOURLY: 'per hour',
  DAILY: 'per day',
  MONTHLY: 'per month',
  ANNUAL: 'per year',
};

export const jobSkillInputSchema = z.object({
  skillId: idSchema,
  /** 1 = nice to have, 2 = required, 3 = must-have. */
  weight: z.coerce.number().int().min(1).max(3).default(2),
  required: z.boolean().default(true),
  minYears: z.coerce.number().int().min(0).max(50).nullable().optional(),
});
export type JobSkillInput = z.infer<typeof jobSkillInputSchema>;

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export const createJobSchema = z.object({
  title: z.string().trim().min(2, 'Give the job a title').max(160),
  clientId: idSchema.nullable().optional(),
  contactId: idSchema.nullable().optional(),
  status: jobStatusSchema.default('DRAFT'),
  jobType: jobTypeSchema.default('FULL_TIME'),
  remoteType: remoteTypeSchema.default('ONSITE'),
  priority: prioritySchema.default('MEDIUM'),

  description: z.string().trim().max(20000).nullable().optional(),
  requirements: z.string().trim().max(20000).nullable().optional(),
  responsibilities: z.string().trim().max(20000).nullable().optional(),

  locationCity: z.string().trim().max(120).nullable().optional(),
  locationState: z.string().trim().max(120).nullable().optional(),
  locationCountry: z.string().trim().max(120).nullable().optional(),

  openings: z.coerce.number().int().min(1).max(999).default(1),

  payRateMinCents: z.coerce.number().int().min(0).nullable().optional(),
  payRateMaxCents: z.coerce.number().int().min(0).nullable().optional(),
  billRateCents: z.coerce.number().int().min(0).nullable().optional(),
  rateType: rateTypeSchema.nullable().optional(),
  billRateType: rateTypeSchema.nullable().optional(),
  currency: currencySchema.default('USD'),

  minExperienceYears: z.coerce.number().int().min(0).max(60).nullable().optional(),
  maxExperienceYears: z.coerce.number().int().min(0).max(60).nullable().optional(),
  educationLevel: z.string().trim().max(80).nullable().optional(),
  workAuthorizations: z.array(workAuthorizationSchema).max(10).default([]),
  visaSponsorship: z.boolean().nullable().optional(),

  targetFillAt: z.coerce.date().nullable().optional(),
  ownerId: idSchema.nullable().optional(),
  teamId: idSchema.nullable().optional(),
  source: z.string().trim().max(80).nullable().optional(),
  skills: z.array(jobSkillInputSchema).max(60).default([]),
  /** Clone the tenant's default pipeline at creation (default) or start empty. */
  useDefaultPipeline: z.boolean().default(true),
  customFields: z.record(z.unknown()).default({}),
});
export type CreateJobRequest = z.infer<typeof createJobSchema>;

export const updateJobSchema = createJobSchema
  .omit({ useDefaultPipeline: true, skills: true, status: true })
  .partial();
export type UpdateJobRequest = z.infer<typeof updateJobSchema>;

/**
 * Status transitions are validated server-side against this map so a closed
 * job can never silently return to draft.
 */
export const JOB_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['OPEN', 'CANCELLED'],
  OPEN: ['ON_HOLD', 'CLOSED', 'FILLED', 'CANCELLED'],
  ON_HOLD: ['OPEN', 'CLOSED', 'CANCELLED'],
  CLOSED: ['OPEN'],
  FILLED: ['OPEN'],
  CANCELLED: ['DRAFT'],
};

export const changeJobStatusSchema = z.object({
  status: jobStatusSchema,
  reason: z.string().trim().max(400).nullable().optional(),
});
export type ChangeJobStatusRequest = z.infer<typeof changeJobStatusSchema>;

export const cloneJobSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  clonePipeline: z.boolean().default(true),
});
export type CloneJobRequest = z.infer<typeof cloneJobSchema>;

export const assignRecruitersSchema = z.object({
  /** Full replacement set; the service diffs against current assignments. */
  assignments: z
    .array(
      z.object({
        userId: idSchema,
        role: z.enum(['OWNER', 'RECRUITER', 'SOURCING', 'COORDINATOR']).default('RECRUITER'),
        isPrimary: z.boolean().default(false),
      }),
    )
    .max(50),
  /** Notify newly added assignees. */
  notify: z.boolean().default(true),
});
export type AssignRecruitersRequest = z.infer<typeof assignRecruitersSchema>;

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const JOB_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'title',
  'status',
  'priority',
  'targetFillAt',
  'openedAt',
  'applicantCount',
] as const;

export const jobQuerySchema = paginationQuerySchema.extend({
  status: z.union([jobStatusSchema, z.array(jobStatusSchema)]).optional(),
  priority: z.union([prioritySchema, z.array(prioritySchema)]).optional(),
  jobType: z.union([jobTypeSchema, z.array(jobTypeSchema)]).optional(),
  remoteType: z.union([remoteTypeSchema, z.array(remoteTypeSchema)]).optional(),
  clientId: idSchema.optional(),
  recruiterId: idSchema.optional(),
  ownerId: idSchema.optional(),
  teamId: idSchema.optional(),
  location: z.string().trim().max(120).optional(),
  skillIds: csvIdsSchema.optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  dueBefore: z.coerce.date().optional(),
  /** Restrict to jobs the caller owns or is assigned to. */
  myJobs: z.coerce.boolean().default(false),
  /** High or urgent priority only. */
  hot: z.coerce.boolean().default(false),
  sortBy: z.enum(JOB_SORT_FIELDS).default('createdAt'),
});
export type JobQuery = z.infer<typeof jobQuerySchema>;

export interface JobListSkill {
  id: string;
  name: string;
  required: boolean;
}

export interface JobListOwner {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface JobListItem {
  id: string;
  title: string;
  referenceCode: string;
  status: z.infer<typeof jobStatusSchema>;
  priority: z.infer<typeof prioritySchema>;
  jobType: z.infer<typeof jobTypeSchema>;
  remoteType: z.infer<typeof remoteTypeSchema>;
  client: { id: string; name: string } | null;
  owner: JobListOwner | null;
  location: string | null;
  openings: number;
  filledCount: number;
  currency: string;
  payRateMinCents: number | null;
  payRateMaxCents: number | null;
  rateType: string | null;
  isHot: boolean;
  applicantCount: number;
  newApplicantCount: number;
  skills: JobListSkill[];
  openedAt: string | null;
  targetFillAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobDetail extends JobListItem {
  contact: { id: string; fullName: string; email: string | null } | null;
  teamId: string | null;
  description: string | null;
  requirements: string | null;
  responsibilities: string | null;
  locationCity: string | null;
  locationState: string | null;
  locationCountry: string | null;
  payRateMinCents: number | null;
  payRateMaxCents: number | null;
  billRateCents: number | null;
  billRateType: string | null;
  marginCents: number | null;
  marginPercentage: number | null;
  minExperienceYears: number | null;
  maxExperienceYears: number | null;
  educationLevel: string | null;
  workAuthorizations: z.infer<typeof workAuthorizationSchema>[];
  visaSponsorship: boolean | null;
  source: string | null;
  externalId: string | null;
  closedReason: string | null;
  customFields: Record<string, unknown>;
  assignments: {
    userId: string;
    fullName: string;
    avatarUrl: string | null;
    role: string;
    isPrimary: boolean;
  }[];
  skills: (JobListSkill & { weight: number; minYears: number | null })[];
  pipeline: JobPipelineStageSummary[];
  /** True when the job owns a private copy of the pipeline. */
  hasCustomPipeline: boolean;
}

export interface JobPipelineStageSummary {
  id: string;
  key: string;
  name: string;
  type: string;
  category: string;
  color: string;
  order: number;
  isTerminal: boolean;
  slaDays: number | null;
  applicationCount: number;
}

export interface JobStats {
  pipeline: JobPipelineStageSummary[];
  totals: {
    applications: number;
    active: number;
    rejected: number;
    withdrawn: number;
    placed: number;
    interviews: number;
    offers: number;
  };
  /** Average days applications currently sit in each active stage. */
  averageDaysInStage: { stageId: string; stageName: string; averageDays: number }[];
  submissionFunnel: { stageKey: string; stageName: string; count: number }[];
}
