import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  buildPaginationMeta,
  toSkipTake,
  type AddToPipelineRequest,
  type AddToPipelineResult,
  type ApplicationCard,
  type ApplicationDetail,
  type ApplicationListItem,
  type ApplicationQuery,
  type BoardColumn,
  type BoardQuery,
  type BoardResponse,
  type MoveStageRequest,
  type Paginated,
  type RejectApplicationRequest,
  type RemoveFromPipelineQuery,
  type StageHistoryItem,
  type UpdateApplicationRequest,
  type WithdrawApplicationRequest,
} from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import { ForbiddenError, NotFoundError, ValidationError } from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { PipelineService } from '@/modules/pipeline/pipeline.service';

const DAY_MS = 86_400_000;

const APPLICATION_LIST_INCLUDE = {
  job: { select: { id: true, title: true, referenceCode: true } },
  candidate: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      currentTitle: true,
      currentCompany: true,
      locationCity: true,
      locationState: true,
      locationCountry: true,
      tags: true,
    },
  },
  stage: { select: { id: true, name: true, color: true, category: true, slaDays: true } },
  owner: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ApplicationInclude;

const STAGE_HISTORY_INCLUDE = {
  fromStage: { select: { id: true, name: true, color: true } },
  toStage: { select: { id: true, name: true, color: true } },
} satisfies Prisma.StageHistoryInclude;

const APPLICATION_DETAIL_INCLUDE = {
  ...APPLICATION_LIST_INCLUDE,
  history: {
    include: STAGE_HISTORY_INCLUDE,
    orderBy: { createdAt: 'asc' },
  },
  interviews: {
    select: {
      id: true,
      type: true,
      status: true,
      round: true,
      title: true,
      scheduledStart: true,
    },
    orderBy: { scheduledStart: 'asc' },
  },
  offers: {
    select: { id: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  },
  placement: { select: { id: true, status: true, startDate: true } },
} satisfies Prisma.ApplicationInclude;

const BOARD_CARD_INCLUDE = {
  candidate: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      currentTitle: true,
      currentCompany: true,
      locationCity: true,
      locationState: true,
      locationCountry: true,
      tags: true,
    },
  },
  owner: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ApplicationInclude;

type ApplicationWithList = Prisma.ApplicationGetPayload<{ include: typeof APPLICATION_LIST_INCLUDE }>;
type ApplicationWithDetail = Prisma.ApplicationGetPayload<{
  include: typeof APPLICATION_DETAIL_INCLUDE;
}>;
type BoardCardRow = Prisma.ApplicationGetPayload<{ include: typeof BOARD_CARD_INCLUDE }>;

type StageHistoryRow = {
  id: string;
  fromStage: { id: string; name: string; color: string } | null;
  toStage: { id: string; name: string; color: string };
  note: string | null;
  changedById: string | null;
  durationSeconds: number | null;
  createdAt: Date;
};

type UserBrief = { id: string; fullName: string; avatarUrl: string | null };

