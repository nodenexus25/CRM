import { z } from 'zod';

import { entityTypeSchema, type EntityType } from './activity';
import { emailSchema, idSchema, paginationQuerySchema, sortDirSchema } from './common';
import { emailMessageStatusSchema, type EmailMessageStatus } from './enums';

/**
 * Email — tenant-authored templates, server-side merge rendering and the
 * outbound message log.
 *
 * Merge fields are a **whitelist**: a template may only reference a key the
 * renderer knows how to resolve, so a template can never read a column the
 * tenant has no business reading. The catalogue below is that whitelist and the
 * UI's insert menu, so the two can never drift apart.
 */

// ---------------------------------------------------------------------------
// Merge fields
// ---------------------------------------------------------------------------

export interface MergeFieldDefinition {
  /** Dotted key as it appears inside `{{ … }}`. */
  key: string;
  label: string;
}

export interface MergeFieldGroup {
  label: string;
  fields: readonly MergeFieldDefinition[];
}

export const MERGE_FIELD_GROUPS: readonly MergeFieldGroup[] = [
  {
    label: 'Candidate',
    fields: [
      { key: 'candidate.firstName', label: 'First name' },
      { key: 'candidate.lastName', label: 'Last name' },
      { key: 'candidate.fullName', label: 'Full name' },
      { key: 'candidate.email', label: 'Email' },
      { key: 'candidate.phone', label: 'Phone' },
      { key: 'candidate.headline', label: 'Headline' },
      { key: 'candidate.currentTitle', label: 'Current title' },
      { key: 'candidate.locationCity', label: 'City' },
    ],
  },
  {
    label: 'Job',
    fields: [
      { key: 'job.title', label: 'Title' },
      { key: 'job.referenceCode', label: 'Reference' },
      { key: 'job.locationCity', label: 'City' },
    ],
  },
  {
    label: 'Client',
    fields: [
      { key: 'client.name', label: 'Client name' },
      { key: 'client.industry', label: 'Industry' },
      { key: 'contact.firstName', label: 'Contact first name' },
      { key: 'contact.lastName', label: 'Contact last name' },
      { key: 'contact.fullName', label: 'Contact full name' },
      { key: 'contact.email', label: 'Contact email' },
    ],
  },
  {
    label: 'Interview',
    fields: [
      { key: 'interview.scheduledStart', label: 'Scheduled start' },
      { key: 'interview.meetingUrl', label: 'Join link' },
    ],
  },
  {
    label: 'Sender & workspace',
    fields: [
      { key: 'sender.fullName', label: 'Your name' },
      { key: 'sender.email', label: 'Your email' },
      { key: 'tenant.name', label: 'Workspace name' },
      { key: 'today', label: 'Today’s date' },
    ],
  },
];

const MERGE_FIELD_KEY_SET = new Set(
  MERGE_FIELD_GROUPS.flatMap((group) => group.fields.map((field) => field.key)),
);

/** Every key a template is allowed to reference, in catalogue order. */
export const MERGE_FIELD_KEYS: readonly string[] = [...MERGE_FIELD_KEY_SET];

export function isMergeField(key: string): boolean {
  return MERGE_FIELD_KEY_SET.has(key);
}

/** Matches `{{ candidate.firstName }}`, tolerating whitespace on both sides. */
export const MERGE_FIELD_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Returns every distinct merge key used in a string, in first-seen order. */
export function extractMergeFields(...sources: string[]): string[] {
  const found: string[] = [];
  for (const source of sources) {
    for (const match of source.matchAll(MERGE_FIELD_PATTERN)) {
      const key = match[1];
      if (key && !found.includes(key)) found.push(key);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const EMAIL_TEMPLATE_CATEGORIES = [
  'GENERAL',
  'SOURCING',
  'SUBMISSION',
  'INTERVIEW',
  'OFFER',
  'PLACEMENT',
] as const;
export const emailTemplateCategorySchema = z.enum(EMAIL_TEMPLATE_CATEGORIES);
export type EmailTemplateCategory = z.infer<typeof emailTemplateCategorySchema>;

/** Unique slug, e.g. `candidate.outreach`. Lower-case, dot/dash separated. */
export const emailTemplateKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(64)
  .regex(
    /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])$/,
    'Use lower-case letters, numbers, dots, dashes or underscores',
  );

export const createEmailTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Give the template a name').max(120),
  key: emailTemplateKeySchema,
  subject: z.string().trim().min(1, 'A template needs a subject').max(300),
  body: z.string().trim().min(1, 'A template needs a body').max(50000),
  htmlBody: z.string().trim().max(100000).nullable().optional(),
  category: emailTemplateCategorySchema.default('GENERAL'),
  /** Left empty, the server derives them from the subject and body. */
  mergeFields: z.array(z.string().trim().max(64)).max(50).optional(),
  isActive: z.boolean().default(true),
});
export type CreateEmailTemplateRequest = z.infer<typeof createEmailTemplateSchema>;

