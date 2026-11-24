import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  type CreatePipelineStageRequest,
  type CreateRejectionReasonRequest,
  type PipelineStageItem,
  type RejectionReasonItem,
  type RejectionReasonQuery,
  type ReorderPipelineStagesRequest,
  type UpdateJobStagesRequest,
  type UpdatePipelineStageRequest,
  type UpdateRejectionReasonRequest,
} from '@talentflow/types';

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import { PrismaService } from '@/infra/prisma/prisma.service';

type StageRow = Prisma.JobPipelineStageGetPayload<Record<string, never>>;
type RejectionReasonRow = Prisma.RejectionReasonGetPayload<Record<string, never>>;

/**
 * Pipeline configuration: the ordered stage set every job inherits, the
 * per-job override, and the tenant's rejection reasons.
 *
 * Tenant-default stages are the rows with `jobId = null`. Because Postgres
 * treats NULLs as distinct in a unique index, `@@unique([tenantId, jobId, key])`
 * does not constrain them — uniqueness for the default set is enforced here.
 *
 * A stage is never hard-deleted. Applications reference stages with
 * `onDelete: Restrict`, and `StageHistory` keeps the stage a candidate visited,
 * so deploys soft-delete (`deletedAt`) instead.
 */
@Injectable()
export class PipelineService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Tenant-default stages
  // ---------------------------------------------------------------------------

  async listStages(): Promise<PipelineStageItem[]> {
    const stages = await this.listTenantStageRows();

    const counts = await this.countApplications(stages.map((stage) => stage.id));
    return stages.map((stage) => toStageItem(stage, counts.get(stage.id) ?? 0));
  }

  async createStage(input: CreatePipelineStageRequest): Promise<PipelineStageItem> {
    const tenantId = requireTenant();

    await this.assertStageKeyAvailable(input.key);
    await this.assertStageNameAvailable(input.name);

    const last = await this.prisma.client.jobPipelineStage.findFirst({
      where: { jobId: null, deletedAt: null },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    const created = await this.prisma.client.jobPipelineStage.create({
      data: {
        tenantId,
        jobId: null,
        key: input.key,
        name: input.name,
        type: input.type,
        category: input.category,
        color: input.color,
        order: (last?.order ?? -1) + 1,
        slaDays: input.slaDays ?? null,
        description: input.description ?? null,
        isTerminal: isTerminalFor(input.category, input.isTerminal),
        requiredPermission: input.requiredPermission ?? null,
      },
    });

    return toStageItem(created, 0);
  }

  async updateStage(stageId: string, input: UpdatePipelineStageRequest): Promise<PipelineStageItem> {
    const existing = await this.findTenantStageOrFail(stageId);

    const data: Prisma.JobPipelineStageUncheckedUpdateInput = {};

    if (input.name !== undefined && input.name !== existing.name) {
      await this.assertStageNameAvailable(input.name, stageId);
      data.name = input.name;
    }
    if (input.type !== undefined) data.type = input.type;
    if (input.color !== undefined) data.color = input.color;
    if (input.slaDays !== undefined) data.slaDays = input.slaDays ?? null;
    if (input.description !== undefined) data.description = input.description ?? null;

    if (input.category !== undefined && input.category !== existing.category) {
      if (existing.isDefault) {
        throw new ValidationError('The intake stage must stay an active stage. Rename it instead.');
      }
      if (input.category === 'ACTIVE') {
        await this.assertAnotherActiveStageExists(stageId);
      }
      data.category = input.category;
      data.isTerminal = input.category !== 'ACTIVE';
    }

    const updated = await this.prisma.client.jobPipelineStage.update({
      where: { id: stageId },
      data,
    });

    const counts = await this.countApplications([stageId]);
    return toStageItem(updated, counts.get(stageId) ?? 0);
  }

  /** One round trip, one atomic reorder — the Kanban order can never half-apply. */
  async reorderStages(input: ReorderPipelineStagesRequest): Promise<PipelineStageItem[]> {
    const stages = await this.prisma.client.jobPipelineStage.findMany({
      where: { jobId: null, deletedAt: null },
      select: { id: true },
    });
    const known = new Set(stages.map((stage) => stage.id));

    const ids = input.stages.map((entry) => entry.id);
    if (new Set(ids).size !== ids.length) {
      throw new ValidationError('Each stage may appear only once in a reorder.');
    }

    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new ValidationError('Some of those stages do not belong to this workspace.', {
        stageIds: unknown,
      });
    }

    await this.prisma.client.$transaction(
      input.stages.map((entry) =>
        this.prisma.client.jobPipelineStage.update({
          where: { id: entry.id },
          data: { order: entry.order },
        }),
      ),
    );

    return this.listStages();
  }

  /**
   * Soft-deletes a stage. When it still holds applications the caller must name
   * a destination: every application is moved (with stage history recorded)
   * inside the same transaction that retires the stage.
   */
  async deleteStage(
    stageId: string,
    moveToStageId?: string,
  ): Promise<{ deleted: true; movedApplications: number }> {
    const tenantId = requireTenant();
    const stage = await this.findTenantStageOrFail(stageId);

    if (stage.isDefault) {
      throw new ValidationError('The intake stage cannot be deleted. Rename it instead.');
    }
    if (stage.category === 'ACTIVE') {
      await this.assertAnotherActiveStageExists(stageId);
    }

    const applicationCount = await this.prisma.client.application.count({
      where: { stageId, deletedAt: null },
    });

    if (applicationCount > 0 && !moveToStageId) {
      throw new ConflictError(
        `“${stage.name}” still holds ${applicationCount} application${applicationCount === 1 ? '' : 's'}. Choose a stage to move them to.`,
        { applicationCount },
      );
    }

    const now = new Date();
    const target =
      applicationCount > 0 && moveToStageId ? await this.resolveMoveTarget(moveToStageId, stageId) : null;

    const operations: Prisma.PrismaPromise<unknown>[] = [];

    if (target) {
      const applications = await this.prisma.client.application.findMany({
        where: { stageId, deletedAt: null },
        select: { id: true, stageEnteredAt: true },
      });

      operations.push(
        this.prisma.client.application.updateMany({
          where: { stageId, deletedAt: null },
          data: { stageId: target.id, stageEnteredAt: now, lastStageChangedAt: now },
        }),
      );

      if (applications.length > 0) {
        const changedById = requestContext.userId ?? null;
        operations.push(
          this.prisma.client.stageHistory.createMany({
            data: applications.map((application) => ({
              tenantId,
              applicationId: application.id,
              fromStageId: stageId,
              toStageId: target.id,
              changedById,
              note: `Moved automatically when “${stage.name}” was deleted`,
              durationSeconds: toSeconds(now.getTime() - application.stageEnteredAt.getTime()),
            })),
          }),
        );
      }
    }

    operations.push(
      this.prisma.client.jobPipelineStage.update({
        where: { id: stageId },
        data: { deletedAt: now },
      }),
    );

    await this.prisma.client.$transaction(operations);

    return { deleted: true, movedApplications: applicationCount };
  }

  // ---------------------------------------------------------------------------
  // Per-job override
  // ---------------------------------------------------------------------------

  /**
   * Materialises the tenant pipeline onto the job, so a job always has its own
   * editable copy of the stages. Applications already on the job are repointed
   * from the tenant-default stage to the equivalent job stage by key.
   */
  async copyTenantStagesToJob(jobId: string): Promise<void> {
    const tenantId = requireTenant();

    const existing = await this.prisma.client.jobPipelineStage.count({
      where: { jobId, deletedAt: null },
    });
    if (existing > 0) return;

    const defaults = await this.prisma.client.jobPipelineStage.findMany({
      where: { jobId: null, deletedAt: null },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    if (defaults.length === 0) return;

    await this.prisma.client.jobPipelineStage.createMany({
      data: defaults.map((stage) => ({
        tenantId,
        jobId,
        key: stage.key,
        name: stage.name,
        type: stage.type,
        category: stage.category,
        color: stage.color,
        order: stage.order,
        isDefault: stage.isDefault,
        isTerminal: stage.isTerminal,
        slaDays: stage.slaDays,
        description: stage.description,
        requiredPermission: stage.requiredPermission,
      })),
    });

    const copies = await this.prisma.client.jobPipelineStage.findMany({
      where: { jobId, deletedAt: null },
      select: { id: true, key: true },
    });
    const copyIdByKey = new Map(copies.map((copy) => [copy.key, copy.id]));
    const defaultKeyById = new Map(defaults.map((stage) => [stage.id, stage.key]));

    const applications = await this.prisma.client.application.findMany({
      where: { jobId, deletedAt: null },
      select: { id: true, stageId: true },
    });

    const repoints: Prisma.PrismaPromise<unknown>[] = [];
    for (const application of applications) {
      const key = defaultKeyById.get(application.stageId);
      const targetId = key ? copyIdByKey.get(key) : undefined;
      if (!targetId) continue;
      repoints.push(
        this.prisma.client.application.update({
          where: { id: application.id },
          data: { stageId: targetId },
        }),
      );
    }

    if (repoints.length > 0) await this.prisma.client.$transaction(repoints);
  }

  /** Replaces the job's stage set with the supplied one, in payload order. */
  async replaceJobStages(jobId: string, input: UpdateJobStagesRequest): Promise<PipelineStageItem[]> {
    const tenantId = requireTenant();
    await this.findJobOrFail(jobId);

    // A job without its own copy inherits the tenant pipeline — materialise it
    // first so the diff below always operates on job-owned rows.
    await this.copyTenantStagesToJob(jobId);

    const existing = await this.prisma.client.jobPipelineStage.findMany({
      where: { jobId, deletedAt: null },
    });
    const existingById = new Map(existing.map((stage) => [stage.id, stage]));
    const existingByKey = new Map(existing.map((stage) => [stage.key, stage]));

    const keys = input.stages.map((stage) => stage.key);
    if (new Set(keys).size !== keys.length) {
      throw new ValidationError('Each stage key may appear only once in a pipeline.');
    }

    const strayIds = input.stages
      .map((stage) => stage.id)
      .filter((id): id is string => Boolean(id) && !existingById.has(id as string));
    if (strayIds.length > 0) {
      throw new ValidationError('Some of those stages do not belong to this job.', {
        stageIds: strayIds,
      });
    }

    // Identity is the stage id when supplied and its key otherwise, so a client
    // can send the pipeline it just read (ids) or a template it never fetched
    // (keys only) without accidentally creating a duplicate set of stages.
    const match = (entry: UpdateJobStagesRequest['stages'][number]) =>
      entry.id ? existingById.get(entry.id) : existingByKey.get(entry.key);

    const keptIds = new Set(
      input.stages.map((entry) => match(entry)?.id).filter((id): id is string => Boolean(id)),
    );
    const removals = existing.filter((stage) => !keptIds.has(stage.id));

    if (removals.length > 0) {
      const counts = await this.countApplications(removals.map((stage) => stage.id));
      const inUse = removals.filter((stage) => (counts.get(stage.id) ?? 0) > 0);
      if (inUse.length > 0) {
        throw new ConflictError(
          `These stages still hold applications: ${inUse.map((stage) => stage.name).join(', ')}. Move them first.`,
          { stageIds: inUse.map((stage) => stage.id) },
        );
      }
    }

    for (const entry of input.stages) {
      const data = {
        name: entry.name,
        type: entry.type,
        category: entry.category,
        color: entry.color,
        slaDays: entry.slaDays ?? null,
        description: entry.description ?? null,
        isTerminal: isTerminalFor(entry.category, entry.isTerminal),
      };

      const current = match(entry);
      if (current) {
        await this.prisma.client.jobPipelineStage.update({
          where: { id: current.id },
          data: { ...data },
        });
      } else {
        await this.prisma.client.jobPipelineStage.create({
          data: { ...data, tenantId, jobId, key: entry.key, order: 0 },
        });
      }
    }

    // Rewrite the order from the payload so a reorder is one atomic write.
    const refreshed = await this.prisma.client.jobPipelineStage.findMany({
      where: { jobId, deletedAt: null },
      select: { id: true, key: true },
    });
    const idByKey = new Map(refreshed.map((stage) => [stage.key, stage.id]));

    const reorder: Prisma.PrismaPromise<unknown>[] = [];
    input.stages.forEach((entry, index) => {
      const id = idByKey.get(entry.key);
      if (!id) return;
      reorder.push(
        this.prisma.client.jobPipelineStage.update({
          where: { id },
          data: { order: index },
        }),
      );
    });

    if (removals.length > 0) {
      reorder.push(
        this.prisma.client.jobPipelineStage.updateMany({
          where: { id: { in: removals.map((stage) => stage.id) } },
          data: { deletedAt: new Date() },
        }),
      );
    }
    if (reorder.length > 0) await this.prisma.client.$transaction(reorder);

    return this.listJobStages(jobId);
  }

  /**
   * The stages a job actually uses — its own copy when it has one, otherwise
   * the workspace default — with application counts scoped to that job. This is
   * what the board and the job detail render, so an inherited stage can never
   * report a count borrowed from another job.
   */
  async effectiveJobStages(jobId: string): Promise<PipelineStageItem[]> {
    const own = await this.prisma.client.jobPipelineStage.findMany({
      where: { jobId, deletedAt: null },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });

    const stages = own.length > 0 ? own : await this.listTenantStageRows();

    const counts = await this.countJobApplications(jobId, stages.map((stage) => stage.id));
    return stages.map((stage) => toStageItem(stage, counts.get(stage.id) ?? 0));
  }

  /** True when the job owns a private copy of the pipeline rather than inheriting the default. */
  async hasOwnStages(jobId: string): Promise<boolean> {
    const count = await this.prisma.client.jobPipelineStage.count({
      where: { jobId, deletedAt: null },
    });
    return count > 0;
  }

  // ---------------------------------------------------------------------------
  // Rejection reasons
  // ---------------------------------------------------------------------------

  async listRejectionReasons(query: RejectionReasonQuery): Promise<RejectionReasonItem[]> {
    const reasons = await this.prisma.client.rejectionReason.findMany({
      where: {
        deletedAt: null,
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ order: 'asc' }, { label: 'asc' }],
    });
    return reasons.map(toRejectionReasonItem);
  }

  async createRejectionReason(
    input: CreateRejectionReasonRequest,
  ): Promise<RejectionReasonItem> {
    const tenantId = requireTenant();

    const duplicate = await this.prisma.client.rejectionReason.findFirst({
      where: { key: input.key, deletedAt: null },
      select: { id: true },
    });
    if (duplicate) throw new ConflictError(`A rejection reason with the key “${input.key}” already exists.`);

    const last = await this.prisma.client.rejectionReason.findFirst({
      where: { deletedAt: null },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    const created = await this.prisma.client.rejectionReason.create({
      data: {
        tenantId,
        key: input.key,
        label: input.label,
        order: input.order > 0 ? input.order : (last?.order ?? -1) + 1,
        isActive: input.isActive,
        isSystem: false,
      },
    });

    return toRejectionReasonItem(created);
  }

  async updateRejectionReason(
    reasonId: string,
    input: UpdateRejectionReasonRequest,
  ): Promise<RejectionReasonItem> {
    await this.findRejectionReasonOrFail(reasonId);

    const data: Prisma.RejectionReasonUncheckedUpdateInput = {};
    if (input.label !== undefined) data.label = input.label;
    if (input.order !== undefined) data.order = input.order;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    const updated = await this.prisma.client.rejectionReason.update({
      where: { id: reasonId },
      data,
    });
    return toRejectionReasonItem(updated);
  }

  async deleteRejectionReason(reasonId: string): Promise<{ deleted: true }> {
    const reason = await this.findRejectionReasonOrFail(reasonId);

    if (reason.isSystem) {
      throw new ValidationError(
        `“${reason.label}” is a built-in reason. Deactivate it instead of deleting it.`,
      );
    }

    await this.prisma.client.rejectionReason.update({
      where: { id: reasonId },
      data: { deletedAt: new Date() },
    });
    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async listJobStages(jobId: string): Promise<PipelineStageItem[]> {
    const stages = await this.prisma.client.jobPipelineStage.findMany({
      where: { jobId, deletedAt: null },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    const counts = await this.countApplications(stages.map((stage) => stage.id));
    return stages.map((stage) => toStageItem(stage, counts.get(stage.id) ?? 0));
  }

  /** The tenant-default stage rows, in board order. */
  private listTenantStageRows(): Promise<StageRow[]> {
    return this.prisma.client.jobPipelineStage.findMany({
      where: { jobId: null, deletedAt: null },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private async findTenantStageOrFail(stageId: string): Promise<StageRow> {
    const stage = await this.prisma.client.jobPipelineStage.findFirst({
      where: { id: stageId, jobId: null, deletedAt: null },
    });
    if (!stage) throw new NotFoundError('Pipeline stage', stageId);
    return stage;
  }

  private async findRejectionReasonOrFail(reasonId: string): Promise<RejectionReasonRow> {
    const reason = await this.prisma.client.rejectionReason.findFirst({
      where: { id: reasonId, deletedAt: null },
    });
    if (!reason) throw new NotFoundError('Rejection reason', reasonId);
    return reason;
  }

  private async findJobOrFail(jobId: string): Promise<{ id: string; title: string }> {
    const job = await this.prisma.client.job.findFirst({
      where: { id: jobId, deletedAt: null },
      select: { id: true, title: true },
    });
    if (!job) throw new NotFoundError('Job', jobId);
    return job;
  }

  private async assertStageKeyAvailable(key: string, exceptId?: string): Promise<void> {
    const duplicate = await this.prisma.client.jobPipelineStage.findFirst({
      where: {
        jobId: null,
        key,
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) throw new ConflictError(`A stage with the key “${key}” already exists.`);
  }

  private async assertStageNameAvailable(name: string, exceptId?: string): Promise<void> {
    const duplicate = await this.prisma.client.jobPipelineStage.findFirst({
      where: {
        jobId: null,
        name,
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) throw new ConflictError(`A stage named “${name}” already exists.`);
  }

  /** Every workspace needs at least one stage candidates can sit in. */
  private async assertAnotherActiveStageExists(exceptId: string): Promise<void> {
    const other = await this.prisma.client.jobPipelineStage.count({
      where: { jobId: null, deletedAt: null, category: 'ACTIVE', id: { not: exceptId } },
    });
    if (other === 0) {
      throw new ValidationError('A workspace needs at least one active stage.');
    }
  }

  private async resolveMoveTarget(
    moveToStageId: string,
    fromStageId: string,
  ): Promise<{ id: string; name: string }> {
    if (moveToStageId === fromStageId) {
      throw new ValidationError('Choose a different stage to move applications to.', {
        moveToStageId,
      });
    }
    const target = await this.prisma.client.jobPipelineStage.findFirst({
      where: { id: moveToStageId, jobId: null, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!target) {
      throw new ValidationError('That destination stage does not exist.', { moveToStageId });
    }
    return target;
  }

  private async countApplications(stageIds: string[]): Promise<Map<string, number>> {
    if (stageIds.length === 0) return new Map();

    const grouped = await this.prisma.client.application.groupBy({
      by: ['stageId'],
      where: { stageId: { in: stageIds }, deletedAt: null },
      _count: { _all: true },
    });

    return new Map(grouped.map((row) => [row.stageId, row._count._all]));
  }

  /** Application counts per stage, narrowed to a single job. */
  private async countJobApplications(
    jobId: string,
    stageIds: string[],
  ): Promise<Map<string, number>> {
    if (stageIds.length === 0) return new Map();

    const grouped = await this.prisma.client.application.groupBy({
      by: ['stageId'],
      where: { jobId, stageId: { in: stageIds }, deletedAt: null },
      _count: { _all: true },
    });

    return new Map(grouped.map((row) => [row.stageId, row._count._all]));
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Only the terminal categories may be terminal — a stage the tenant marks
 * `HIRED`, `REJECTED` or `WITHDRAWN` closes the application either way.
 */
function isTerminalFor(category: string, requested: boolean): boolean {
  return requested || category !== 'ACTIVE';
}

function toSeconds(milliseconds: number): number {
  return Math.max(0, Math.round(milliseconds / 1000));
}

function toStageItem(stage: StageRow, applicationCount: number): PipelineStageItem {
  return {
    id: stage.id,
    key: stage.key,
    name: stage.name,
    type: stage.type,
    category: stage.category,
    color: stage.color,
    order: stage.order,
    isDefault: stage.isDefault,
    isTerminal: stage.isTerminal,
    slaDays: stage.slaDays,
    description: stage.description,
    requiredPermission: stage.requiredPermission,
    applicationCount,
    createdAt: stage.createdAt.toISOString(),
    updatedAt: stage.updatedAt.toISOString(),
  };
}

function toRejectionReasonItem(reason: RejectionReasonRow): RejectionReasonItem {
  return {
    id: reason.id,
    key: reason.key,
    label: reason.label,
    order: reason.order,
    isActive: reason.isActive,
    isSystem: reason.isSystem,
    createdAt: reason.createdAt.toISOString(),
    updatedAt: reason.updatedAt.toISOString(),
  };
}

function requireTenant(): string {
  const tenantId = requestContext.tenantId;
  if (!tenantId) throw new ForbiddenError('This action must run inside a workspace.');
  return tenantId;
}