/**
 * Applications — the join between a candidate and a job, and the pipeline
 * operations that move it: add-to-pipeline, the Kanban board, stage moves
 * (with rejection handling, stage history and notifications), reject/withdraw
 * shortcuts and removal.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async list(query: ApplicationQuery): Promise<Paginated<ApplicationListItem>> {
    const where = await this.buildWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.client.application.findMany({
        where,
        include: APPLICATION_LIST_INCLUDE,
        orderBy: buildOrderBy(query),
        ...toSkipTake(query),
      }),
      this.prisma.client.application.count({ where }),
    ]);

    const now = Date.now();
    return {
      items: rows.map((row) => toApplicationListItem(row, now)),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async detail(applicationId: string): Promise<ApplicationDetail> {
    const application = await this.prisma.client.application.findFirst({
      where: { id: applicationId, deletedAt: null },
      include: APPLICATION_DETAIL_INCLUDE,
    });
    if (!application) throw new NotFoundError('Application', applicationId);

    const users = await this.loadUsers(application.history.map((row) => row.changedById));
    return toApplicationDetail(application, Date.now(), users);
  }

  async history(applicationId: string): Promise<StageHistoryItem[]> {
    await this.findApplicationOrFail(applicationId);

    const rows = await this.prisma.client.stageHistory.findMany({
      where: { applicationId },
      include: STAGE_HISTORY_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    const users = await this.loadUsers(rows.map((row) => row.changedById));
    return rows.map((row) => toStageHistoryItem(row, users));
  }

  /** Kanban payload: one column per effective stage, cards pre-sorted. */
  async board(jobId: string, query: BoardQuery): Promise<BoardResponse> {
    const job = await this.prisma.client.job.findFirst({
      where: { id: jobId, deletedAt: null },
      select: { id: true, title: true, referenceCode: true, status: true },
    });
    if (!job) throw new NotFoundError('Job', jobId);

    const allStages = await this.pipeline.effectiveJobStages(jobId);
    const stageFilter = parseCsv(query.stageIds);
    const stages =
      stageFilter.length > 0
        ? allStages.filter((stage) => stageFilter.includes(stage.id))
        : allStages;

    const now = Date.now();

    const columns: BoardColumn[] = await Promise.all(
      stages.map(async (stage) => {
        const where: Prisma.ApplicationWhereInput = {
          jobId,
          stageId: stage.id,
          deletedAt: null,
          ...(query.ownerId ? { ownerId: query.ownerId } : {}),
        };

        const [cards, total] = await Promise.all([
          this.prisma.client.application.findMany({
            where,
            include: BOARD_CARD_INCLUDE,
            orderBy: [{ boardOrder: 'asc' }, { appliedAt: 'asc' }],
            take: query.limitPerStage,
          }),
          this.prisma.client.application.count({ where }),
        ]);

        return {
          stage: {
            id: stage.id,
            key: stage.key,
            name: stage.name,
            category: stage.category,
            color: stage.color,
            order: stage.order,
            isTerminal: stage.isTerminal,
            slaDays: stage.slaDays,
          },
          total,
          cards: cards.map((card) => toApplicationCard(card, stage.slaDays, now)),
        };
      }),
    );

    return {
      job: {
        id: job.id,
        title: job.title,
        referenceCode: job.referenceCode,
        status: job.status,
      },
      columns,
    };
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  async addToPipeline(input: AddToPipelineRequest): Promise<AddToPipelineResult> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;

    const job = await this.prisma.client.job.findFirst({
      where: { id: input.jobId, deletedAt: null },
      select: { id: true, title: true, referenceCode: true },
    });
    if (!job) throw new NotFoundError('Job', input.jobId);

    const stages = await this.pipeline.effectiveJobStages(job.id);
    const destination = input.stageId
      ? stages.find((stage) => stage.id === input.stageId)
      : stages[0];
    if (!destination) {
      throw new ValidationError(
        input.stageId
          ? 'That stage does not belong to this job’s pipeline.'
          : 'This job has no pipeline stages to add candidates to.',
        { stageId: input.stageId ?? null },
      );
    }

    await this.assertCandidatesExist(input.candidateIds);
    if (input.ownerId) await this.assertUsersExist([input.ownerId]);

    const candidateIds = [...new Set(input.candidateIds)];
    const existing = await this.prisma.client.application.findMany({
      where: { jobId: job.id, candidateId: { in: candidateIds } },
      select: { candidateId: true },
    });
    const existingIds = new Set(existing.map((row) => row.candidateId));

    const toAdd = candidateIds.filter((candidateId) => !existingIds.has(candidateId));
    const skipped: AddToPipelineResult['skipped'] = candidateIds
      .filter((candidateId) => existingIds.has(candidateId))
      .map((candidateId) => ({ candidateId, reason: 'Already in this pipeline' }));

    if (toAdd.length === 0) return { added: [], skipped };

    const last = await this.prisma.client.application.findFirst({
      where: { jobId: job.id, stageId: destination.id },
      orderBy: { boardOrder: 'desc' },
      select: { boardOrder: true },
    });
    let boardOrder = (last?.boardOrder ?? 0) + 1;

    const now = new Date();
    const createdIds = await this.prisma.client.$transaction(async (tx) => {
      const ids: string[] = [];

      for (const candidateId of toAdd) {
        const application = await tx.application.create({
          data: {
            tenantId,
            jobId: job.id,
            candidateId,
            stageId: destination.id,
            status: 'ACTIVE',
            submissionStatus: 'DRAFT',
            source: input.source ?? null,
            ownerId: input.ownerId ?? userId,
            boardOrder,
            appliedAt: now,
            stageEnteredAt: now,
            lastStageChangedAt: now,
            createdById: userId,
            updatedById: userId,
          },
          select: { id: true },
        });
        boardOrder += 1;
        ids.push(application.id);

        await tx.stageHistory.create({
          data: {
            tenantId,
            applicationId: application.id,
            fromStageId: null,
            toStageId: destination.id,
            note: input.note ?? null,
            changedById: userId,
            durationSeconds: null,
          },
        });

        await tx.activity.create({
          data: {
            tenantId,
            type: 'SYSTEM',
            subject: 'Added to pipeline',
            body: input.note ?? null,
            entityType: 'JOB',
            entityId: job.id,
            jobId: job.id,
            candidateId,
            applicationId: application.id,
            createdById: userId,
          },
        });
      }

      return ids;
    });

    const added = await Promise.all(createdIds.map((id) => this.detail(id)));

    await this.audit.record({
      action: 'CREATE',
      entity: 'Application',
      entityId: job.id,
      description: `Added ${createdIds.length} candidate(s) to ${job.referenceCode}`,
    });

    return { added, skipped };
  }

  async update(
    applicationId: string,
    input: UpdateApplicationRequest,
  ): Promise<ApplicationDetail> {
    await this.findApplicationOrFail(applicationId);
    const userId = requestContext.userId ?? null;

    if (input.ownerId) await this.assertUsersExist([input.ownerId]);

    const data: Prisma.ApplicationUncheckedUpdateInput = { updatedById: userId };
    if (input.ownerId !== undefined) data.ownerId = input.ownerId ?? null;
    if (input.rating !== undefined) data.rating = input.rating ?? null;
    if (input.submissionStatus !== undefined) data.submissionStatus = input.submissionStatus;
    if (input.source !== undefined) data.source = input.source ?? null;

    await this.prisma.client.application.update({ where: { id: applicationId }, data });

    await this.audit.record({
      action: 'UPDATE',
      entity: 'Application',
      entityId: applicationId,
      description: 'Updated an application',
    });

    return this.detail(applicationId);
  }

  /**
   * The core pipeline operation. Runs move + history + activity + notification
   * inside one transaction so a partially-applied move can never be observed.
   */
  async moveStage(applicationId: string, input: MoveStageRequest): Promise<ApplicationDetail> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;

    const application = await this.prisma.client.application.findFirst({
      where: { id: applicationId, deletedAt: null },
      select: {
        id: true,
        jobId: true,
        candidateId: true,
        stageId: true,
        ownerId: true,
        stageEnteredAt: true,
      },
    });
    if (!application) throw new NotFoundError('Application', applicationId);

    const stages = await this.pipeline.effectiveJobStages(application.jobId);
    const destination = stages.find((stage) => stage.id === input.toStageId);
    if (!destination) {
      throw new ValidationError(
        'That destination stage does not belong to this job’s pipeline.',
        { toStageId: input.toStageId },
      );
    }

    const now = new Date();
    const data: Prisma.ApplicationUncheckedUpdateInput = {
      stageId: destination.id,
      stageEnteredAt: now,
      lastStageChangedAt: now,
      updatedById: userId,
    };

    if (destination.category === 'REJECTED') {
      if (!input.rejectionReasonId) {
        throw new ValidationError('Choose a rejection reason for this stage.', {
          toStageId: destination.id,
        });
      }
      const reason = await this.prisma.client.rejectionReason.findFirst({
        where: { id: input.rejectionReasonId, isActive: true, deletedAt: null },
        select: { id: true, label: true },
      });
      if (!reason) {
        throw new ValidationError('That rejection reason is not available.', {
          rejectionReasonId: input.rejectionReasonId,
        });
      }
      data.isRejected = true;
      data.rejectedReason = reason.label;
      data.rejectedAt = now;
      data.rejectedStageId = destination.id;
      data.status = 'REJECTED';
    } else if (destination.category === 'HIRED') {
      data.status = 'PLACED';
      data.isRejected = false;
      data.rejectedReason = null;
      data.rejectedAt = null;
      data.rejectedStageId = null;
    } else if (destination.category === 'WITHDRAWN') {
      data.status = 'WITHDRAWN';
      data.isRejected = false;
      data.rejectedReason = null;
      data.rejectedAt = null;
      data.rejectedStageId = null;
    } else {
      data.status = 'ACTIVE';
      data.isRejected = false;
      data.rejectedReason = null;
      data.rejectedAt = null;
      data.rejectedStageId = null;
    }

    let boardOrder = input.boardOrder ?? null;
    if (boardOrder === null) {
      const lastInColumn = await this.prisma.client.application.findFirst({
        where: { jobId: application.jobId, stageId: destination.id },
        orderBy: { boardOrder: 'desc' },
        select: { boardOrder: true },
      });
      boardOrder = (lastInColumn?.boardOrder ?? 0) + 1;
    }
    data.boardOrder = boardOrder;

    const durationSeconds = Math.max(
      0,
      Math.round((now.getTime() - application.stageEnteredAt.getTime()) / 1000),
    );
    const subject = `Moved to ${destination.name}`;
    const body = input.note ?? null;
    const notifyOwnerId =
      application.ownerId && application.ownerId !== userId ? application.ownerId : null;

    await this.prisma.client.$transaction(async (tx) => {
      await tx.application.update({ where: { id: applicationId }, data });

      await tx.stageHistory.create({
        data: {
          tenantId,
          applicationId,
          fromStageId: application.stageId,
          toStageId: destination.id,
          note: body,
          changedById: userId,
          durationSeconds,
        },
      });

      await tx.activity.create({
        data: {
          tenantId,
          type: 'STAGE_CHANGE',
          subject,
          body,
          entityType: 'APPLICATION',
          entityId: applicationId,
          applicationId,
          jobId: application.jobId,
          candidateId: application.candidateId,
          createdById: userId,
        },
      });

      if (notifyOwnerId) {
        await tx.notification.createMany({
          data: [
            {
              tenantId,
              userId: notifyOwnerId,
              type: 'application.stage_changed',
              channel: 'IN_APP',
              title: 'A candidate changed stage',
              body: `${subject} on an application you own`,
              link: `/jobs/${application.jobId}`,
              actorId: userId,
              entityType: 'APPLICATION',
              entityId: applicationId,
            },
          ],
        });
      }
    });

    await this.audit.record({
      action: 'STATUS_CHANGE',
      entity: 'Application',
      entityId: applicationId,
      description: `${subject} (${destination.category})`,
    });

    return this.detail(applicationId);
  }

  async reject(
    applicationId: string,
    input: RejectApplicationRequest,
  ): Promise<ApplicationDetail> {
    const application = await this.findApplicationOrFail(applicationId);
    const rejected = await this.findCategoryStage(application.jobId, 'REJECTED');
    if (!rejected) throw new ValidationError('This job has no rejected stage configured.');

    return this.moveStage(applicationId, {
      toStageId: rejected.id,
      note: input.note ?? null,
      rejectionReasonId: input.rejectionReasonId,
    });
  }

  async withdraw(
    applicationId: string,
    input: WithdrawApplicationRequest,
  ): Promise<ApplicationDetail> {
    const application = await this.findApplicationOrFail(applicationId);
    const withdrawn = await this.findCategoryStage(application.jobId, 'WITHDRAWN');
    if (!withdrawn) throw new ValidationError('This job has no withdrawn stage configured.');

    return this.moveStage(applicationId, {
      toStageId: withdrawn.id,
      note: input.note ?? null,
    });
  }

  async remove(
    applicationId: string,
    query: RemoveFromPipelineQuery,
  ): Promise<{ removed: true }> {
    await this.findApplicationOrFail(applicationId);
    const userId = requestContext.userId ?? null;

    if (query.mode === 'HARD') {
      await this.prisma.client.$transaction([
        this.prisma.client.stageHistory.deleteMany({ where: { applicationId } }),
        this.prisma.client.application.delete({ where: { id: applicationId } }),
      ]);
    } else {
      await this.prisma.client.application.update({
        where: { id: applicationId },
        data: { deletedAt: new Date(), status: 'WITHDRAWN', updatedById: userId },
      });
    }

    await this.audit.record({
      action: 'DELETE',
      entity: 'Application',
      entityId: applicationId,
      description:
        query.mode === 'HARD'
          ? 'Hard-removed an application'
          : query.note ?? 'Removed a candidate from the pipeline',
    });

    return { removed: true };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async buildWhere(query: ApplicationQuery): Promise<Prisma.ApplicationWhereInput> {
    const userId = requireUser();
    const context = requestContext.getOrThrow();
    const and: Prisma.ApplicationWhereInput[] = [];

    const canReadAll =
      context.isSuperAdmin || hasPermission(context.permissions, 'application:read_all');
    if (!canReadAll) {
      // Applications the caller owns, or on a job they are assigned to.
      and.push({ OR: [{ ownerId: userId }, { job: { assignments: { some: { userId } } } }] });
    }

    if (query.jobId) and.push({ jobId: query.jobId });
    if (query.candidateId) and.push({ candidateId: query.candidateId });
    if (query.stageId) and.push({ stageId: query.stageId });
    if (query.ownerId) and.push({ ownerId: query.ownerId });

    const statuses = toArray(query.status);
    if (statuses.length > 0) and.push({ status: { in: statuses } });

    if (query.submittedOnly) and.push({ submissionStatus: { not: 'DRAFT' } });

    if (query.staleOnly) and.push(await this.buildStaleCondition());

    return and.length > 0 ? { deletedAt: null, AND: and } : { deletedAt: null };
  }

  /**
   * Stale = the application has sat in its current stage longer than that
   * stage's SLA. Each stage carries its own `slaDays`, so this becomes an OR of
   * per-stage conditions; stages without an SLA never match.
   */
  private async buildStaleCondition(): Promise<Prisma.ApplicationWhereInput> {
    const stages = await this.prisma.client.jobPipelineStage.findMany({
      where: { deletedAt: null, slaDays: { not: null } },
      select: { id: true, slaDays: true },
    });

    const now = Date.now();
    const conditions = stages
      .filter((stage) => stage.slaDays !== null)
      .map((stage) => ({
        stageId: stage.id,
        stageEnteredAt: { lte: new Date(now - (stage.slaDays as number) * DAY_MS) },
      }));

    return conditions.length > 0 ? { OR: conditions } : { id: { in: [] } };
  }

  private async findCategoryStage(
    jobId: string,
    category: 'REJECTED' | 'WITHDRAWN',
  ): Promise<{ id: string; name: string } | null> {
    const stages = await this.pipeline.effectiveJobStages(jobId);
    const stage = stages.find((entry) => entry.category === category);
    return stage ? { id: stage.id, name: stage.name } : null;
  }

  private async findApplicationOrFail(applicationId: string): Promise<{
    id: string;
    jobId: string;
    candidateId: string;
    stageId: string;
    ownerId: string | null;
    stageEnteredAt: Date;
  }> {
    const application = await this.prisma.client.application.findFirst({
      where: { id: applicationId, deletedAt: null },
      select: {
        id: true,
        jobId: true,
        candidateId: true,
        stageId: true,
        ownerId: true,
        stageEnteredAt: true,
      },
    });
    if (!application) throw new NotFoundError('Application', applicationId);
    return application;
  }

  private async assertCandidatesExist(candidateIds: string[]): Promise<void> {
    const unique = [...new Set(candidateIds)];
    if (unique.length === 0) return;

    const found = await this.prisma.client.candidate.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true },
    });
    const missing = unique.filter((id) => !found.some((candidate) => candidate.id === id));
    if (missing.length > 0) {
      throw new ValidationError('Some of those candidates do not exist.', { candidateIds: missing });
    }
  }

  private async assertUsersExist(userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;

    const found = await this.prisma.client.user.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true },
    });
    const missing = unique.filter((id) => !found.some((user) => user.id === id));
    if (missing.length > 0) {
      throw new ValidationError('Some of those users do not exist.', { userIds: missing });
    }
  }

  private async loadUsers(ids: (string | null | undefined)[]): Promise<Map<string, UserBrief>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map();

    const users = await this.prisma.client.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true },
    });

    return new Map(
      users.map((user) => [
        user.id,
        {
          id: user.id,
          fullName: composeName(user.firstName, user.lastName),
          avatarUrl: user.avatarUrl,
        },
      ]),
    );
  }
}

