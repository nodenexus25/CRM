import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type BulkOperation } from '@prisma/client';
import type { Queue } from 'bullmq';

import {
  bulkOperationPayloadSchemas,
  buildPaginationMeta,
  candidateQuerySchema,
  jobQuerySchema,
  toSkipTake,
  type BulkOperationItem,
  type BulkOperationPayload,
  type BulkOperationQuery,
  type BulkOperationType,
  type CreateBulkOperationRequest,
  type Paginated,
  type PermissionKey,
} from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/common/errors/domain-errors';
import { createRequestContext, requestContext, type RequestContext } from '@/common/request-context';
import { toCsv } from '@/common/utils/csv';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { QUEUE_NAMES, type BulkOperationJob } from '@/infra/queue/queue.constants';
import { StorageService } from '@/infra/storage/storage.service';
import { ApplicationsService } from '@/modules/applications/applications.service';
import { CandidateListsService } from '@/modules/candidate-lists/candidate-lists.service';
import { CandidatesService } from '@/modules/candidates/candidates.service';
import { JobsService } from '@/modules/jobs/jobs.service';

/**
 * Bulk actions (Phase 2, Module 6).
 *
 * A bulk action is a two-step flow. The request path validates the selection,
 * authorises the *specific* action, resolves it to a concrete id list and
 * persists a `PENDING` `BulkOperation`; the `bulk` worker then applies it in
 * transactional batches, updating the counters as it goes so the client can
 * poll progress on `GET /bulk-operations/:id`.
 *
 * The action → permission map below is the only authorisation source for a
 * bulk action. The controller advertises the union of every key because the
 * request body is a discriminated union a static decorator cannot narrow, so
 * the exact key for the requested action is re-checked here.
 */
export const BULK_ACTION_PERMISSIONS: Record<BulkOperationType, PermissionKey> = {
  CANDIDATE_TAGS: 'candidate:bulk_update',
  CANDIDATE_OWNER: 'candidate:bulk_update',
  CANDIDATE_STATUS: 'candidate:bulk_update',
  CANDIDATE_ADD_TO_JOB: 'application:create',
  CANDIDATE_ADD_TO_LIST: 'list:manage',
  CANDIDATE_DELETE: 'candidate:delete',
  CANDIDATE_EXPORT: 'candidate:export',
  JOB_STATUS: 'job:bulk_update',
  JOB_PRIORITY: 'job:bulk_update',
  JOB_ASSIGN_RECRUITERS: 'job:assign',
};

/** Every distinct permission a bulk action may require, for `@RequireAnyPermission`. */
export const BULK_ACTION_PERMISSION_KEYS: PermissionKey[] = [
  ...new Set(Object.values(BULK_ACTION_PERMISSIONS)),
  'candidate:read_all',
];

/**
 * Explicit `{ ids }` selections are capped at 5 000 by `bulkSelectionSchema`;
 * filter-based selections are re-resolved server-side and allowed to reach a
 * higher ceiling so "all matching" stays useful on large workspaces.
 */
const BULK_MAX_ITEMS = 5_000;
const BULK_FILTER_MAX_ITEMS = 20_000;
/** Rows per transactional batch. Balances round-trips against lock footprint. */
const BULK_BATCH_SIZE = 200;
/**
 * Only the first failures are kept on the row. A pathological run can fail on
 * thousands of rows, and the summary is meant to be read by a human — the
 * counters still carry the full picture.
 */
const BULK_MAX_STORED_ERRORS = 100;

interface RowOutcome {
  id: string;
  ok: boolean;
  message?: string;
}

/** The candidate columns the CSV export may draw from. */
interface ExportCandidate {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  locationCity: string | null;
  locationState: string | null;
  locationCountry: string | null;
  status: string;
  tags: string[];
  totalExperienceMonths: number | null;
  source: string | null;
  createdAt: Date;
}

const EXPORT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  currentTitle: true,
  currentCompany: true,
  locationCity: true,
  locationState: true,
  locationCountry: true,
  status: true,
  tags: true,
  totalExperienceMonths: true,
  source: true,
  createdAt: true,
} satisfies Prisma.CandidateSelect;

