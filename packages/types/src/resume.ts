import { z } from 'zod';

import type { CandidateDetail } from './candidate';
import { emailSchema, idSchema, nameSchema, paginationQuerySchema, phoneSchema } from './common';
import {
  candidateSourceSchema,
  experienceLevelSchema,
  resumeParseStatusSchema,
  skillProficiencySchema,
  type ResumeParseStatus,
} from './enums';

/**
 * Resume parsing (Phase 2, Module 5).
 *
 * The contract is split in two halves:
 *
 *  - the **upload** half (`resumeUploadRequestSchema`, `ResumeUploadTicket`)
 *    that drives a direct-to-storage presigned `PUT`; and
 *  - the **parse** half (`parsedResumeSchema`, `ResumeDetail`, `acceptResumeSchema`)
 *    that models what the parser extracts and how a reviewer folds it into a
 *    candidate.
 *
 * `parsedResumeSchema` is deliberately forgiving on input — every field is
 * optional and normalised (empty strings become `null`, numeric strings become
 * numbers) — because it validates the free-form JSON an LLM returns. Anything it
 * cannot accept falls back to the deterministic regex parser.
 */

// ---------------------------------------------------------------------------
// Upload contract
// ---------------------------------------------------------------------------

/** Hard ceiling for a single resume file: 10 MB. */
export const RESUME_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Accepted resume uploads, keyed by MIME type. Each entry lists the file
 * extensions that type may legitimately arrive under; the extension/MIME
 * cross-check in `resumeUploadRequestSchema` is what stops a `.exe` renamed to
 * `.pdf` from being accepted on the declared type alone.
 */
export const RESUME_MIME_TYPES: Record<string, readonly string[]> = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/msword': ['.doc'],
  'text/plain': ['.txt'],
  'application/rtf': ['.rtf'],
  'text/rtf': ['.rtf'],
};

export type ResumeMimeType = keyof typeof RESUME_MIME_TYPES;

export const SUPPORTED_RESUME_MIME_TYPES: readonly string[] = Object.keys(RESUME_MIME_TYPES);

export interface ResumeFileTypeOption {
  mimeType: string;
  label: string;
  extensions: readonly string[];
}

/** UI-facing catalogue of what the upload widget may offer. */
export const RESUME_FILE_TYPES: readonly ResumeFileTypeOption[] = [
  { mimeType: 'application/pdf', label: 'PDF', extensions: ['.pdf'] },
  {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'Word (DOCX)',
    extensions: ['.docx'],
  },
  { mimeType: 'application/msword', label: 'Word (DOC)', extensions: ['.doc'] },
  { mimeType: 'text/plain', label: 'Plain text', extensions: ['.txt'] },
  { mimeType: 'application/rtf', label: 'Rich text (RTF)', extensions: ['.rtf'] },
];

/** Extension of a file name, lower-cased and including the dot. `''` when none. */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

export function isSupportedResumeMimeType(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(RESUME_MIME_TYPES, mimeType);
}

/** True when `mimeType` is accepted and `fileName` carries a matching extension. */
export function isResumeFileAllowed(fileName: string, mimeType: string): boolean {
  const extensions = RESUME_MIME_TYPES[mimeType];
  if (!extensions) return false;
  return extensions.includes(fileExtension(fileName));
}

export const resumeUploadRequestSchema = z
  .object({
    fileName: z.string().trim().min(1, 'Choose a file to upload').max(255),
    mimeType: z.string().trim().min(1).max(160),
    sizeBytes: z.coerce.number().int().min(1).max(RESUME_MAX_BYTES),
  })
  .superRefine((value, ctx) => {
    const extensions = RESUME_MIME_TYPES[value.mimeType];
    if (!extensions) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mimeType'],
        message: 'Unsupported file type. Upload a PDF, DOCX, DOC, TXT or RTF file.',
      });
      return;
    }
    if (!extensions.includes(fileExtension(value.fileName))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fileName'],
        message: 'The file extension does not match the declared content type.',
      });
    }
  });
export type ResumeUploadRequest = z.infer<typeof resumeUploadRequestSchema>;

/** Everything the browser needs to `PUT` the file straight to object storage. */
export interface ResumeUploadTicket {
  resumeId: string;
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresInSeconds: number;
}

/**
 * Sent once the browser finishes the presigned `PUT`, which is what tells the
 * API the object is in place and the parse job may be queued. `candidateId`
 * attaches the resume to an existing profile at upload time; omit it to leave
 * the upload detached for review.
 */
export const completeResumeUploadSchema = z.object({
  candidateId: idSchema.optional(),
});
export type CompleteResumeUploadRequest = z.infer<typeof completeResumeUploadSchema>;