// -----------------------------------------------------------------------------
// Mappers
// -----------------------------------------------------------------------------

function toApplicationListItem(app: ApplicationWithList, now: number): ApplicationListItem {
  const daysInStage = daysSince(app.stageEnteredAt, now);
  return {
    id: app.id,
    job: { id: app.job.id, title: app.job.title, referenceCode: app.job.referenceCode },
    candidate: {
      id: app.candidate.id,
      fullName: composeName(app.candidate.firstName, app.candidate.lastName),
      avatarUrl: null,
    },
    stage: {
      id: app.stage.id,
      name: app.stage.name,
      color: app.stage.color,
      category: app.stage.category,
    },
    status: app.status,
    submissionStatus: app.submissionStatus,
    owner: toOwner(app.owner),
    rating: app.rating,
    appliedAt: app.appliedAt.toISOString(),
    stageEnteredAt: app.stageEnteredAt.toISOString(),
    daysInStage,
    slaBreached: app.stage.slaDays !== null && daysInStage > app.stage.slaDays,
    rejectedReason: app.rejectedReason,
  };
}

function toApplicationDetail(
  app: ApplicationWithDetail,
  now: number,
  users: Map<string, UserBrief>,
): ApplicationDetail {
  return {
    ...toApplicationListItem(app, now),
    candidate: {
      id: app.candidate.id,
      fullName: composeName(app.candidate.firstName, app.candidate.lastName),
      avatarUrl: null,
      email: app.candidate.email,
    },
    source: app.source,
    submittedAt: app.submittedAt?.toISOString() ?? null,
    clientFeedback: app.clientFeedback,
    clientFeedbackAt: app.clientFeedbackAt?.toISOString() ?? null,
    rejectedAt: app.rejectedAt?.toISOString() ?? null,
    rejectedStageId: app.rejectedStageId,
    resumeId: app.resumeId,
    history: app.history.map((row) => toStageHistoryItem(row, users)),
    interviews: app.interviews.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      round: row.round,
      title: row.title,
      scheduledAt: row.scheduledStart.toISOString(),
    })),
    offers: app.offers.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    })),
    placement: app.placement
      ? {
          id: app.placement.id,
          status: app.placement.status,
          startDate: app.placement.startDate?.toISOString() ?? null,
        }
      : null,
  };
}

