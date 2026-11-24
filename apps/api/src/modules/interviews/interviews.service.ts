import { Injectable } from '@nestjs/common';
import type { InterviewStatus, Prisma } from '@prisma/client';

import {
  INTERVIEW_STATUS_LABELS,
  INTERVIEW_TYPE_LABELS,
  buildPaginationMeta,
  toSkipTake,
  type CreateInterviewRequest,
  type InterviewCalendarItem,
  type InterviewCalendarQuery,
  type InterviewDetail,
  type InterviewFeedbackRequest,
  type InterviewListItem,
  type InterviewParticipant,
  type InterviewQuery,
  type Paginated,
  type UpdateInterviewRequest,
} from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import { PrismaService } from '@/infra/prisma/prisma.service';
import type { TenantScopedClient } from '@/infra/prisma/tenancy.extension';
import { PipelineService } from '@/modules/pipeline/pipeline.service';

/**
 * The client Prisma hands to a `$transaction` callback. It is the tenancy
 * extended client minus the lifecycle methods, not Prisma's vanilla
 * `TransactionClient`, so it has to be derived rather than imported.
 */
type TransactionClient = Parameters<Parameters<TenantScopedClient['$transaction']>[0]>[0];

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Calendar reads are bounded so a wide window can never stream the whole table. */
const CALENDAR_LIMIT = 500;

