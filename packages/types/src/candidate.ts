import { z } from 'zod';

import {
  csvIdsSchema,
  currencySchema,
  emailSchema,
  hexColorSchema,
  idSchema,
  paginationQuerySchema,
  phoneSchema,
  urlSchema,
} from './common';
import {
  availabilitySchema,
  candidateSourceSchema,
  experienceLevelSchema,
  skillProficiencySchema,
  visibilitySchema,
  workAuthorizationSchema,
} from './enums';

export const candidateStatusSchema = z.enum([
  'ACTIVE',
  'PASSIVE',
  'DO_NOT_CONTACT',
  'PLACED',
  'ARCHIVED',
]);
export type CandidateStatus = z.infer<typeof candidateStatusSchema>;
export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  ACTIVE: 'Active',
  PASSIVE: 'Passive',
  DO_NOT_CONTACT: 'Do not contact',
  PLACED: 'Placed',
  ARCHIVED: 'Archived',
};

// ---------------------------------------------------------------------------
// Sub-resources
// ---------------------------------------------------------------------------

export const candidateEmailInputSchema = z.object({
  address: emailSchema,
  label: z.string().trim().max(40).nullable().optional(),
  isPrimary: z.boolean().default(false),
});

export const candidatePhoneInputSchema = z.object({
  number: phoneSchema,
  label: z.string().trim().max(40).nullable().optional(),
  isPrimary: z.boolean().default(false),
});

export const candidateExperienceInputSchema = z.object({
  company: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(160),
  employmentType: z.string().trim().max(60).nullable().optional(),
  location: z.string().trim().max(160).nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  isCurrent: z.boolean().default(false),
  description: z.string().trim().max(8000).nullable().optional(),
  skills: z.array(z.string().trim().max(80)).max(50).default([]),
});

export const candidateEducationInputSchema = z.object({
  institution: z.string().trim().min(1).max(200),
  degree: z.string().trim().max(160).nullable().optional(),
  fieldOfStudy: z.string().trim().max(160).nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  grade: z.string().trim().max(60).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
});

export const candidateSkillInputSchema = z.object({
  skillId: idSchema,
  years: z.coerce.number().int().min(0).max(60).nullable().optional(),
  /** Self-assessed 1–5. */
  level: z.coerce.number().int().min(1).max(5).nullable().optional(),
  isPrimary: z.boolean().default(false),
  lastUsedAt: z.coerce.date().nullable().optional(),
});
export type CandidateSkillInput = z.infer<typeof candidateSkillInputSchema>;

export const candidateCertificationInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  issuer: z.string().trim().max(160).nullable().optional(),
  issuedAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  credentialId: z.string().trim().max(120).nullable().optional(),
  credentialUrl: urlSchema.nullable().optional(),
});

export const candidateLanguageInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  proficiency: skillProficiencySchema.default('PROFESSIONAL'),
});

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export const createCandidateSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  email: emailSchema.nullable().optional(),
  phone: phoneSchema.nullable().optional(),
  alternatePhone: phoneSchema.nullable().optional(),

  headline: z.string().trim().max(200).nullable().optional(),
  summary: z.string().trim().max(8000).nullable().optional(),
  currentTitle: z.string().trim().max(160).nullable().optional(),
  currentCompany: z.string().trim().max(160).nullable().optional(),

  locationCity: z.string().trim().max(120).nullable().optional(),
  locationState: z.string().trim().max(120).nullable().optional(),
  locationCountry: z.string().trim().max(120).nullable().optional(),
  willingToRelocate: z.boolean().default(false),

  totalExperienceMonths: z.coerce.number().int().min(0).max(840).nullable().optional(),
  relevantExperienceMonths: z.coerce.number().int().min(0).max(840).nullable().optional(),
  experienceLevel: experienceLevelSchema.nullable().optional(),

  workAuthorization: workAuthorizationSchema.default('UNKNOWN'),
  workAuthorizationExpiresAt: z.coerce.date().nullable().optional(),
  availability: availabilitySchema.nullable().optional(),
  availabilityDate: z.coerce.date().nullable().optional(),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).nullable().optional(),

  expectedSalaryCents: z.coerce.number().int().min(0).nullable().optional(),
  expectedSalaryCurrency: currencySchema.nullable().optional(),
  currentSalaryCents: z.coerce.number().int().min(0).nullable().optional(),
  expectedRateCents: z.coerce.number().int().min(0).nullable().optional(),
  currentRateCents: z.coerce.number().int().min(0).nullable().optional(),
  ratePeriod: z.enum(['HOURLY', 'DAILY', 'MONTHLY', 'ANNUAL']).nullable().optional(),
  rateCurrency: currencySchema.nullable().optional(),

  linkedinUrl: urlSchema.nullable().optional(),
  githubUrl: urlSchema.nullable().optional(),
  portfolioUrl: urlSchema.nullable().optional(),
  websiteUrl: urlSchema.nullable().optional(),

  source: candidateSourceSchema.default('MANUAL'),
  sourceDetail: z.string().trim().max(160).nullable().optional(),
  status: candidateStatusSchema.default('ACTIVE'),
  rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  isHot: z.boolean().default(false),
  /** Archived candidates are hidden from the default list and filterable via `isArchived`. */
  isArchived: z.boolean().default(false),
  ownerId: idSchema.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  customFields: z.record(z.unknown()).default({}),

  emails: z.array(candidateEmailInputSchema).max(10).default([]),
  phones: z.array(candidatePhoneInputSchema).max(10).default([]),
  experiences: z.array(candidateExperienceInputSchema).max(50).default([]),
  educations: z.array(candidateEducationInputSchema).max(20).default([]),
  skills: z.array(candidateSkillInputSchema).max(80).default([]),
  certifications: z.array(candidateCertificationInputSchema).max(40).default([]),
  languages: z.array(candidateLanguageInputSchema).max(20).default([]),
  /** Ignore the duplicate warning and create anyway. */
  allowDuplicate: z.boolean().default(false),
});
export type CreateCandidateRequest = z.infer<typeof createCandidateSchema>;