function toApplicationCard(
  app: BoardCardRow,
  slaDays: number | null,
  now: number,
): ApplicationCard {
  const daysInStage = daysSince(app.stageEnteredAt, now);
  return {
    id: app.id,
    candidateId: app.candidateId,
    candidateName: composeName(app.candidate.firstName, app.candidate.lastName),
    candidateAvatarUrl: null,
    currentTitle: app.candidate.currentTitle,
    currentCompany: app.candidate.currentCompany,
    location: composeLocation(
      app.candidate.locationCity,
      app.candidate.locationState,
      app.candidate.locationCountry,
    ),
    rating: app.rating,
    stageId: app.stageId,
    boardOrder: app.boardOrder,
    status: app.status,
    submissionStatus: app.submissionStatus,
    owner: toOwner(app.owner),
    tags: app.candidate.tags,
    isRejected: app.isRejected,
    daysInStage,
    slaBreached: slaDays !== null && daysInStage > slaDays,
    appliedAt: app.appliedAt.toISOString(),
    stageEnteredAt: app.stageEnteredAt.toISOString(),
  };
}

function toStageHistoryItem(
  row: StageHistoryRow,
  users: Map<string, UserBrief>,
): StageHistoryItem {
  const author = row.changedById ? users.get(row.changedById) ?? null : null;
  return {
    id: row.id,
    fromStage: row.fromStage
      ? { id: row.fromStage.id, name: row.fromStage.name, color: row.fromStage.color }
      : null,
    toStage: { id: row.toStage.id, name: row.toStage.name, color: row.toStage.color },
    note: row.note,
    changedBy: author
      ? { id: author.id, fullName: author.fullName, avatarUrl: author.avatarUrl }
      : null,
    durationSeconds: row.durationSeconds,
    createdAt: row.createdAt.toISOString(),
  };
}

