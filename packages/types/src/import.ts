import { z } from 'zod';

import { idSchema, paginationQuerySchema } from './common';
import { importEntityTypeSchema, importStatusSchema } from './enums';

export const duplicateStrategySchema = z.enum(['SKIP', 'UPDATE', 'CREATE']);
export type DuplicateStrategy = z.infer<typeof duplicateStrategySchema>;
export const DUPLICATE_STRATEGY_LABELS: Record<DuplicateStrategy, string> = {
  SKIP: 'Skip duplicates',
  UPDATE: 'Update existing records',
  CREATE: 'Always create a new record',
};
export const DUPLICATE_STRATEGY_HINTS: Record<DuplicateStrategy, string> = {
  SKIP: 'Rows that match an existing record are counted as skipped.',
  UPDATE: 'Rows that match an existing record overwrite its mapped fields.',
  CREATE: 'A new record is created for every row, even if it looks like a duplicate.',
};

/** Human labels for the entity being imported. */
export const IMPORT_ENTITY_TYPE_LABELS: Record<
  z.infer<typeof importEntityTypeSchema>,
  string
> = {
  CANDIDATE: 'Candidates',
  CLIENT: 'Clients',
  JOB: 'Jobs',
  CONTACT: 'Client contacts',
};

/** Singular noun used in progress copy, e.g. "3 candidates created". */
export const IMPORT_ENTITY_NOUN: Record<z.infer<typeof importEntityTypeSchema>, string> = {
  CANDIDATE: 'candidate',
  CLIENT: 'client',
  JOB: 'requisition',
  CONTACT: 'contact',
};