/**
 * Nested collections are omitted from the update payload: they have their own
 * endpoints so a profile edit never clobbers a resume-parsed experience list.
 */
export const updateCandidateSchema = createCandidateSchema
  .omit({
    emails: true,
    phones: true,
    experiences: true,
    educations: true,
    skills: true,
    certifications: true,
    languages: true,
    allowDuplicate: true,
  })
  .partial();
export type UpdateCandidateRequest = z.infer<typeof updateCandidateSchema>;

export const updateCandidateOwnerSchema = z.object({
  ownerId: idSchema.nullable(),
});
export type UpdateCandidateOwnerRequest = z.infer<typeof updateCandidateOwnerSchema>;

// ---------------------------------------------------------------------------
// Duplicates & merge
// ---------------------------------------------------------------------------

export const duplicateCheckSchema = z.object({
  email: emailSchema.nullable().optional(),
  phone: phoneSchema.nullable().optional(),
  linkedinUrl: urlSchema.nullable().optional(),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  currentCompany: z.string().trim().max(160).optional(),
  /** Exclude this candidate id from the check (used while editing). */
  excludeId: idSchema.optional(),
  /** Minimum trigram similarity for fuzzy name/company matches (0–1). */
  fuzzyThreshold: z.coerce.number().min(0.1).max(1).default(0.55),
});
export type DuplicateCheckRequest = z.infer<typeof duplicateCheckSchema>;

export const mergeCandidatesSchema = z.object({
  /** Record that survives. */
  primaryId: idSchema,
  /** Records absorbed into the primary, then soft-deleted. */
  duplicateIds: z.array(idSchema).min(1).max(20),
  /**
   * Per-field override: `{ field: '<candidateId>' }` forces the value from that
   * record. Anything not listed takes the primary's value, falling back to the
   * duplicates in order when the primary is empty.
   */
  fieldSources: z.record(z.string().trim().max(60)).default({}),
  /** Keep every email/phone/experience from the merged records. */
  keepAllChildRecords: z.boolean().default(true),
});
export type MergeCandidatesRequest = z.infer<typeof mergeCandidatesSchema>;

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const CANDIDATE_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'firstName',
  'lastName',
  'currentCompany',
  'expectedRateCents',
  'lastContactedAt',
  'rating',
] as const;

export const candidateQuerySchema = paginationQuerySchema.extend({
  status: z.union([candidateStatusSchema, z.array(candidateStatusSchema)]).optional(),
  source: z.union([candidateSourceSchema, z.array(candidateSourceSchema)]).optional(),
  ownerId: idSchema.optional(),
  listId: idSchema.optional(),
  jobId: idSchema.optional(),
  skillIds: csvIdsSchema.optional(),
  tags: csvIdsSchema.optional(),
  location: z.string().trim().max(120).optional(),
  experienceLevel: z.union([experienceLevelSchema, z.array(experienceLevelSchema)]).optional(),
  availability: z.union([availabilitySchema, z.array(availabilitySchema)]).optional(),
  workAuthorization: z
    .union([workAuthorizationSchema, z.array(workAuthorizationSchema)])
    .optional(),
  isHot: z.coerce.boolean().optional(),
  isArchived: z.coerce.boolean().optional(),
  hasResume: z.coerce.boolean().optional(),
  minExperienceMonths: z.coerce.number().int().min(0).optional(),
  maxExperienceMonths: z.coerce.number().int().min(0).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  myCandidates: z.coerce.boolean().default(false),
  sortBy: z.enum(CANDIDATE_SORT_FIELDS).default('createdAt'),
});
export type CandidateQuery = z.infer<typeof candidateQuerySchema>;

export interface CandidateListItemsSummary {
  id: string;
  name: string;
  color: string | null;
}

