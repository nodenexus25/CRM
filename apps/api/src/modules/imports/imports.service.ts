import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type ImportJob, type ImportTemplate } from '@prisma/client';
import type { Queue } from 'bullmq';

import {
  IMPORT_ENTITY_TYPE_LABELS,
  IMPORT_FIELD_DEFINITIONS,
  buildPaginationMeta,
  toSkipTake,
  type CreateImportTemplateRequest,
  type DuplicateStrategy,
  type ImportEntityType,
  type ImportFieldDefinition,
  type ImportJobQuery,
  type ImportJobSummary,
  type ImportMappingRequest,
  type ImportPreviewResponse,
  type ImportPreviewRow,
  type ImportRunRequest,
  type ImportSampleTemplate,
  type ImportTemplateQuery,
  type ImportTemplateSummary,
  type ImportUploadQuery,
  type ImportUploadTicket,
  type Paginated,
  type PermissionKey,
  type UpdateImportTemplateRequest,
} from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/common/errors/domain-errors';
import { createRequestContext, requestContext } from '@/common/request-context';
import { toCsv, type ParsedCsv } from '@/common/utils/csv';
import type { AppConfig } from '@/config/configuration';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { QUEUE_NAMES, type ImportJobPayload } from '@/infra/queue/queue.constants';
import { StorageService } from '@/infra/storage/storage.service';

import { readTabularFile } from './import-file-reader';
import { coerceRow, suggestMapping } from './import-fields';
import { ImportWriter, type ImportWriteOptions } from './import-writer';

/**
 * CSV/Excel import (Phase 2, Module 7).
 *
 * The wizard is a four-step flow over a single `ImportJob` row:
 *
 *  1. **upload-url** — hand the browser a presigned `PUT` and create a
 *     `PENDING` row. The API never proxies the bytes.
 *  2. **preview** — re-read the object from storage, auto-suggest a column
 *     mapping and validate a sample of rows, so the user sees exactly what the
 *     run will do before committing.
 *  3. **run** — persist the mapping, optionally save it as a template, and
 *     enqueue the row-by-row work.
 *  4. **runImport** (worker) — apply the rows in batches, writing an error CSV
 *     so the user can download and fix the rejects.
 */

/** Every permission any import route may require, for `@RequireAnyPermission`. */
export const IMPORT_ANY_PERMISSIONS = [
  'import:create',
  'candidate:import',
  'candidate:create',
  'client:create',
  'job:create',
  'contact:create',
] as const;

/**
 * The permission set a write to each entity requires. The route advertises the
 * union (a static decorator cannot see the entity, which lives in the body or
 * the row), so the exact set is re-checked here before anything is written.
 */
export const IMPORT_ENTITY_PERMISSIONS: Record<ImportEntityType, readonly PermissionKey[]> = {
  CANDIDATE: ['import:create', 'candidate:import'],
  CLIENT: ['import:create', 'client:create'],
  JOB: ['import:create', 'job:create'],
  CONTACT: ['import:create', 'contact:create'],
};

const IMPORT_STORAGE_PREFIX = 'imports';
/** Rows per batch. Bounds the work between progress writes. */
const IMPORT_BATCH_SIZE = 500;
/** Only the first failures are kept on the row; the counters hold the whole truth. */
const IMPORT_MAX_STORED_ERRORS = 500;