// ---------------------------------------------------------------------------
// Parser output
// ---------------------------------------------------------------------------

/** Normalises the loose shapes an LLM returns: `'' → null`, numeric strings → numbers. */
const optionalText = (max: number) =>
  z
    .preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
      z.string().trim().max(max).nullable(),
    )
    .default(null);

const optionalInt = (min: number, max: number) =>
  z
    .preprocess((value) => {
      if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
        return Number(value);
      }
      return value;
    }, z.number().int().min(min).max(max).nullable())
    .default(null);

const optionalDate = () =>
  z.preprocess((value) => (value === '' ? null : value), z.coerce.date().nullable()).default(null);

export const parsedResumeSkillSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    years: optionalInt(0, 60),
    /** Self-assessed 1–5, when the parser can infer it. */
    level: optionalInt(1, 5),
  })
  .strict();

export const parsedResumeExperienceSchema = z
  .object({
    company: optionalText(200),
    title: optionalText(200),
    employmentType: optionalText(60),
    location: optionalText(160),
    startDate: optionalDate(),
    endDate: optionalDate(),
    isCurrent: z.coerce.boolean().default(false),
    description: optionalText(8000),
    skills: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  })
  .strict();

export const parsedResumeEducationSchema = z
  .object({
    institution: optionalText(200),
    degree: optionalText(160),
    fieldOfStudy: optionalText(160),
    startDate: optionalDate(),
    endDate: optionalDate(),
    grade: optionalText(60),
    description: optionalText(4000),
  })
  .strict();

export const parsedResumeCertificationSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    issuer: optionalText(160),
    issuedAt: optionalDate(),
    expiresAt: optionalDate(),
    credentialId: optionalText(120),
    credentialUrl: optionalText(500),
  })
  .strict();

export const parsedResumeLanguageSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    proficiency: skillProficiencySchema.default('PROFESSIONAL'),
  })
  .strict();

export const parsedResumeSchema = z
  .object({
    fullName: optionalText(200),
    firstName: optionalText(120),
    lastName: optionalText(120),
    email: optionalText(254),
    phone: optionalText(40),
    locationCity: optionalText(120),
    locationState: optionalText(120),
    locationCountry: optionalText(120),
    linkedinUrl: optionalText(500),
    githubUrl: optionalText(500),
    websiteUrl: optionalText(500),
    headline: optionalText(200),
    summary: optionalText(8000),
    totalExperienceMonths: optionalInt(0, 840),
    skills: z.array(parsedResumeSkillSchema).max(120).default([]),
    experiences: z.array(parsedResumeExperienceSchema).max(60).default([]),
    educations: z.array(parsedResumeEducationSchema).max(40).default([]),
    certifications: z.array(parsedResumeCertificationSchema).max(60).default([]),
    languages: z.array(parsedResumeLanguageSchema).max(30).default([]),
  })
  .strict();
export type ParsedResume = z.infer<typeof parsedResumeSchema>;

/**
 * A raw skill resolved against the tenant's skill dictionary. `skillId` is the
 * tenant `Skill` row (created on demand at accept time), while `matchedName` is
 * the canonical dictionary spelling the free-text `name` resolved to.
 */
export const normalizedResumeSkillSchema = z.object({
  name: z.string().trim().min(1).max(120),
  matchedName: z.string().trim().min(1).max(120),
  skillId: z.string().nullable().default(null),
  category: z.string().nullable().default(null),
  years: z.number().int().min(0).max(60).nullable().default(null),
  level: z.number().int().min(1).max(5).nullable().default(null),
});
export type NormalizedResumeSkill = z.infer<typeof normalizedResumeSkillSchema>;

/** Exactly what is persisted in `CandidateResume.parsedData`. */
export const resumeParsedDataSchema = parsedResumeSchema.extend({
  normalizedSkills: z.array(normalizedResumeSkillSchema).max(120).default([]),
});
export type ResumeParsedData = z.infer<typeof resumeParsedDataSchema>;

// ---------------------------------------------------------------------------
// Read shapes
// ---------------------------------------------------------------------------