const INTERVIEW_INCLUDE = {
  application: {
    select: {
      id: true,
      jobId: true,
      candidateId: true,
      job: {
        select: {
          id: true,
          title: true,
          referenceCode: true,
          client: { select: { id: true, name: true } },
        },
      },
      candidate: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  interviewers: {
    select: {
      userId: true,
      isLead: true,
      user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    },
  },
} satisfies Prisma.InterviewInclude;

type InterviewRow = Prisma.InterviewGetPayload<{ include: typeof INTERVIEW_INCLUDE }>;

/** The columns every write path needs to address the interview's application. */
const INTERVIEW_ADDRESS_SELECT = {
  id: true,
  applicationId: true,
  status: true,
  type: true,
  round: true,
  scheduledStart: true,
  scheduledEnd: true,
  durationMinutes: true,
  application: {
    select: {
      jobId: true,
      candidateId: true,
      job: { select: { clientId: true } },
    },
  },
} satisfies Prisma.InterviewSelect;

type InterviewAddressRow = Prisma.InterviewGetPayload<{
  select: typeof INTERVIEW_ADDRESS_SELECT;
}>;

interface InterviewAddress {
  id: string;
  applicationId: string;
  jobId: string;
  candidateId: string;
  clientId: string | null;
  status: InterviewStatus;
  type: InterviewRow['type'];
  round: number;
  scheduledStart: Date;
  scheduledEnd: Date;
  durationMinutes: number;
}

/**
 * Interviews — the scheduling half of an application.
 *
 * An interview belongs to an application, not to a job, so the candidate, the
 * requisition and the client are all reachable through one relation. Panel
 * members are ordinary workspace users joined through `InterviewInterviewer`;
 * exactly one of them is marked lead. As with submissions, every state change
 * is mirrored onto the application's activity feed, and scheduling a first
 * interview walks the candidate forward to the pipeline's `INTERVIEW` stage.
 */
@Injectable()
export class InterviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async list(query: InterviewQuery): Promise<Paginated<InterviewListItem>> {
    const where = this.buildWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.client.interview.findMany({
        where,
        include: INTERVIEW_INCLUDE,
        orderBy: buildOrderBy(query),
        ...toSkipTake(query),
      }),
      this.prisma.client.interview.count({ where }),
    ]);

    const now = Date.now();
    return {
      items: rows.map((row) => toInterviewListItem(row, now)),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async detail(interviewId: string): Promise<InterviewDetail> {
    const interview = await this.prisma.client.interview.findFirst({
      where: { id: interviewId, deletedAt: null },
      include: INTERVIEW_INCLUDE,
    });
    if (!interview) throw new NotFoundError('Interview', interviewId);

    const submittedBy = interview.submittedById
      ? await this.loadParticipant(interview.submittedById)
      : null;

    return {
      ...toInterviewListItem(interview, Date.now()),
      feedback: interview.feedback,
      strengths: interview.strengths,
      concerns: interview.concerns,
      feedbackAt: interview.feedbackAt?.toISOString() ?? null,
      submittedBy,
    };
  }

  async calendar(query: InterviewCalendarQuery): Promise<InterviewCalendarItem[]> {
    if (query.from.getTime() > query.to.getTime()) {
      throw new ValidationError('The calendar window must end after it starts.', {
        from: query.from,
        to: query.to,
      });
    }

    const rows = await this.prisma.client.interview.findMany({
      where: {
        deletedAt: null,
        // A cancelled interview has no place on a calendar.
        status: { not: 'CANCELLED' },
        scheduledEnd: { gte: query.from },
        scheduledStart: { lte: query.to },
        ...(query.interviewerId
          ? { interviewers: { some: { userId: query.interviewerId } } }
          : {}),
        ...(query.jobId ? { application: { jobId: query.jobId } } : {}),
      },
      include: INTERVIEW_INCLUDE,
      orderBy: { scheduledStart: 'asc' },
      take: CALENDAR_LIMIT,
    });

    return rows.map(toCalendarItem);
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  async create(input: CreateInterviewRequest): Promise<InterviewDetail> {
    const tenantId = requireTenant();
    const userId = requireUser();

    const application = await this.prisma.client.application.findFirst({
      where: { id: input.applicationId, deletedAt: null },
      select: {
        id: true,
        jobId: true,
        candidateId: true,
        stageId: true,
        job: { select: { clientId: true } },
      },
    });
    if (!application) throw new NotFoundError('Application', input.applicationId);

    const timing = resolveTiming(input.scheduledStart, input.scheduledEnd ?? null, input.durationMinutes);
    await this.assertInterviewersExist(input.interviewerIds);

    const created = await this.prisma.client.$transaction(async (tx) => {
      const interview = await tx.interview.create({
        data: {
          tenantId,
          applicationId: application.id,
          type: input.type,
          round: input.round,
          title: input.title ?? null,
          scheduledStart: timing.start,
          scheduledEnd: timing.end,
          durationMinutes: timing.durationMinutes,
          timezone: input.timezone,
          location: input.location ?? null,
          meetingUrl: input.meetingUrl ?? null,
          externalInterviewer: input.externalInterviewer ?? null,
          createdById: userId,
          updatedById: userId,
          interviewers: {
            create: input.interviewerIds.map((interviewerId, index) => ({
              tenantId,
              userId: interviewerId,
              isLead: index === 0,
            })),
          },
        },
        select: { id: true },
      });

      await tx.activity.create({
        data: {
          tenantId,
          type: 'INTERVIEW',
          subject: `${INTERVIEW_TYPE_LABELS[input.type]} interview · round ${input.round}`,
          body: input.title ?? null,
          occurredAt: timing.start,
          entityType: 'APPLICATION',
          entityId: application.id,
          applicationId: application.id,
          jobId: application.jobId,
          candidateId: application.candidateId,
          clientId: application.job?.clientId ?? null,
          createdById: userId,
        },
      });

      await this.advanceToInterviewStage(tx, {
        tenantId,
        userId,
        applicationId: application.id,
        jobId: application.jobId,
        stageId: application.stageId,
        at: timing.start,
      });

      return interview;
    });

    await this.audit.record({
      action: 'CREATE',
      entity: 'Interview',
      entityId: created.id,
      description: `Scheduled a ${INTERVIEW_TYPE_LABELS[input.type].toLowerCase()} interview`,
    });

    return this.detail(created.id);
  }

  /** Edits or reschedules. Moving the start marks the interview rescheduled. */
  async update(interviewId: string, input: UpdateInterviewRequest): Promise<InterviewDetail> {
    const tenantId = requireTenant();
    const userId = requireUser();

    const existing = await this.findOrFail(interviewId);

    const rescheduled =
      input.scheduledStart !== undefined &&
      input.scheduledStart.getTime() !== existing.scheduledStart.getTime();

    const data: Prisma.InterviewUncheckedUpdateInput = { updatedById: userId };

    if (input.type !== undefined) data.type = input.type;
    if (input.round !== undefined) data.round = input.round;
    if (input.title !== undefined) data.title = input.title ?? null;
    if (input.timezone !== undefined) data.timezone = input.timezone;
    if (input.location !== undefined) data.location = input.location ?? null;
    if (input.meetingUrl !== undefined) data.meetingUrl = input.meetingUrl ?? null;
    if (input.externalInterviewer !== undefined) {
      data.externalInterviewer = input.externalInterviewer ?? null;
    }

    if (
      input.scheduledStart !== undefined ||
      input.scheduledEnd !== undefined ||
      input.durationMinutes !== undefined
    ) {
      const timing = resolveTiming(
        input.scheduledStart ?? existing.scheduledStart,
        input.scheduledEnd ?? null,
        input.durationMinutes ?? existing.durationMinutes,
      );
      data.scheduledStart = timing.start;
      data.scheduledEnd = timing.end;
      data.durationMinutes = timing.durationMinutes;
    }

    // An explicit status always wins; otherwise a moved start is what changes it.
    const nextStatus: InterviewStatus | undefined =
      input.status ?? (rescheduled ? 'RESCHEDULED' : undefined);
    if (nextStatus) data.status = nextStatus;
    const statusChanged = nextStatus !== undefined && nextStatus !== existing.status;

    if (input.interviewerIds !== undefined) await this.assertInterviewersExist(input.interviewerIds);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.interview.update({ where: { id: interviewId }, data });

      if (input.interviewerIds !== undefined) {
        await tx.interviewInterviewer.deleteMany({ where: { interviewId } });
        if (input.interviewerIds.length > 0) {
          await tx.interviewInterviewer.createMany({
            data: input.interviewerIds.map((interviewerId, index) => ({
              tenantId,
              interviewId,
              userId: interviewerId,
              isLead: index === 0,
            })),
          });
        }
      }

      if (statusChanged && nextStatus) {
        await tx.activity.create({
          data: {
            tenantId,
            type: 'INTERVIEW',
            subject: `Interview ${INTERVIEW_STATUS_LABELS[nextStatus].toLowerCase()}`,
            entityType: 'APPLICATION',
            entityId: existing.applicationId,
            applicationId: existing.applicationId,
            jobId: existing.jobId,
            candidateId: existing.candidateId,
            clientId: existing.clientId,
            createdById: userId,
          },
        });
      }
    });

    await this.audit.record({
      action: 'UPDATE',
      entity: 'Interview',
      entityId: interviewId,
      description: statusChanged && nextStatus
        ? `Interview marked ${INTERVIEW_STATUS_LABELS[nextStatus].toLowerCase()}`
        : 'Updated an interview',
    });

    return this.detail(interviewId);
  }

  /** Cancels and soft-deletes in one step — a cancelled interview is history. */
  async remove(interviewId: string): Promise<{ deleted: true }> {
    const tenantId = requireTenant();
    const userId = requireUser();

    const existing = await this.findOrFail(interviewId);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.interview.update({
        where: { id: interviewId },
        data: { deletedAt: new Date(), status: 'CANCELLED', updatedById: userId },
      });

      await tx.activity.create({
        data: {
          tenantId,
          type: 'INTERVIEW',
          subject: 'Interview cancelled',
          entityType: 'APPLICATION',
          entityId: existing.applicationId,
          applicationId: existing.applicationId,
          jobId: existing.jobId,
          candidateId: existing.candidateId,
          clientId: existing.clientId,
          createdById: userId,
        },
      });
    });

    await this.audit.record({
      action: 'DELETE',
      entity: 'Interview',
      entityId: interviewId,
      description: 'Cancelled an interview',
    });

    return { deleted: true };
  }

  /**
   * Records an interviewer's scorecard. Submitting one closes the interview
   * unless it was already marked done, so the list's status column stays true
   * without a second action.
   */
  async addFeedback(
    interviewId: string,
    input: InterviewFeedbackRequest,
  ): Promise<InterviewDetail> {
    const tenantId = requireTenant();
    const userId = requireUser();

    const existing = await this.findOrFail(interviewId);
    if (existing.status === 'CANCELLED') {
      throw new ValidationError('This interview was cancelled, so it cannot be scored.');
    }

    const now = new Date();

    await this.prisma.client.$transaction(async (tx) => {
      await tx.interview.update({
        where: { id: interviewId },
        data: {
          feedback: input.feedback,
          rating: input.rating,
          strengths: input.strengths ?? null,
          concerns: input.concerns ?? null,
          feedbackAt: now,
          submittedById: userId,
          updatedById: userId,
          ...(existing.status === 'COMPLETED' ? {} : { status: 'COMPLETED' }),
        },
      });

      await tx.activity.create({
        data: {
          tenantId,
          type: 'INTERVIEW',
          subject: `Interview feedback · ${input.rating}/5`,
          body: input.feedback,
          occurredAt: now,
          entityType: 'APPLICATION',
          entityId: existing.applicationId,
          applicationId: existing.applicationId,
          jobId: existing.jobId,
          candidateId: existing.candidateId,
          clientId: existing.clientId,
          createdById: userId,
        },
      });
    });

    await this.audit.record({
      action: 'UPDATE',
      entity: 'Interview',
      entityId: interviewId,
      description: 'Recorded interview feedback',
    });

    return this.detail(interviewId);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private buildWhere(query: InterviewQuery): Prisma.InterviewWhereInput {
    const and: Prisma.InterviewWhereInput[] = [];

    const statuses = toArray(query.status);
    if (statuses.length > 0) and.push({ status: { in: statuses } });

    const types = toArray(query.type);
    if (types.length > 0) and.push({ type: { in: types } });

    if (query.applicationId) and.push({ applicationId: query.applicationId });
    if (query.jobId) and.push({ application: { jobId: query.jobId } });
    if (query.candidateId) and.push({ application: { candidateId: query.candidateId } });
    if (query.interviewerId) and.push({ interviewers: { some: { userId: query.interviewerId } } });

    // `from`/`to` bound an overlap window rather than the start instant, so an
    // interview that began before the window but runs into it is still returned.
    if (query.from) and.push({ scheduledEnd: { gte: query.from } });
    if (query.to) and.push({ scheduledStart: { lte: query.to } });

    const upcoming: Prisma.InterviewWhereInput = {
      scheduledStart: { gte: new Date() },
      status: { not: 'CANCELLED' },
    };
    if (query.upcoming === true) and.push(upcoming);
    else if (query.upcoming === false) and.push({ NOT: upcoming });

    if (query.q) {
      const like = { contains: query.q, mode: 'insensitive' as const };
      and.push({
        OR: [
          { title: like },
          { externalInterviewer: like },
          { application: { candidate: { OR: [{ firstName: like }, { lastName: like }] } } },
          { application: { job: { title: like } } },
        ],
      });
    }

    return { deletedAt: null, AND: and };
  }

  private async findOrFail(interviewId: string): Promise<InterviewAddress> {
    const row: InterviewAddressRow | null = await this.prisma.client.interview.findFirst({
      where: { id: interviewId, deletedAt: null },
      select: INTERVIEW_ADDRESS_SELECT,
    });
    if (!row) throw new NotFoundError('Interview', interviewId);

    return {
      id: row.id,
      applicationId: row.applicationId,
      jobId: row.application.jobId,
      candidateId: row.application.candidateId,
      clientId: row.application.job?.clientId ?? null,
      status: row.status,
      type: row.type,
      round: row.round,
      scheduledStart: row.scheduledStart,
      scheduledEnd: row.scheduledEnd,
      durationMinutes: row.durationMinutes,
    };
  }

  /**
   * Walks the candidate onto the pipeline's `INTERVIEW` stage — but only
   * forwards. A follow-up call on a candidate who is already at the offer stage
   * must not drag them back down the board.
   */
  private async advanceToInterviewStage(
    tx: TransactionClient,
    context: {
      tenantId: string;
      userId: string;
      applicationId: string;
      jobId: string;
      stageId: string;
      at: Date;
    },
  ): Promise<void> {
    const stages = await this.pipeline.effectiveJobStages(context.jobId);
    const destination = stages.find((stage) => stage.type === 'INTERVIEW');
    if (!destination) return;

    const current = stages.find((stage) => stage.id === context.stageId);
    if (current && destination.order <= current.order) return;

    const last = await tx.application.findFirst({
      where: { jobId: context.jobId, stageId: destination.id },
      orderBy: { boardOrder: 'desc' },
      select: { boardOrder: true },
    });

    await tx.application.update({
      where: { id: context.applicationId },
      data: {
        stageId: destination.id,
        stageEnteredAt: context.at,
        lastStageChangedAt: context.at,
        boardOrder: (last?.boardOrder ?? 0) + 1,
      },
    });

    await tx.stageHistory.create({
      data: {
        tenantId: context.tenantId,
        applicationId: context.applicationId,
        fromStageId: context.stageId,
        toStageId: destination.id,
        note: 'Interview scheduled',
        changedById: context.userId,
      },
    });
  }

  private async assertInterviewersExist(userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;

    const found = await this.prisma.client.user.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true },
    });

    const missing = unique.filter((id) => !found.some((user) => user.id === id));
    if (missing.length > 0) {
      throw new ValidationError('Some of those interviewers do not exist.', { userIds: missing });
    }
  }

  private async loadParticipant(userId: string): Promise<InterviewParticipant | null> {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true },
    });
    if (!user) return null;

    return {
      id: user.id,
      fullName: composeName(user.firstName, user.lastName),
      avatarUrl: user.avatarUrl,
      isLead: false,
    };
  }
}