export const updateEmailTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Give the template a name').max(120).optional(),
  subject: z.string().trim().min(1, 'A template needs a subject').max(300).optional(),
  body: z.string().trim().min(1, 'A template needs a body').max(50000).optional(),
  htmlBody: z.string().trim().max(100000).nullable().optional(),
  category: emailTemplateCategorySchema.optional(),
  mergeFields: z.array(z.string().trim().max(64)).max(50).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateEmailTemplateRequest = z.infer<typeof updateEmailTemplateSchema>;

export const emailTemplateQuerySchema = paginationQuerySchema.extend({
  category: emailTemplateCategorySchema.optional(),
  isActive: z.coerce.boolean().optional(),
  sortBy: z.enum(['name', 'createdAt', 'updatedAt']).default('name'),
  sortDir: sortDirSchema.default('asc'),
});
export type EmailTemplateQuery = z.infer<typeof emailTemplateQuerySchema>;

export interface EmailTemplateItem {
  id: string;
  name: string;
  key: string;
  subject: string;
  body: string;
  htmlBody: string | null;
  category: EmailTemplateCategory;
  mergeFields: string[];
  /** Shipped with the workspace — deactivatable, never deletable. */
  isSystem: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * Send a message either from a template (`templateId` + `mergeData`) or
 * verbatim (`subject` + `body`). `mergeData` supplies `interview.*` values the
 * server cannot infer from the linked record.
 */
export const sendEmailSchema = z
  .object({
    to: z.array(emailSchema).min(1, 'Add at least one recipient').max(50),
    cc: z.array(emailSchema).max(50).default([]),
    bcc: z.array(emailSchema).max(50).default([]),
    subject: z.string().trim().min(1).max(300).optional(),
    body: z.string().trim().max(50000).optional(),
    templateId: idSchema.optional(),
    /** Values for merge keys that are not resolvable from the linked entity. */
    mergeData: z.record(z.string(), z.string().max(2000)).optional(),
    replyTo: emailSchema.optional(),
    entityType: entityTypeSchema.optional(),
    entityId: idSchema.optional(),
    candidateId: idSchema.nullable().optional(),
    jobId: idSchema.nullable().optional(),
  })
  .refine((value) => Boolean(value.templateId) || Boolean(value.subject && value.body), {
    message: 'Pick a template, or write both a subject and a body.',
    path: ['templateId'],
  });
export type SendEmailRequest = z.infer<typeof sendEmailSchema>;

/**
 * What the compose dialog asks for before sending — the same inputs, minus the
 * recipients, so the preview and the send can never disagree.
 */
export const previewEmailSchema = z.object({
  templateId: idSchema.optional(),
  subject: z.string().trim().max(300).optional(),
  body: z.string().trim().max(50000).optional(),
  mergeData: z.record(z.string(), z.string().max(2000)).optional(),
  entityType: entityTypeSchema.optional(),
  entityId: idSchema.optional(),
  candidateId: idSchema.nullable().optional(),
  jobId: idSchema.nullable().optional(),
});
export type PreviewEmailRequest = z.infer<typeof previewEmailSchema>;

export interface EmailPreview {
  subject: string;
  body: string;
  /** Keys the template references but the server could not resolve. */
  missingFields: string[];
}

// ---------------------------------------------------------------------------
// Message log
// ---------------------------------------------------------------------------

export const emailMessageQuerySchema = paginationQuerySchema.extend({
  status: z.union([emailMessageStatusSchema, z.array(emailMessageStatusSchema)]).optional(),
  entityType: entityTypeSchema.optional(),
  entityId: idSchema.optional(),
  candidateId: idSchema.optional(),
  templateId: idSchema.optional(),
  sortBy: z.enum(['createdAt', 'sentAt']).default('createdAt'),
  sortDir: sortDirSchema.default('desc'),
});
export type EmailMessageQuery = z.infer<typeof emailMessageQuerySchema>;

export interface EmailMessageItem {
  id: string;
  direction: string;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses: string[];
  replyTo: string | null;
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  status: EmailMessageStatus;
  error: string | null;
  messageId: string | null;
  template: { id: string; name: string; key: string } | null;
  entityType: EntityType | null;
  entityId: string | null;
  candidateId: string | null;
  jobId: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  createdBy: { id: string; fullName: string; avatarUrl: string | null } | null;
  createdAt: string;
  updatedAt: string;
}