const EXPORT_COLUMNS: Record<string, { header: string; value: (row: ExportCandidate) => unknown }> = {
  id: { header: 'ID', value: (row) => row.id },
  firstName: { header: 'First name', value: (row) => row.firstName },
  lastName: { header: 'Last name', value: (row) => row.lastName },
  email: { header: 'Email', value: (row) => row.email },
  phone: { header: 'Phone', value: (row) => row.phone },
  currentTitle: { header: 'Current title', value: (row) => row.currentTitle },
  currentCompany: { header: 'Current company', value: (row) => row.currentCompany },
  location: {
    header: 'Location',
    value: (row) =>
      [row.locationCity, row.locationState, row.locationCountry]
        .filter((part): part is string => Boolean(part))
        .join(', '),
  },
  status: { header: 'Status', value: (row) => row.status },
  tags: { header: 'Tags', value: (row) => row.tags.join('; ') },
  experienceMonths: { header: 'Experience (months)', value: (row) => row.totalExperienceMonths },
  source: { header: 'Source', value: (row) => row.source },
  createdAt: { header: 'Created at', value: (row) => row.createdAt.toISOString() },
};

const DEFAULT_EXPORT_COLUMNS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'currentTitle',
  'currentCompany',
  'location',
  'status',
  'tags',
];

@Injectable()
export class BulkOperationsService {
  private readonly logger = new Logger(BulkOperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly candidates: CandidatesService,
    private readonly jobs: JobsService,
    private readonly applications: ApplicationsService,
    private readonly lists: CandidateListsService,
    @InjectQueue(QUEUE_NAMES.bulk) private readonly bulkQueue: Queue<BulkOperationJob>,
  ) {}

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  async create(input: CreateBulkOperationRequest): Promise<BulkOperationItem> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;

    assertBulkActionAllowed(input.type, requestContext.getOrThrow());

    const ids = await this.resolveIds(input);
    if (ids.length === 0) throw new ValidationError('Nothing matched that selection.');

    await this.assertTargetsExist(input);

    const row = await this.prisma.client.bulkOperation.create({
      data: {
        tenantId,
        type: input.type,
        status: 'PENDING',
        // The selection is stored fully resolved so the worker applies the exact
        // set the caller was authorised to see — a filter is never trusted twice.
        selection: { ids } as Prisma.InputJsonValue,
        payload: input.payload as unknown as Prisma.InputJsonValue,
        totalItems: ids.length,
        createdById: userId,
      },
    });

    await this.audit.record({
      action: bulkAuditAction(input.type),
      entity: 'BulkOperation',
      entityId: row.id,
      description: `Queued ${input.type} for ${ids.length} record(s)`,
    });

    await this.enqueue({ tenantId, bulkOperationId: row.id, userId });