export const IMPORT_STATUS_LABELS: Record<z.infer<typeof importStatusSchema>, string> = {
  PENDING: 'Awaiting mapping',
  MAPPING: 'Mapping',
  PROCESSING: 'Importing',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

/** The file extensions the wizard accepts for a given entity. */
export const IMPORT_FILE_ACCEPT = '.csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** A mappable destination field offered by the wizard. */
export interface ImportFieldDefinition {
  key: string;
  label: string;
  required: boolean;
  /** `TEXT` | `NUMBER` | `DATE` | `BOOLEAN` | `EMAIL` | `PHONE` | `SELECT` */
  type: string;
  description?: string;
}

/**
 * Fields the wizard can map onto, per entity. The API exposes this via
 * `GET /imports/fields?entity=` so the client never hard-codes the list.
 */
export const IMPORT_FIELD_DEFINITIONS: Record<
  z.infer<typeof importEntityTypeSchema>,
  readonly ImportFieldDefinition[]
> = {
  CANDIDATE: [
    { key: 'firstName', label: 'First name', required: true, type: 'TEXT' },
    { key: 'lastName', label: 'Last name', required: true, type: 'TEXT' },
    { key: 'email', label: 'Email', required: false, type: 'EMAIL' },
    { key: 'phone', label: 'Phone', required: false, type: 'PHONE' },
    { key: 'currentTitle', label: 'Current title', required: false, type: 'TEXT' },
    { key: 'currentCompany', label: 'Current company', required: false, type: 'TEXT' },
    { key: 'locationCity', label: 'City', required: false, type: 'TEXT' },
    { key: 'locationState', label: 'State', required: false, type: 'TEXT' },
    { key: 'locationCountry', label: 'Country', required: false, type: 'TEXT' },
    { key: 'linkedinUrl', label: 'LinkedIn URL', required: false, type: 'TEXT' },
    { key: 'totalExperienceMonths', label: 'Total experience (months)', required: false, type: 'NUMBER' },
    { key: 'expectedSalaryCents', label: 'Expected salary (minor units)', required: false, type: 'NUMBER' },
    { key: 'availabilityDate', label: 'Available from', required: false, type: 'DATE' },
    { key: 'source', label: 'Source', required: false, type: 'SELECT' },
    { key: 'tags', label: 'Tags', required: false, type: 'TEXT', description: 'Comma or semicolon separated' },
    { key: 'skills', label: 'Skills', required: false, type: 'TEXT', description: 'Comma or semicolon separated' },
  ],
  CLIENT: [
    { key: 'name', label: 'Company name', required: true, type: 'TEXT' },
    { key: 'legalName', label: 'Legal name', required: false, type: 'TEXT' },
    { key: 'industry', label: 'Industry', required: false, type: 'TEXT' },
    { key: 'website', label: 'Website', required: false, type: 'TEXT' },
    { key: 'phone', label: 'Phone', required: false, type: 'PHONE' },
    { key: 'city', label: 'City', required: false, type: 'TEXT' },
    { key: 'country', label: 'Country', required: false, type: 'TEXT' },
  ],
  JOB: [
    { key: 'title', label: 'Job title', required: true, type: 'TEXT' },
    { key: 'clientName', label: 'Client name', required: false, type: 'TEXT' },
    { key: 'description', label: 'Description', required: false, type: 'TEXT' },
    { key: 'locationCity', label: 'City', required: false, type: 'TEXT' },
    { key: 'status', label: 'Status', required: false, type: 'SELECT' },
    { key: 'openings', label: 'Openings', required: false, type: 'NUMBER' },
    { key: 'targetFillAt', label: 'Target fill date', required: false, type: 'DATE' },
  ],
  CONTACT: [
    { key: 'firstName', label: 'First name', required: true, type: 'TEXT' },
    { key: 'lastName', label: 'Last name', required: true, type: 'TEXT' },
    { key: 'email', label: 'Email', required: false, type: 'EMAIL' },
    { key: 'phone', label: 'Phone', required: false, type: 'PHONE' },
    { key: 'clientName', label: 'Client company', required: false, type: 'TEXT' },
    { key: 'title', label: 'Job title', required: false, type: 'TEXT' },
  ],
};

// ---------------------------------------------------------------------------
// Wizard steps
// ---------------------------------------------------------------------------

export const importUploadQuerySchema = z.object({
  entity: importEntityTypeSchema,
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(160),
  sizeBytes: z.coerce.number().int().min(1).max(50 * 1024 * 1024),
});
export type ImportUploadQuery = z.infer<typeof importUploadQuerySchema>;

/**
 * Presigned-upload handshake. The browser `PUT`s the file straight to storage
 * (the API never proxies the bytes) and then drives the wizard against the
 * returned `importJobId`.
 */
export interface ImportUploadTicket {
  importJobId: string;
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresInSeconds: number;
}

/** A ready-to-fill CSV with the canonical headers for an entity. */
export interface ImportSampleTemplate {
  entity: z.infer<typeof importEntityTypeSchema>;
  fileName: string;
  mimeType: string;
  /** Raw CSV text; the client turns it into a download. */
  content: string;
}

export const importMappingSchema = z.object({
  /** `{ "<csvHeader>": "<fieldKey>" | "__skip__" }` */
  mapping: z.record(z.string().trim().max(64)).default({}),
  options: z
    .object({
      duplicateStrategy: duplicateStrategySchema.default('SKIP'),
      /** Treat the first row as headers (default) or as data. */
      hasHeaderRow: z.boolean().default(true),
      /** Default owner applied to every created row. */
      ownerId: idSchema.nullable().optional(),
      /** Default source applied when the file has no source column. */
      defaultSource: z.string().trim().max(60).nullable().optional(),
      /** Tag applied to every imported row. */
      tag: z.string().trim().max(60).nullable().optional(),
    })
    .default({}),
});
export type ImportMappingRequest = z.infer<typeof importMappingSchema>;

export const importRunSchema = importMappingSchema.extend({
  /** Save the current mapping as a reusable template. */
  saveAsTemplate: z.string().trim().min(1).max(80).nullable().optional(),
});
export type ImportRunRequest = z.infer<typeof importRunSchema>;

export const importPreviewQuerySchema = z.object({
  /** Number of sample rows to validate; capped so a huge file stays cheap. */
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ImportPreviewQuery = z.infer<typeof importPreviewQuerySchema>;

export const importJobQuerySchema = paginationQuerySchema.extend({
  entity: importEntityTypeSchema.optional(),
  status: z.union([importStatusSchema, z.array(importStatusSchema)]).optional(),
  sortBy: z.enum(['createdAt', 'completedAt', 'status']).default('createdAt'),
});
export type ImportJobQuery = z.infer<typeof importJobQuerySchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface ImportPreviewRow {
  rowNumber: number;
  values: Record<string, string>;
  /** Normalised values after mapping + coercion, ready for insert. */
  mapped: Record<string, unknown>;
  errors: { field: string; message: string }[];
  /** Duplicate hit against an existing record, if any. */
  duplicateOf: { id: string; label: string } | null;
}

export interface ImportPreviewResponse {
  headers: string[];
  rows: ImportPreviewRow[];
  /** Detected/auto-suggested mapping before the user edits it. */
  suggestedMapping: Record<string, string>;
  totalRowsSampled: number;
  validRows: number;
  invalidRows: number;
}

export interface ImportJobSummary {
  id: string;
  entity: z.infer<typeof importEntityTypeSchema>;
  status: z.infer<typeof importStatusSchema>;
  fileName: string;
  totalRows: number;
  processedRows: number;
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  failedRows: number;
  progress: number;
  errors: { row: number; field: string; message: string }[];
  startedAt: string | null;
  completedAt: string | null;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const createImportTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  entity: importEntityTypeSchema,
  mapping: z.record(z.string().trim().max(64)).default({}),
  options: z.record(z.unknown()).default({}),
});
export type CreateImportTemplateRequest = z.infer<typeof createImportTemplateSchema>;

export const updateImportTemplateSchema = createImportTemplateSchema.partial();
export type UpdateImportTemplateRequest = z.infer<typeof updateImportTemplateSchema>;

export const importTemplateQuerySchema = z.object({
  entity: importEntityTypeSchema.optional(),
});
export type ImportTemplateQuery = z.infer<typeof importTemplateQuerySchema>;

export interface ImportTemplateSummary {
  id: string;
  name: string;
  entity: z.infer<typeof importEntityTypeSchema>;
  mapping: Record<string, string>;
  options: Record<string, unknown>;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
}