export interface ResumeSummary {
  id: string;
  /** Null until the resume is accepted onto a candidate. */
  candidateId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isPrimary: boolean;
  version: number;
  parseStatus: ResumeParseStatus;
  parserUsed: string | null;
  parserConfidence: number | null;
  parsedAt: string | null;
  uploadedBy: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResumeDetail extends ResumeSummary {
  storageKey: string;
  extractedText: string | null;
  parsedData: ResumeParsedData | null;
  /** Mirrors `parsedData.normalizedSkills` for clients that render skills alone. */
  normalizedSkills: NormalizedResumeSkill[];
  parseError: string | null;
  parseDurationMs: number | null;
  /** Time-limited download link; null when storage could not be reached. */
  downloadUrl: string | null;
}

export const RESUME_SORT_FIELDS = ['createdAt', 'updatedAt', 'fileName', 'parseStatus'] as const;

export const resumeQuerySchema = paginationQuerySchema.extend({
  candidateId: idSchema.optional(),
  status: z.union([resumeParseStatusSchema, z.array(resumeParseStatusSchema)]).optional(),
  /** Only resumes that are not yet attached to a candidate. */
  unattached: z.coerce.boolean().default(false),
  sortBy: z.enum(RESUME_SORT_FIELDS).default('createdAt'),
});
export type ResumeQuery = z.infer<typeof resumeQuerySchema>;

// ---------------------------------------------------------------------------
// Accept (review-and-confirm)
// ---------------------------------------------------------------------------

export const resumeAcceptSectionsSchema = z.object({
  profile: z.boolean().default(true),
  skills: z.boolean().default(true),
  experiences: z.boolean().default(true),
  educations: z.boolean().default(true),
  certifications: z.boolean().default(true),
  languages: z.boolean().default(true),
});
export type ResumeAcceptSections = z.infer<typeof resumeAcceptSectionsSchema>;

/** UI labels for the review dialog's include/exclude toggles. */
export const RESUME_ACCEPT_SECTION_LABELS: Record<keyof ResumeAcceptSections, string> = {
  profile: 'Profile',
  skills: 'Skills',
  experiences: 'Experience',
  educations: 'Education',
  certifications: 'Certifications',
  languages: 'Languages',
};

/** Per-field corrections a reviewer makes before accepting a parse. */
export const resumeAcceptOverridesSchema = z.object({
  firstName: nameSchema.nullable().optional(),
  lastName: nameSchema.nullable().optional(),
  email: emailSchema.nullable().optional(),
  phone: phoneSchema.nullable().optional(),
  headline: z.string().trim().max(200).nullable().optional(),
  summary: z.string().trim().max(8000).nullable().optional(),
  currentTitle: z.string().trim().max(160).nullable().optional(),
  currentCompany: z.string().trim().max(160).nullable().optional(),
  locationCity: z.string().trim().max(120).nullable().optional(),
  locationState: z.string().trim().max(120).nullable().optional(),
  locationCountry: z.string().trim().max(120).nullable().optional(),
  totalExperienceMonths: z.coerce.number().int().min(0).max(840).nullable().optional(),
  experienceLevel: experienceLevelSchema.nullable().optional(),
  ownerId: idSchema.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
});
export type ResumeAcceptOverrides = z.infer<typeof resumeAcceptOverridesSchema>;

export const acceptResumeSchema = z.object({
  /** Attach to an existing candidate. Omit to create a candidate from the parse. */
  candidateId: idSchema.optional(),
  sections: resumeAcceptSectionsSchema.default({}),
  overrides: resumeAcceptOverridesSchema.default({}),
  /** Marks this resume primary and demotes the candidate's other resumes. */
  makePrimary: z.boolean().default(true),
  /** Source recorded when a new candidate is created. */
  source: candidateSourceSchema.default('IMPORT'),
  /** Create a candidate even when a likely duplicate exists. */
  allowDuplicate: z.boolean().default(false),
});
export type AcceptResumeRequest = z.infer<typeof acceptResumeSchema>;

export interface AcceptResumeApplied {
  profile: boolean;
  skills: number;
  experiences: number;
  educations: number;
  certifications: number;
  languages: number;
}

export interface AcceptResumeResponse {
  resumeId: string;
  candidateId: string;
  /** True when this acceptance created the candidate. */
  created: boolean;
  applied: AcceptResumeApplied;
  candidate: CandidateDetail;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const resumeParserChoiceSchema = z.enum(['auto', 'llm', 'regex']);
export type ResumeParserChoice = z.infer<typeof resumeParserChoiceSchema>;

export const reparseResumeSchema = z.object({
  /** `auto` lets the server pick based on provider config. */
  parser: resumeParserChoiceSchema.default('auto'),
});
export type ReparseResumeRequest = z.infer<typeof reparseResumeSchema>;

export const updateResumeSchema = z.object({
  fileName: z.string().trim().min(1).max(255).optional(),
  isPrimary: z.boolean().optional(),
});
export type UpdateResumeRequest = z.infer<typeof updateResumeSchema>;