/** The subset of wizard options that affects persistence. */
interface ResolvedOptions extends ImportWriteOptions {
  hasHeaderRow: boolean;
}

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly writer: ImportWriter,
    private readonly config: ConfigService<AppConfig, true>,
    @InjectQueue(QUEUE_NAMES.import) private readonly importQueue: Queue<ImportJobPayload>,
  ) {}

  // ---------------------------------------------------------------------------
  // Wizard metadata
  // ---------------------------------------------------------------------------

  /** The mappable fields for an entity, in the order the wizard renders them. */
  fields(entity: ImportEntityType): ImportFieldDefinition[] {
    return [...IMPORT_FIELD_DEFINITIONS[entity]];
  }

  /** A ready-to-fill CSV with the canonical headers and a couple of example rows. */
  sample(entity: ImportEntityType): ImportSampleTemplate {
    const headers = IMPORT_FIELD_DEFINITIONS[entity].map((field) => field.label);
    const content = toCsv([headers, ...SAMPLE_ROWS[entity]]);
    return {
      entity,
      fileName: `${entity.toLowerCase()}-sample.csv`,
      mimeType: 'text/csv',
      content,
    };
  }

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------

  async listTemplates(query: ImportTemplateQuery): Promise<ImportTemplateSummary[]> {
    const where: Prisma.ImportTemplateWhereInput = { deletedAt: null };
    if (query.entity) where.entity = query.entity;

    const rows = await this.prisma.client.importTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    const creators = await this.loadCreators(rows.map((row) => row.createdById));

    return rows.map((row) => toTemplateSummary(row, creators.get(row.createdById ?? '') ?? null));
  }

  async createTemplate(input: CreateImportTemplateRequest): Promise<ImportTemplateSummary> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;

    const clash = await this.prisma.client.importTemplate.findFirst({
      where: { entity: input.entity, name: input.name, deletedAt: null },
      select: { id: true },
    });
    if (clash) throw templateNameConflict();

    try {
      const row = await this.prisma.client.importTemplate.create({
        data: {
          tenantId,
          name: input.name,
          entity: input.entity,
          mapping: input.mapping as Prisma.InputJsonValue,
          options: input.options as Prisma.InputJsonValue,
          createdById: userId,
        },
      });
      return toTemplateSummary(row, await this.creator(userId));
    } catch (error) {
      if (isUniqueViolation(error)) throw templateNameConflict();
      throw error;
    }
  }

  async updateTemplate(id: string, input: UpdateImportTemplateRequest): Promise<ImportTemplateSummary> {
    const existing = await this.findTemplateOrFail(id);

    const data: Prisma.ImportTemplateUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.entity !== undefined) data.entity = input.entity;
    if (input.mapping !== undefined) data.mapping = input.mapping as Prisma.InputJsonValue;
    if (input.options !== undefined) data.options = input.options as Prisma.InputJsonValue;

    try {
      const row = await this.prisma.client.importTemplate.update({ where: { id }, data });
      return toTemplateSummary(row, await this.creator(row.createdById));
    } catch (error) {
      if (isUniqueViolation(error)) throw templateNameConflict();
      throw error;
    } finally {
      void existing;
    }
  }

  async removeTemplate(id: string): Promise<{ deleted: true }> {
    await this.findTemplateOrFail(id);

    await this.prisma.client.importTemplate.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      action: 'DELETE',
      entity: 'ImportTemplate',
      entityId: id,
      description: 'Removed an import template',
    });

    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------------------

  /** Creates the job row and hands back a presigned `PUT` for the browser. */
  async createUploadTicket(query: ImportUploadQuery): Promise<ImportUploadTicket> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;
    this.assertEntityPermission(query.entity);

    const ttl = this.config.get('storage', { infer: true }).signedUrlTtl;
    const storageKey = this.storage.buildKey(IMPORT_STORAGE_PREFIX, tenantId, query.fileName);
    // Build the URL first: a storage outage must not leave an orphan row behind.
    const uploadUrl = await this.storage.getSignedPutUrl(storageKey, query.mimeType, ttl);

    const job = await this.prisma.client.importJob.create({
      data: {
        tenantId,
        entity: query.entity,
        status: 'PENDING',
        fileName: query.fileName,
        storageKey,
        mimeType: query.mimeType,
        mapping: {} as Prisma.InputJsonValue,
        options: {} as Prisma.InputJsonValue,
        createdById: userId,
      },
      select: { id: true },
    });

    return {
      importJobId: job.id,
      storageKey,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': query.mimeType },
      expiresInSeconds: ttl,
    };
  }

  // ---------------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------------

  /**
   * Re-reads the uploaded object, suggests a mapping and validates a sample of
   * rows. Nothing is written to the target entities — this is the dry run.
   */
  async preview(
    id: string,
    body: ImportMappingRequest,
    limit: number,
  ): Promise<ImportPreviewResponse> {
    const tenantId = requireTenant();
    const job = await this.findJobOrFail(id);
    this.assertEntityPermission(job.entity);

    if (TERMINAL_STATUSES.has(job.status)) {
      throw new ConflictError('This import has already finished.');
    }

    const meta = await this.storage.describeObject(job.storageKey);
    if (meta.size <= 0) {
      throw new ValidationError('The uploaded file is empty. Upload it again.');
    }

    const buffer = await this.storage.download(job.storageKey);
    const parsed = await readTabularFile(buffer, job.mimeType, job.fileName);
    const options = resolveOptions(body.options);
    const grid = resolveGrid(parsed, options.hasHeaderRow);

    const suggestedMapping = suggestMapping(grid.headers, job.entity);
    const mapping = { ...suggestedMapping, ...body.mapping };

    const sampled = grid.rows.slice(0, limit);
    const rows: ImportPreviewRow[] = [];
    let validRows = 0;

    for (let index = 0; index < sampled.length; index += 1) {
      const coerced = coerceRow(job.entity, mapping, sampled[index] ?? [], grid.headers);
      const duplicateOf =
        coerced.errors.length === 0 && Object.keys(coerced.mapped).length > 0
          ? await this.writer.findDuplicate(job.entity, coerced.mapped, tenantId)
          : null;
      if (coerced.errors.length === 0) validRows += 1;

      rows.push({
        rowNumber: index + 1,
        values: coerced.values,
        mapped: coerced.mapped,
        errors: coerced.errors,
        duplicateOf,
      });
    }

    await this.prisma.client.importJob.update({
      where: { id },
      data: {
        mapping: mapping as Prisma.InputJsonValue,
        options: body.options as Prisma.InputJsonValue,
        // The first preview is what moves a fresh upload into the mapping step.
        ...(job.status === 'PENDING' ? { status: 'MAPPING' } : {}),
      },
    });

    return {
      headers: grid.headers,
      rows,
      suggestedMapping,
      totalRowsSampled: rows.length,
      validRows,
      invalidRows: rows.length - validRows,
    };
  }

  // ---------------------------------------------------------------------------
  // Run
  // ---------------------------------------------------------------------------

  /** Persists the mapping and queues the row-by-row work. */
  async run(id: string, input: ImportRunRequest): Promise<ImportJobSummary> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;
    const job = await this.findJobOrFail(id);
    this.assertEntityPermission(job.entity);

    if (job.status !== 'PENDING' && job.status !== 'MAPPING') {
      throw new ConflictError('This import has already been started.');
    }

    if (input.saveAsTemplate) {
      await this.createTemplate({
        name: input.saveAsTemplate,
        entity: job.entity,
        mapping: input.mapping,
        options: input.options as Record<string, unknown>,
      });
    }

    await this.prisma.client.importJob.update({
      where: { id },
      data: {
        status: 'PENDING',
        mapping: input.mapping as Prisma.InputJsonValue,
        options: input.options as Prisma.InputJsonValue,
      },
    });

    await this.enqueue({ tenantId, importJobId: id, entity: job.entity, storageKey: job.storageKey, userId });

    const updated = await this.findJobOrFail(id);
    return toSummary(updated, await this.creator(updated.createdById));
  }

  async cancel(id: string): Promise<ImportJobSummary> {
    const job = await this.findJobOrFail(id);
    this.assertEntityPermission(job.entity);

    if (TERMINAL_STATUSES.has(job.status)) {
      throw new ConflictError('This import has already finished.');
    }

    await this.prisma.client.importJob.update({
      where: { id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });

    const updated = await this.findJobOrFail(id);
    return toSummary(updated, await this.creator(updated.createdById));
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async list(query: ImportJobQuery): Promise<Paginated<ImportJobSummary>> {
    const where: Prisma.ImportJobWhereInput = { deletedAt: null };
    if (query.entity) where.entity = query.entity;
    if (query.status) {
      where.status = Array.isArray(query.status) ? { in: query.status } : query.status;
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.importJob.findMany({
        where,
        orderBy: buildOrderBy(query),
        ...toSkipTake(query),
      }),
      this.prisma.client.importJob.count({ where }),
    ]);

    const creators = await this.loadCreators(rows.map((row) => row.createdById));

    return {
      items: rows.map((row) => toSummary(row, creators.get(row.createdById ?? '') ?? null)),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async detail(id: string): Promise<ImportJobSummary> {
    const row = await this.findJobOrFail(id);
    return toSummary(row, await this.creator(row.createdById));
  }

  /** Fresh download link for the row-error CSV, generated on demand. */
  async errors(id: string): Promise<{ downloadUrl: string }> {
    const tenantId = requireTenant();
    const row = await this.findJobOrFail(id);

    const errors = readErrors(row.errors);
    if (errors.length === 0) throw new NotFoundError('Import errors', id);

    const key = errorCsvKey(tenantId, id);
    if (!(await this.objectExists(key))) {
      await this.storage.upload({
        key,
        body: toCsv([ERROR_CSV_HEADER, ...errors.map((entry) => [entry.row, entry.field, entry.message])]),
        contentType: 'text/csv; charset=utf-8',
      });
    }

    return { downloadUrl: await this.storage.getSignedUrl(key) };
  }

  async remove(id: string): Promise<{ deleted: true }> {
    const row = await this.findJobOrFail(id);

    if (row.status === 'PENDING' || row.status === 'MAPPING' || row.status === 'PROCESSING') {
      throw new ConflictError('This import is still running and cannot be removed.');
    }

    await this.prisma.client.importJob.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      action: 'DELETE',
      entity: 'ImportJob',
      entityId: id,
      description: 'Removed an import from history',
    });

    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Worker entry point
  // ---------------------------------------------------------------------------

  /**
   * Applies a queued import. The worker has no HTTP request, so the whole body
   * runs inside a tenant request context — without it the tenant-scoped Prisma
   * client refuses every query. Logs carry ids only, never row data.
   */
  async runImport(payload: ImportJobPayload): Promise<void> {
    const entity = payload.entity as ImportEntityType;

    await requestContext.run(
      createRequestContext({
        tenantId: payload.tenantId,
        userId: payload.userId ?? undefined,
        bypassTenant: false,
        // The minimum the per-row services let the worker do on the caller's behalf.
        permissions: IMPORT_ENTITY_PERMISSIONS[entity] ?? [],
      }),
      async () => {
        const row = await this.prisma.client.importJob.findFirst({
          where: { id: payload.importJobId, deletedAt: null },
        });
        if (!row) {
          this.logger.warn(`Import ${payload.importJobId} no longer exists; skipping`);
          return;
        }
        if (TERMINAL_STATUSES.has(row.status)) {
          this.logger.warn(`Import ${row.id} is already ${row.status}; skipping`);
          return;
        }

        await this.processJob(row);
      },
    );
  }

  private async processJob(row: ImportJob): Promise<void> {
    await this.prisma.client.importJob.update({
      where: { id: row.id },
      data: {
        status: 'PROCESSING',
        startedAt: new Date(),
        processedRows: 0,
        createdRows: 0,
        updatedRows: 0,
        skippedRows: 0,
        failedRows: 0,
        errors: [] as unknown as Prisma.InputJsonValue,
      },
    });

    try {
      const buffer = await this.storage.download(row.storageKey);
      const parsed = await readTabularFile(buffer, row.mimeType, row.fileName);
      const options = resolveOptions(row.options);
      const grid = resolveGrid(parsed, options.hasHeaderRow);
      const mapping = readMapping(row.mapping);

      await this.prisma.client.importJob.update({
        where: { id: row.id },
        data: { totalRows: grid.rows.length },
      });

      let processed = 0;
      let created = 0;
      let updated = 0;
      let skipped = 0;
      let failed = 0;
      const errors: { row: number; field: string; message: string }[] = [];

      for (let offset = 0; offset < grid.rows.length; offset += IMPORT_BATCH_SIZE) {
        // A cancel between batches stops the run before the next chunk is applied.
        const current = await this.prisma.client.importJob.findFirst({
          where: { id: row.id },
          select: { status: true },
        });
        if (current?.status === 'CANCELLED') return;

        const batch = grid.rows.slice(offset, offset + IMPORT_BATCH_SIZE);
        const outcomes = await this.applyBatch(
          row.entity,
          mapping,
          grid.headers,
          batch,
          offset,
          options,
          row.createdById,
        );

        for (const outcome of outcomes) {
          processed += 1;
          if (outcome.outcome === 'created') created += 1;
          else if (outcome.outcome === 'updated') updated += 1;
          else if (outcome.outcome === 'skipped') skipped += 1;
          else {
            failed += 1;
            if (errors.length < IMPORT_MAX_STORED_ERRORS) {
              errors.push({
                row: outcome.rowNumber,
                field: outcome.field ?? '',
                message: outcome.message ?? 'This row could not be imported.',
              });
            }
          }
        }

        await this.prisma.client.$transaction(async (tx) => {
          await tx.importJob.update({
            where: { id: row.id },
            data: {
              processedRows: processed,
              createdRows: created,
              updatedRows: updated,
              skippedRows: skipped,
              failedRows: failed,
              errors: errors as unknown as Prisma.InputJsonValue,
            },
          });
        });
      }

      if (failed > 0) await this.writeErrorCsv(row.tenantId, row.id, errors);

      const status = processed > 0 && failed === processed ? 'FAILED' : 'COMPLETED';
      await this.prisma.client.importJob.update({
        where: { id: row.id },
        data: { status, completedAt: new Date() },
      });
    } catch (error) {
      const message = sanitisedMessage(error);
      this.logger.error(`Import ${row.id} failed: ${message}`);
      await this.prisma.client.importJob
        .update({
          where: { id: row.id },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errors: [{ row: 0, field: '', message }] as unknown as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined);
    } finally {
      // A cancelled or failed run still needs a terminal timestamp.
      await this.prisma.client.importJob
        .updateMany({ where: { id: row.id, completedAt: null }, data: { completedAt: new Date() } })
        .catch(() => undefined);
    }
  }

  /** Applies one batch of rows, converting each failure into a per-row result. */
  private async applyBatch(
    entity: ImportEntityType,
    mapping: Record<string, string>,
    headers: string[],
    batch: string[][],
    offset: number,
    options: ResolvedOptions,
    actorId: string | null,
  ): Promise<
    {
      rowNumber: number;
      outcome: 'created' | 'updated' | 'skipped' | 'failed';
      field?: string;
      message?: string;
    }[]
  > {
    const results = [];

    for (let index = 0; index < batch.length; index += 1) {
      const rowNumber = offset + index + 1;
      const coerced = coerceRow(entity, mapping, batch[index] ?? [], headers);

      if (coerced.errors.length > 0) {
        const first = coerced.errors[0];
        results.push({
          rowNumber,
          outcome: 'failed' as const,
          field: first?.field,
          message: first?.message,
        });
        continue;
      }

      try {
        const written = await this.writer.writeRow(entity, coerced.mapped, options, actorId);
        results.push({ rowNumber, outcome: written.outcome });
      } catch (error) {
        results.push({
          rowNumber,
          outcome: 'failed' as const,
          field: firstErrorField(error),
          message: sanitisedMessage(error),
        });
      }
    }

    return results;
  }

  private async writeErrorCsv(
    tenantId: string,
    jobId: string,
    errors: { row: number; field: string; message: string }[],
  ): Promise<void> {
    const rows: (readonly unknown[])[] = [
      ERROR_CSV_HEADER,
      ...errors.map((entry) => [entry.row, entry.field, entry.message]),
    ];
    await this.storage.upload({
      key: errorCsvKey(tenantId, jobId),
      body: toCsv(rows),
      contentType: 'text/csv; charset=utf-8',
    });
  }

  private async objectExists(key: string): Promise<boolean> {
    try {
      const meta = await this.storage.describeObject(key);
      return meta.size > 0;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Authorisation & lookups
  // ---------------------------------------------------------------------------

  private assertEntityPermission(entity: ImportEntityType): void {
    const context = requestContext.getOrThrow();
    if (context.isSuperAdmin) return;

    for (const key of IMPORT_ENTITY_PERMISSIONS[entity]) {
      if (!hasPermission(context.permissions, key)) {
        throw new ForbiddenError(
          `You need the "${key}" permission to import ${IMPORT_ENTITY_TYPE_LABELS[entity].toLowerCase()}.`,
        );
      }
    }
  }

  private async findJobOrFail(id: string): Promise<ImportJob> {
    // A row from another tenant is simply not visible, so this reads as a 404.
    const row = await this.prisma.client.importJob.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundError('Import', id);
    return row;
  }

  private async findTemplateOrFail(id: string): Promise<ImportTemplate> {
    const row = await this.prisma.client.importTemplate.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundError('Import template', id);
    return row;
  }

  private async creator(createdById: string | null): Promise<{ id: string; fullName: string } | null> {
    if (!createdById) return null;
    const creators = await this.loadCreators([createdById]);
    return creators.get(createdById) ?? null;
  }

  private async loadCreators(
    ids: readonly (string | null)[],
  ): Promise<Map<string, { id: string; fullName: string }>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map();

    const users = await this.prisma.client.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true },
    });

    return new Map(
      users.map((user) => [
        user.id,
        { id: user.id, fullName: `${user.firstName} ${user.lastName}`.trim() },
      ]),
    );
  }

  private async enqueue(payload: ImportJobPayload): Promise<void> {
    try {
      await this.importQueue.add(QUEUE_NAMES.import, payload, {
        // A deterministic id makes a double-submit a no-op instead of a double run.
        jobId: payload.importJobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 500,
        removeOnFail: 1_000,
      });
    } catch {
      // A queue outage leaves the import `PENDING`; nothing was applied.
      this.logger.error(`Could not enqueue import ${payload.importJobId}`);
    }
  }
}