function toOwner(
  owner: { id: string; firstName: string; lastName: string } | null,
): { id: string; fullName: string } | null {
  if (!owner) return null;
  return { id: owner.id, fullName: composeName(owner.firstName, owner.lastName) };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function requireTenant(): string {
  const tenantId = requestContext.tenantId;
  if (!tenantId) throw new ForbiddenError('This action must run inside a workspace.');
  return tenantId;
}

function requireUser(): string {
  const userId = requestContext.userId;
  if (!userId) throw new ForbiddenError('This action requires an authenticated user.');
  return userId;
}

/** Mirrors `PermissionsGuard`: holding `_all` satisfies an `_own` requirement. */
function hasPermission(granted: readonly string[], required: string): boolean {
  if (granted.includes(required)) return true;
  if (required.endsWith('_own')) {
    return granted.includes(`${required.replace(/_own$/, '')}_all`);
  }
  return false;
}

function buildOrderBy(query: ApplicationQuery): Prisma.ApplicationOrderByWithRelationInput[] {
  const dir = query.sortDir;
  switch (query.sortBy) {
    case 'updatedAt':
      return [{ updatedAt: dir }];
    case 'stageEnteredAt':
      return [{ stageEnteredAt: dir }];
    case 'boardOrder':
      return [{ boardOrder: dir }];
    case 'rating':
      return [{ rating: dir }];
    default:
      return [{ appliedAt: dir }];
  }
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function composeName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

function composeLocation(
  city: string | null,
  state: string | null,
  country: string | null,
): string | null {
  const parts = [city, state, country].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(', ') : null;
}

function daysSince(date: Date, now: number): number {
  return Math.max(0, Math.floor((now - date.getTime()) / DAY_MS));
}