export interface CandidateListItem {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  /** Null unless the caller holds `candidate:view_pii`. */
  email: string | null;
  phone: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  location: string | null;
  experienceLevel: string | null;
  totalExperienceMonths: number | null;
  status: CandidateStatus;
  source: z.infer<typeof candidateSourceSchema>;
  isHot: boolean;
  isArchived: boolean;
  rating: number | null;
  owner: { id: string; fullName: string; avatarUrl: string | null } | null;
  tags: string[];
  skills: { id: string; name: string }[];
  lists: CandidateListItemsSummary[];
  hasResume: boolean;
  activeApplicationCount: number;
  lastContactedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateDetail extends CandidateListItem {
  alternatePhone: string | null;
  headline: string | null;
  summary: string | null;
  locationCity: string | null;
  locationState: string | null;
  locationCountry: string | null;
  willingToRelocate: boolean;
  relevantExperienceMonths: number | null;
  workAuthorization: z.infer<typeof workAuthorizationSchema>;
  workAuthorizationExpiresAt: string | null;
  availability: z.infer<typeof availabilitySchema> | null;
  availabilityDate: string | null;
  noticePeriodDays: number | null;
  expectedSalaryCents: number | null;
  expectedSalaryCurrency: string | null;
  currentSalaryCents: number | null;
  expectedRateCents: number | null;
  currentRateCents: number | null;
  ratePeriod: string | null;
  rateCurrency: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  websiteUrl: string | null;
  sourceDetail: string | null;
  customFields: Record<string, unknown>;
  emails: { id: string; address: string; label: string | null; isPrimary: boolean }[];
  phones: { id: string; number: string; label: string | null; isPrimary: boolean }[];
  experiences: {
    id: string;
    company: string;
    title: string;
    employmentType: string | null;
    location: string | null;
    startDate: string | null;
    endDate: string | null;
    isCurrent: boolean;
    description: string | null;
    skills: string[];
  }[];
  educations: {
    id: string;
    institution: string;
    degree: string | null;
    fieldOfStudy: string | null;
    startDate: string | null;
    endDate: string | null;
    grade: string | null;
    description: string | null;
  }[];
  candidateSkills: {
    skillId: string;
    name: string;
    years: number | null;
    level: number | null;
    isPrimary: boolean;
    lastUsedAt: string | null;
  }[];
  certifications: {
    id: string;
    name: string;
    issuer: string | null;
    issuedAt: string | null;
    expiresAt: string | null;
    credentialId: string | null;
    credentialUrl: string | null;
  }[];
  languages: { id: string; name: string; proficiency: z.infer<typeof skillProficiencySchema> }[];
  resumes: {
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    isPrimary: boolean;
    parseStatus: string;
    parsedAt: string | null;
    createdAt: string;
  }[];
  applications: {
    id: string;
    jobId: string;
    jobTitle: string;
    jobReferenceCode: string;
    stageId: string;
    stageName: string;
    stageColor: string;
    status: string;
    appliedAt: string;
  }[];
  lists: CandidateListItemsSummary[];
}

export interface CandidateDuplicateCandidate {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  currentCompany: string | null;
  owner: { id: string; fullName: string } | null;
  createdAt: string;
}

export interface CandidateDuplicateGroup {
  /** `EMAIL` | `PHONE` | `LINKEDIN` for exact hits, `FUZZY` for trigram matches. */
  matchType: 'EMAIL' | 'PHONE' | 'LINKEDIN' | 'FUZZY';
  /** Match quality for fuzzy hits; 1 for exact matches. */
  score: number;
  candidates: CandidateDuplicateCandidate[];
}

export interface CandidateDuplicateResponse {
  groups: CandidateDuplicateGroup[];
  scanned: number;
}

// ---------------------------------------------------------------------------
// Hotlists / talent pools
// ---------------------------------------------------------------------------

export const createCandidateListSchema = z.object({
  name: z.string().trim().min(1, 'Name the hotlist').max(80),
  description: z.string().trim().max(600).nullable().optional(),
  color: hexColorSchema.default('#6366f1'),
  visibility: visibilitySchema.default('TENANT'),
});
export type CreateCandidateListRequest = z.infer<typeof createCandidateListSchema>;

export const updateCandidateListSchema = createCandidateListSchema.partial();
export type UpdateCandidateListRequest = z.infer<typeof updateCandidateListSchema>;

export const candidateListMembershipSchema = z.object({
  candidateIds: z.array(idSchema).min(1).max(1000),
});
export type CandidateListMembershipRequest = z.infer<typeof candidateListMembershipSchema>;

export const candidateListQuerySchema = paginationQuerySchema.extend({
  mine: z.coerce.boolean().default(false),
  sortBy: z.enum(['createdAt', 'name', 'memberCount']).default('createdAt'),
});
export type CandidateListQuery = z.infer<typeof candidateListQuerySchema>;

export interface CandidateListSummary {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  visibility: z.infer<typeof visibilitySchema>;
  owner: { id: string; fullName: string; avatarUrl: string | null } | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}