// -----------------------------------------------------------------------------
// Sample data & mappers
// -----------------------------------------------------------------------------

const ERROR_CSV_HEADER = ['row', 'field', 'message'] as const;

/** Example rows aligned with `IMPORT_FIELD_DEFINITIONS` order. */
const SAMPLE_ROWS: Record<ImportEntityType, string[][]> = {
  CANDIDATE: [
    [
      'Ada', 'Lovelace', 'ada.lovelace@example.com', '+14155550100', 'Staff Engineer',
      'Analytical Engines Ltd', 'London', 'Greater London', 'United Kingdom',
      'https://www.linkedin.com/in/ada-lovelace', '120', '18500000', '2026-02-01',
      'LINKEDIN', 'engineering;senior', 'TypeScript;Node.js;PostgreSQL',
    ],
    [
      'Grace', 'Hopper', 'grace.hopper@example.com', '+14155550101', 'Engineering Manager',
      'Compiler Works', 'Arlington', 'Virginia', 'United States',
      'https://www.linkedin.com/in/grace-hopper', '168', '21000000', '2026-03-15',
      'REFERRAL', 'leadership', 'COBOL;Compilers',
    ],
  ],
  CLIENT: [
    ['Acme Robotics', 'Acme Robotics Inc.', 'Manufacturing', 'https://acme.example.com', '+14155550120', 'Detroit', 'United States'],
    ['Northwind Traders', 'Northwind Traders GmbH', 'Retail', 'https://northwind.example.com', '+442071234567', 'London', 'United Kingdom'],
  ],
  JOB: [
    ['Senior Backend Engineer', 'Acme Robotics', 'Own the ingestion pipeline and its observability.', 'Detroit', 'OPEN', '2', '2026-02-20'],
    ['Data Analyst', 'Northwind Traders', 'Build reporting for the merchandising team.', 'London', 'DRAFT', '1', '2026-03-10'],
  ],
  CONTACT: [
    ['Ada', 'Byron', 'ada.byron@acme.example.com', '+14155550130', 'Acme Robotics', 'Head of Talent'],
    ['Charles', 'Babbage', 'charles.babbage@northwind.example.com', '+442071234589', 'Northwind Traders', 'Procurement Lead'],
  ],
};