// -----------------------------------------------------------------------------
// Mappers
// -----------------------------------------------------------------------------

function toInterviewListItem(row: InterviewRow, now: number): InterviewListItem {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    round: row.round,
    title: row.title,
    scheduledStart: row.scheduledStart.toISOString(),
    scheduledEnd: row.scheduledEnd.toISOString(),
    durationMinutes: row.durationMinutes,
    timezone: row.timezone,
    location: row.location,
    meetingUrl: row.meetingUrl,
    externalInterviewer: row.externalInterviewer,
    application: {
      id: row.application.id,
      job: {
        id: row.application.job.id,
        title: row.application.job.title,
        referenceCode: row.application.job.referenceCode,
      },
      candidate: {
        id: row.application.candidate.id,
        fullName: composeName(row.application.candidate.firstName, row.application.candidate.lastName),
      },
      client: row.application.job.client
        ? { id: row.application.job.client.id, name: row.application.job.client.name }
        : null,
    },
    interviewers: toPanel(row.interviewers),
    ageDays: Math.max(0, Math.floor((now - row.createdAt.getTime()) / DAY_MS)),
    hasFeedback: row.feedback !== null,
    rating: row.rating,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCalendarItem(row: InterviewRow): InterviewCalendarItem {
  return {
    id: row.id,
    title:
      row.title ??
      `${candidateName(row)} · ${INTERVIEW_TYPE_LABELS[row.type]}`,
    type: row.type,
    status: row.status,
    round: row.round,
    scheduledStart: row.scheduledStart.toISOString(),
    scheduledEnd: row.scheduledEnd.toISOString(),
    timezone: row.timezone,
    durationMinutes: row.durationMinutes,
    applicationId: row.application.id,
    candidateName: candidateName(row),
    jobTitle: row.application.job.title,
    interviewers: toPanel(row.interviewers).map((participant) => ({
      id: participant.id,
      fullName: participant.fullName,
      avatarUrl: participant.avatarUrl,
    })),
  };
}

/** Lead first, then alphabetical — the panel reads the same way everywhere. */
function toPanel(rows: InterviewRow['interviewers']): InterviewParticipant[] {
  return [...rows]
    .sort(
      (a, b) =>
        Number(b.isLead) - Number(a.isLead) ||
        a.user.firstName.localeCompare(b.user.firstName),
    )
    .map((row) => ({
      id: row.user.id,
      fullName: composeName(row.user.firstName, row.user.lastName),
      avatarUrl: row.user.avatarUrl,
      isLead: row.isLead,
    }));
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Reconciles `scheduledStart`/`scheduledEnd`/`durationMinutes` so the three
 * columns can never disagree: an explicit end wins and sets the duration,
 * otherwise the duration extends the start.
 */
function resolveTiming(
  start: Date,
  end: Date | null,
  durationMinutes: number,
): { start: Date; end: Date; durationMinutes: number } {
  const resolvedEnd = end ?? new Date(start.getTime() + durationMinutes * MINUTE_MS);

  if (resolvedEnd.getTime() <= start.getTime()) {
    throw new ValidationError('The interview must end after it starts.', {
      scheduledStart: start,
      scheduledEnd: resolvedEnd,
    });
  }

  const minutes = end
    ? Math.max(1, Math.round((resolvedEnd.getTime() - start.getTime()) / MINUTE_MS))
    : durationMinutes;

  return { start, end: resolvedEnd, durationMinutes: minutes };
}

function candidateName(row: InterviewRow): string {
  return composeName(row.application.candidate.firstName, row.application.candidate.lastName);
}

function buildOrderBy(query: InterviewQuery): Prisma.InterviewOrderByWithRelationInput[] {
  const dir = query.sortDir;
  switch (query.sortBy) {
    case 'createdAt':
      return [{ createdAt: dir }];
    case 'updatedAt':
      return [{ updatedAt: dir }];
    default:
      return [{ scheduledStart: dir }, { createdAt: dir }];
  }
}

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

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function composeName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}