    return toItem(row, await this.creator(row.createdById));
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async list(query: BulkOperationQuery): Promise<Paginated<BulkOperationItem>> {
    const userId = requestContext.userId ?? null;
    const where: Prisma.BulkOperationWhereInput = { deletedAt: null };

    if (query.status) {
      where.status = Array.isArray(query.status) ? { in: query.status } : query.status;
    }
    if (query.type) {
      where.type = Array.isArray(query.type) ? { in: query.type } : query.type;
    }
    if (query.mine && userId) where.createdById = userId;

    const [rows, total] = await Promise.all([
      this.prisma.client.bulkOperation.findMany({
        where,
        orderBy: buildOrderBy(query),
        ...toSkipTake(query),
      }),
      this.prisma.client.bulkOperation.count({ where }),
    ]);

    const creators = await this.loadCreators(rows.map((row) => row.createdById));

    return {
      items: rows.map((row) => toItem(row, creators.get(row.createdById ?? '') ?? null)),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async detail(id: string): Promise<BulkOperationItem> {
    const row = await this.findOrFail(id);
    return toItem(row, await this.creator(row.createdById));
  }

  /** Fresh, short-lived download link for the generated export file. */
  async result(id: string): Promise<{ downloadUrl: string }> {
    const row = await this.findOrFail(id);

    if (!row.resultKey) {
      if (row.status === 'PENDING' || row.status === 'PROCESSING') {
        throw new ConflictError('This operation has not finished yet.');
      }
      throw new NotFoundError('Export file', id);
    }

    return { downloadUrl: await this.storage.getSignedUrl(row.resultKey) };
  }

  async remove(id: string): Promise<{ deleted: true }> {
    const row = await this.findOrFail(id);

    if (row.status === 'PENDING' || row.status === 'PROCESSING') {
      throw new ConflictError('This operation is still running and cannot be removed.');
    }

    await this.prisma.client.bulkOperation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      action: 'DELETE',
      entity: 'BulkOperation',
      entityId: id,
      description: 'Removed a bulk operation from history',
    });

    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Worker entry point
  // ---------------------------------------------------------------------------

  /**
   * Applies a queued operation. The worker has no HTTP request, so the whole
   * body is wrapped in a tenant request context — without it the tenant-scoped
   * Prisma client refuses every query.
   */
  async runBulkOperation(job: BulkOperationJob): Promise<void> {
    await requestContext.run(
      createRequestContext({ tenantId: job.tenantId, userId: job.userId ?? undefined, bypassTenant: false }),
      async () => {
        const row = await this.prisma.client.bulkOperation.findFirst({
          where: { id: job.bulkOperationId, deletedAt: null },
        });
        if (!row) {
          this.logger.warn(`Bulk operation ${job.bulkOperationId} no longer exists; skipping`);
          return;
        }
        // A retried job must not re-apply a finished run.
        if (row.status === 'COMPLETED' || row.status === 'FAILED') {
          this.logger.warn(`Bulk operation ${row.id} is already ${row.status}; skipping`);
          return;
        }

        // The action's permission was already enforced when the operation was
        // created. Grant exactly that key here so any internal `hasPermission`
        // check inside the per-item services resolves the same way it did for
        // the caller; resolving the selection happened at creation, so nothing
        // broader than the caller's own visibility is ever applied.
        requestContext.patch({ permissions: [BULK_ACTION_PERMISSIONS[row.type]] });

        await this.execute(row);
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  private async execute(row: BulkOperation): Promise<void> {
    const ids = readSelectionIds(row);
    await this.markProcessing(row.id, ids.length);

    try {
      if (row.type === 'CANDIDATE_EXPORT') {
        await this.runExport(row, ids);
      } else {
        await this.runMutations(row, ids);
      }
      await this.prisma.client.bulkOperation.update({
        where: { id: row.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      await this.audit.record({
        action: bulkAuditAction(row.type),
        entity: 'BulkOperation',
        entityId: row.id,
        description: `Applied bulk ${row.type}`,
      });
    } catch (error) {
      const message = sanitisedMessage(error);
      this.logger.error(`Bulk operation ${row.id} failed: ${message}`);
      await this.markFailed(row.id, message);
    }
  }

  /** Runs every non-export type in transactional batches, updating counters as it goes. */
  private async runMutations(row: BulkOperation, ids: string[]): Promise<void> {
    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    const errors = readErrors(row.errors);

    for (let offset = 0; offset < ids.length; offset += BULK_BATCH_SIZE) {
      const batch = ids.slice(offset, offset + BULK_BATCH_SIZE);
      const outcomes = await this.applyBatch(row, batch);

      for (const outcome of outcomes) {
        processed += 1;
        if (outcome.ok) {
          succeeded += 1;
        } else {
          failed += 1;
          if (errors.length < BULK_MAX_STORED_ERRORS) {
            errors.push({ id: outcome.id, message: outcome.message ?? 'Could not be applied.' });
          }
        }
      }

      await this.prisma.client.bulkOperation.update({
        where: { id: row.id },
        data: {
          processedItems: processed,
          succeededItems: succeeded,
          failedItems: failed,
          errors: errors as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

  /** Builds the export file, stores it and records its key for later download. */
  private async runExport(row: BulkOperation, ids: string[]): Promise<void> {
    const payload = bulkOperationPayloadSchemas.CANDIDATE_EXPORT.parse(row.payload);
    const columns = payload.columns.length > 0 ? payload.columns : DEFAULT_EXPORT_COLUMNS;

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    const errors = readErrors(row.errors);
    const csvRows: (readonly unknown[])[] = [columns.map((column) => EXPORT_COLUMNS[column]?.header ?? column)];

    for (let offset = 0; offset < ids.length; offset += BULK_BATCH_SIZE) {
      const batch = ids.slice(offset, offset + BULK_BATCH_SIZE);
      const found = await this.prisma.client.candidate.findMany({
        where: { id: { in: batch }, deletedAt: null },
        select: EXPORT_SELECT,
      });
      const byId = new Map(found.map((candidate) => [candidate.id, candidate]));

      for (const id of batch) {
        processed += 1;
        const candidate = byId.get(id);
        if (!candidate) {
          failed += 1;
          if (errors.length < BULK_MAX_STORED_ERRORS) {
            errors.push({ id, message: 'Candidate not found in this workspace.' });
          }
          continue;
        }
        succeeded += 1;
        csvRows.push(columns.map((column) => EXPORT_COLUMNS[column]?.value(candidate) ?? ''));
      }

      await this.prisma.client.bulkOperation.update({
        where: { id: row.id },
        data: {
          processedItems: processed,
          succeededItems: succeeded,
          failedItems: failed,
          errors: errors as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const key = this.storage.buildKey('exports', row.tenantId, `candidates-${row.id}.csv`);
    await this.storage.upload({
      key,
      body: toCsv(csvRows),
      contentType: 'text/csv; charset=utf-8',
    });

    await this.prisma.client.bulkOperation.update({
      where: { id: row.id },
      data: { resultKey: key },
    });
  }

  /** Dispatches one batch to the handler for the operation's type. */
  private async applyBatch(row: BulkOperation, batch: string[]): Promise<RowOutcome[]> {
    const userId = requestContext.userId ?? null;

    switch (row.type) {
      case 'CANDIDATE_TAGS':
        return this.applyCandidateTags(batch, bulkOperationPayloadSchemas.CANDIDATE_TAGS.parse(row.payload), userId);
      case 'CANDIDATE_OWNER':
        return this.applyUniformToCandidates(
          batch,
          { ownerId: bulkOperationPayloadSchemas.CANDIDATE_OWNER.parse(row.payload).ownerId, updatedById: userId },
        );
      case 'CANDIDATE_STATUS': {
        const { status } = bulkOperationPayloadSchemas.CANDIDATE_STATUS.parse(row.payload);
        return this.applyUniformToCandidates(batch, {
          status,
          // The archive flag is the list-visibility switch, so it tracks the
          // status rather than drifting out of sync with it.
          isArchived: status === 'ARCHIVED',
          updatedById: userId,
        });
      }
      case 'CANDIDATE_DELETE':
        return this.applyUniformToCandidates(batch, { deletedAt: new Date(), updatedById: userId });
      case 'CANDIDATE_ADD_TO_JOB':
        return this.applyAddToJob(batch, bulkOperationPayloadSchemas.CANDIDATE_ADD_TO_JOB.parse(row.payload));
      case 'CANDIDATE_ADD_TO_LIST':
        return this.applyAddToList(batch, bulkOperationPayloadSchemas.CANDIDATE_ADD_TO_LIST.parse(row.payload));
      case 'JOB_STATUS':
        return this.applyJobStatus(batch, bulkOperationPayloadSchemas.JOB_STATUS.parse(row.payload));
      case 'JOB_PRIORITY':
        return this.applyUniformToJobs(batch, {
          priority: bulkOperationPayloadSchemas.JOB_PRIORITY.parse(row.payload).priority,
          updatedById: userId,
        });
      case 'JOB_ASSIGN_RECRUITERS':
        return this.applyAssignRecruiters(batch, bulkOperationPayloadSchemas.JOB_ASSIGN_RECRUITERS.parse(row.payload));
      default:
        return batch.map((id) => ({ id, ok: false, message: 'Unsupported operation type.' }));
    }
  }

  // ---------------------------------------------------------------------------
  // Per-type handlers
  // ---------------------------------------------------------------------------

  /**
   * Tag edits are the one uniform-looking action that is not actually uniform:
   * each row's result depends on the tags it already carries, so the new set is
   * computed per row and only written when it changes.
   */
  private async applyCandidateTags(
    ids: string[],
    payload: BulkOperationPayload['CANDIDATE_TAGS'],
    userId: string | null,
  ): Promise<RowOutcome[]> {
    const add = new Set(payload.add);
    const remove = new Set(payload.remove);

    const found = await this.prisma.client.candidate.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, tags: true },
    });
    const tagsById = new Map(found.map((row) => [row.id, row.tags]));

    const outcomes: RowOutcome[] = [];
    await this.prisma.client.$transaction(async (tx) => {
      for (const id of ids) {
        const current = tagsById.get(id);
        if (current === undefined) {
          outcomes.push({ id, ok: false, message: 'Candidate not found in this workspace.' });
          continue;
        }
        const next = [...new Set([...current.filter((tag) => !remove.has(tag)), ...add])];
        if (current.join('\u0000') !== next.join('\u0000')) {
          await tx.candidate.update({ where: { id }, data: { tags: next, updatedById: userId } });
        }
        outcomes.push({ id, ok: true });
      }
    });

    return outcomes;
  }

  /** Applies one identical payload to many candidates inside a single transaction. */
  private async applyUniformToCandidates(
    ids: string[],
    data: Prisma.CandidateUncheckedUpdateManyInput,
  ): Promise<RowOutcome[]> {
    const existing = await this.existingCandidateIds(ids);
    const present = ids.filter((id) => existing.has(id));

    if (present.length > 0) {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.candidate.updateMany({ where: { id: { in: present }, deletedAt: null }, data });
      });
    }

    return ids.map((id) =>
      existing.has(id) ? { id, ok: true } : { id, ok: false, message: 'Candidate not found in this workspace.' },
    );
  }

  /** Applies one identical payload to many jobs inside a single transaction. */
  private async applyUniformToJobs(
    ids: string[],
    data: Prisma.JobUncheckedUpdateManyInput,
  ): Promise<RowOutcome[]> {
    const existing = await this.existingJobIds(ids);
    const present = ids.filter((id) => existing.has(id));

    if (present.length > 0) {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.job.updateMany({ where: { id: { in: present }, deletedAt: null }, data });
      });
    }

    return ids.map((id) =>
      existing.has(id) ? { id, ok: true } : { id, ok: false, message: 'Job not found in this workspace.' },
    );
  }

  private async applyAddToJob(
    ids: string[],
    payload: BulkOperationPayload['CANDIDATE_ADD_TO_JOB'],
  ): Promise<RowOutcome[]> {
    const existing = await this.existingCandidateIds(ids);
    const outcomes: RowOutcome[] = ids
      .filter((id) => !existing.has(id))
      .map((id) => ({ id, ok: false, message: 'Candidate not found in this workspace.' }));

    const present = ids.filter((id) => existing.has(id));
    if (present.length === 0) return outcomes;

    try {
      // Reuses the single-candidate pipeline path so stage validation, history
      // and activity all stay in one place.
      const result = await this.applications.addToPipeline({
        jobId: payload.jobId,
        candidateIds: present,
        ...(payload.stageId ? { stageId: payload.stageId } : {}),
        ...(payload.source ? { source: payload.source } : {}),
      });
      const added = new Set(result.added.map((application) => application.candidate.id));
      for (const id of present) {
        outcomes.push(
          added.has(id)
            ? { id, ok: true }
            : { id, ok: false, message: 'Already in this pipeline.' },
        );
      }
    } catch (error) {
      const message = sanitisedMessage(error);
      for (const id of present) outcomes.push({ id, ok: false, message });
    }

    return outcomes;
  }

  private async applyAddToList(
    ids: string[],
    payload: BulkOperationPayload['CANDIDATE_ADD_TO_LIST'],
  ): Promise<RowOutcome[]> {
    const existing = await this.existingCandidateIds(ids);
    const outcomes: RowOutcome[] = ids
      .filter((id) => !existing.has(id))
      .map((id) => ({ id, ok: false, message: 'Candidate not found in this workspace.' }));

    const present = ids.filter((id) => existing.has(id));
    if (present.length === 0) return outcomes;

    try {
      await this.lists.addMembers(payload.listId, { candidateIds: present });
      for (const id of present) outcomes.push({ id, ok: true });
    } catch (error) {
      const message = sanitisedMessage(error);
      for (const id of present) outcomes.push({ id, ok: false, message });
    }

    return outcomes;
  }

  /**
   * Job status moves through a state machine, so each row is evaluated against
   * its own current status by the jobs service; an illegal transition is
   * recorded as a row failure rather than aborting the batch.
   */
  private async applyJobStatus(
    ids: string[],
    payload: BulkOperationPayload['JOB_STATUS'],
  ): Promise<RowOutcome[]> {
    const outcomes: RowOutcome[] = [];
    for (const id of ids) {
      try {
        await this.jobs.changeStatus(id, { status: payload.status, reason: payload.reason ?? null });
        outcomes.push({ id, ok: true });
      } catch (error) {
        outcomes.push({ id, ok: false, message: sanitisedMessage(error) });
      }
    }
    return outcomes;
  }

  private async applyAssignRecruiters(
    ids: string[],
    payload: BulkOperationPayload['JOB_ASSIGN_RECRUITERS'],
  ): Promise<RowOutcome[]> {
    const assignments = payload.userIds.map((userId) => ({
      userId,
      role: 'RECRUITER' as const,
      isPrimary: false,
    }));

    const outcomes: RowOutcome[] = [];
    for (const id of ids) {
      try {
        await this.jobs.assignRecruiters(id, { assignments, notify: false });
        outcomes.push({ id, ok: true });
      } catch (error) {
        outcomes.push({ id, ok: false, message: sanitisedMessage(error) });
      }
    }
    return outcomes;
  }

  // ---------------------------------------------------------------------------
  // Selection resolution & target validation
  // ---------------------------------------------------------------------------

  /**
   * Turns a selection into a concrete id list. An explicit `{ ids }` list is
   * taken as given (a missing or cross-tenant id is recorded as a row failure
   * later, never leaked back). A filter-based selection is re-resolved
   * server-side against the caller's own visibility scope, so an `all: true`
   * request can never reach records the caller could not list.
   */
  private async resolveIds(input: CreateBulkOperationRequest): Promise<string[]> {
    const selection = input.selection;

    if ('ids' in selection) {
      return [...new Set(selection.ids)].slice(0, BULK_MAX_ITEMS);
    }

    if (input.type.startsWith('JOB_')) {
      const parsed = jobQuerySchema.safeParse(selection.filters);
      if (!parsed.success) {
        throw new ValidationError('Those filters are not valid for jobs.', parsed.error.issues);
      }
      return dedupe(await this.jobs.resolveIdsForBulk(parsed.data, BULK_FILTER_MAX_ITEMS));
    }

    const parsed = candidateQuerySchema.safeParse(selection.filters);
    if (!parsed.success) {
      throw new ValidationError('Those filters are not valid for candidates.', parsed.error.issues);
    }
    return dedupe(await this.candidates.resolveIdsForBulk(parsed.data, BULK_FILTER_MAX_ITEMS));
  }

  /** Fails fast on a target that does not exist in this workspace. */
  private async assertTargetsExist(input: CreateBulkOperationRequest): Promise<void> {
    switch (input.type) {
      case 'CANDIDATE_OWNER': {
        if (input.payload.ownerId) await this.assertUserExists(input.payload.ownerId);
        return;
      }
      case 'CANDIDATE_ADD_TO_JOB': {
        const job = await this.prisma.client.job.findFirst({
          where: { id: input.payload.jobId, deletedAt: null },
          select: { id: true },
        });
        if (!job) throw new ValidationError('That job does not exist in this workspace.');
        return;
      }
      case 'CANDIDATE_ADD_TO_LIST': {
        const list = await this.prisma.client.candidateList.findFirst({
          where: { id: input.payload.listId, deletedAt: null },
          select: { id: true },
        });
        if (!list) throw new ValidationError('That hotlist does not exist in this workspace.');
        return;
      }
      case 'JOB_ASSIGN_RECRUITERS': {
        const unique = [...new Set(input.payload.userIds)];
        const found = await this.prisma.client.user.findMany({
          where: { id: { in: unique }, deletedAt: null },
          select: { id: true },
        });
        if (found.length !== unique.length) {
          throw new ValidationError('Some of those users do not exist in this workspace.');
        }
        return;
      }
      default:
        return;
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async findOrFail(id: string): Promise<BulkOperation> {
    const row = await this.prisma.client.bulkOperation.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundError('Bulk operation', id);
    return row;
  }

  private async existingCandidateIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.client.candidate.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  private async existingJobIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.client.job.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new ValidationError('That user does not exist in this workspace.');
  }

  private async markProcessing(id: string, total: number): Promise<void> {
    await this.prisma.client.bulkOperation.update({
      where: { id },
      data: {
        status: 'PROCESSING',
        startedAt: new Date(),
        totalItems: total,
        processedItems: 0,
        succeededItems: 0,
        failedItems: 0,
        errors: [] as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async markFailed(id: string, message: string): Promise<void> {
    await this.prisma.client.bulkOperation
      .update({
        where: { id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errors: [{ id: 'operation', message }] as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
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

  private async enqueue(payload: BulkOperationJob): Promise<void> {
    try {
      await this.bulkQueue.add(QUEUE_NAMES.bulk, payload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 500,
        removeOnFail: 1_000,
      });
    } catch {
      // A queue outage leaves the operation `PENDING`; nothing was applied.
      this.logger.error(`Could not enqueue bulk operation ${payload.bulkOperationId}`);
    }
  }
}

// -----------------------------------------------------------------------------
// Mappers & helpers
// -----------------------------------------------------------------------------

function toItem(
  row: BulkOperation,
  createdBy: { id: string; fullName: string } | null,
): BulkOperationItem {
  const total = row.totalItems;
  const progress =
    total > 0
      ? Math.min(100, Math.round((row.processedItems / total) * 100))
      : row.status === 'COMPLETED'
        ? 100
        : 0;

  return {
    id: row.id,
    type: row.type,
    status: row.status,
    selection: (row.selection ?? {}) as Record<string, unknown>,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    totalItems: total,
    processedItems: row.processedItems,
    succeededItems: row.succeededItems,
    failedItems: row.failedItems,
    progress,
    errors: readErrors(row.errors),
    resultKey: row.resultKey,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function readSelectionIds(row: BulkOperation): string[] {
  const selection = row.selection as { ids?: unknown } | null;
  const ids = Array.isArray(selection?.ids) ? selection.ids : [];
  return [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
}

function readErrors(value: Prisma.JsonValue): { id: string; message: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    return [{ id: String(record.id), message: String(record.message) }];
  });
}

function buildOrderBy(query: BulkOperationQuery): Prisma.BulkOperationOrderByWithRelationInput[] {
  const dir = query.sortDir;
  switch (query.sortBy) {
    case 'completedAt':
      return [{ completedAt: dir }];
    case 'status':
      return [{ status: dir }];
    default:
      return [{ createdAt: dir }];
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

/**
 * The route advertises the union of every bulk permission because the body is a
 * discriminated union that a static decorator cannot narrow. The exact
 * permission for the requested action is therefore enforced here.
 */
function assertBulkActionAllowed(type: BulkOperationType, context: RequestContext): void {
  if (context.isSuperAdmin) return;
  const required = BULK_ACTION_PERMISSIONS[type];
  if (!hasPermission(context.permissions, required)) {
    throw new ForbiddenError(`You need the "${required}" permission to run this bulk action.`);
  }
}

function bulkAuditAction(type: BulkOperationType): 'UPDATE' | 'DELETE' | 'STATUS_CHANGE' | 'EXPORT' {
  if (type === 'CANDIDATE_EXPORT') return 'EXPORT';
  if (type === 'CANDIDATE_DELETE') return 'DELETE';
  if (type === 'JOB_STATUS' || type === 'CANDIDATE_STATUS') return 'STATUS_CHANGE';
  return 'UPDATE';
}

/** Row-level messages are only ever surfaced when they are already user-safe. */
function sanitisedMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return 'This record could not be processed.';
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

function requireTenant(): string {
  const tenantId = requestContext.tenantId;
  if (!tenantId) throw new ForbiddenError('This action must run inside a workspace.');
  return tenantId;
}