/**
 * Reinterprets the grid when the file has no header row: the first parsed
 * record is actually data, so the columns get synthetic names and that record
 * is pushed back in as the first row.
 */
function resolveGrid(parsed: ParsedCsv, hasHeaderRow: boolean): ParsedCsv {
  if (hasHeaderRow) return parsed;
  return {
    headers: parsed.headers.map((_, index) => `Column ${index + 1}`),
    rows: [parsed.headers, ...parsed.rows],
  };
}

function toSummary(
  row: ImportJob,
  createdBy: { id: string; fullName: string } | null,
): ImportJobSummary {
  const progress = row.totalRows === 0 ? 0 : Math.round((row.processedRows / row.totalRows) * 100);

  return {
    id: row.id,
    entity: row.entity,
    status: row.status,
    fileName: row.fileName,
    totalRows: row.totalRows,
    processedRows: row.processedRows,
    createdRows: row.createdRows,
    updatedRows: row.updatedRows,
    skippedRows: row.skippedRows,
    failedRows: row.failedRows,
    progress,
    errors: readErrors(row.errors),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function toTemplateSummary(
  row: ImportTemplate,
  createdBy: { id: string; fullName: string } | null,
): ImportTemplateSummary {
  return {
    id: row.id,
    name: row.name,
    entity: row.entity,
    mapping: (row.mapping ?? {}) as Record<string, string>,
    options: (row.options ?? {}) as Record<string, unknown>,
    createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function readErrors(value: Prisma.JsonValue): { row: number; field: string; message: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    return [
      {
        row: typeof record.row === 'number' ? record.row : 0,
        field: typeof record.field === 'string' ? record.field : '',
        message: typeof record.message === 'string' ? record.message : 'This row could not be imported.',
      },
    ];
  });
}

function readMapping(value: Prisma.JsonValue): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

function resolveOptions(value: Prisma.JsonValue | Record<string, unknown>): ResolvedOptions {
  const record =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const strategy = record.duplicateStrategy;
  const duplicateStrategy: DuplicateStrategy =
    strategy === 'UPDATE' || strategy === 'CREATE' ? strategy : 'SKIP';

  return {
    duplicateStrategy,
    hasHeaderRow: record.hasHeaderRow !== false,
    ownerId: typeof record.ownerId === 'string' ? record.ownerId : null,
    defaultSource: typeof record.defaultSource === 'string' ? record.defaultSource : null,
    tag: typeof record.tag === 'string' ? record.tag : null,
  };
}

function buildOrderBy(query: ImportJobQuery): Prisma.ImportJobOrderByWithRelationInput[] {
  switch (query.sortBy) {
    case 'completedAt':
      return [{ completedAt: query.sortDir }];
    case 'status':
      return [{ status: query.sortDir }];
    default:
      return [{ createdAt: query.sortDir }];
  }
}

/** Mirrors `PermissionsGuard`: holding `_all` satisfies an `_own` requirement. */
function hasPermission(granted: readonly string[], required: string): boolean {
  if (granted.includes(required)) return true;
  if (required.endsWith('_own')) {
    return granted.includes(`${required.replace(/_own$/, '')}_all`);
  }
  return false;
}

/** Row-level messages are only ever surfaced when they are already user-safe. */
function sanitisedMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return 'This row could not be imported.';
}

/** The field a domain error is about, when it names one. */
function firstErrorField(error: unknown): string {
  if (error instanceof ValidationError && error.details && typeof error.details === 'object') {
    const details = error.details as { field?: unknown };
    if (typeof details.field === 'string') return details.field;
  }
  return '';
}

function errorCsvKey(tenantId: string, jobId: string): string {
  return `${IMPORT_STORAGE_PREFIX}/${tenantId}/errors/${jobId}.csv`;
}

function templateNameConflict(): ConflictError {
  return new ConflictError('A template with that name already exists for this entity.');
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function requireTenant(): string {
  const tenantId = requestContext.tenantId;
  if (!tenantId) throw new ForbiddenError('This action must run inside a workspace.');
  return tenantId;
}
