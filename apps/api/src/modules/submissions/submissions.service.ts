import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  SUBMISSION_STATUS_LABELS,
  buildPaginationMeta,
  toSkipTake,
  type Paginated,
  type SubmissionContactRef,
  type SubmissionDetail,
  type SubmissionEventItem,
  type SubmissionFeedbackRequest,
  type SubmissionListItem,
  type SubmissionQuery,
  type SubmissionStatus,
  type SubmissionUserRef,
  type SubmitApplicationRequest,
  type UpdateSubmissionRequest,
} from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { PipelineService } from '@/modules/pipeline/pipeline.service';

const DAY_MS = 86_400_000;

/** Feedback arrives by mail, so it is logged as an inbound `EMAIL` activity. */
const FEEDBACK_SUBJECT = 'Client feedback';

const SUBMISSION_LIST_INCLUDE = {
  job: {
    select: {
      id: true,
      title: true,
      referenceCode: true,
      client: { select: { id: true, name: true } },
    },
  },
  candidate: { select: { id: true, firstName: true, lastName: true } },
  stage: { select: { id: true, name: true, color: true } },
  owner: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ApplicationInclude;

const SUBMISSION_DETAIL_INCLUDE = {
  ...SUBMISSION_LIST_INCLUDE,
  candidate: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.ApplicationInclude;

type SubmissionWithList = Prisma.ApplicationGetPayload<{ include: typeof SUBMISSION_LIST_INCLUDE }>;
type SubmissionWithDetail = Prisma.ApplicationGetPayload<{
  include: typeof SUBMISSION_DETAIL_INCLUDE;
}>;

type SubmissionApplicationRow = {
  id: string;
  jobId: string;
  candidateId: string;
  stageId: string;
  stageEnteredAt: Date;
  ownerId: string | null;
  submittedAt: Date | null;
  appliedAt: Date;
  submissionStatus: SubmissionStatus;
  resumeId: string | null;
  clientFeedback: string | null;
};

/**
 * Submissions — the client-facing half of an application.
 *
 * A submission has no table of its own: it rides on `Application` as a separate
 * lifecycle (`submissionStatus`, `submittedAt`, `submittedById`, `clientFeedback`)
 * so the internal pipeline and the client's view of a candidate can move
 * independently. Everything that happens is also written to the application's
 * activity feed, which is what the submission timeline reads back.
 */
@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async list(query: SubmissionQuery): Promise<Paginated<SubmissionListItem>> {
    const where = this.buildWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.client.application.findMany({
        where,
        include: SUBMISSION_LIST_INCLUDE,
        orderBy: buildOrderBy(query),
        ...toSkipTake(query),
      }),
      this.prisma.client.application.count({ where }),
    ]);

    const users = await this.loadUsers(rows.map((row) => row.submittedById));
    const now = Date.now();

    return {
      items: rows.map((row) => toSubmissionListItem(row, users, now)),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async detail(applicationId: string): Promise<SubmissionDetail> {
    const application = await this.prisma.client.application.findFirst({
      where: { id: applicationId, deletedAt: null },
      include: SUBMISSION_DETAIL_INCLUDE,
    });
    if (!application) throw new NotFoundError('Submission', applicationId);

    const events = await this.prisma.client.activity.findMany({
      where: {
        applicationId,
        deletedAt: null,
        OR: [{ type: 'SUBMISSION' }, { type: 'EMAIL', direction: 'INBOUND' }],
      },
      orderBy: { createdAt: 'desc' },
    });

    const [users, contact, resume] = await Promise.all([
      this.loadUsers([
        application.submittedById,
        ...events.map((event) => event.createdById),
      ]),
      this.loadContact(events.find((event) => event.contactId)?.contactId),
      application.resumeId
        ? this.prisma.client.candidateResume.findFirst({
            where: { id: application.resumeId, deletedAt: null },
            select: { id: true, fileName: true },
          })
        : Promise.resolve(null),
    ]);

    return {
      ...toSubmissionListItem(application, users, Date.now()),
      candidate: {
        id: application.candidate.id,
        fullName: composeName(application.candidate.firstName, application.candidate.lastName),
        avatarUrl: null,
        email: application.candidate.email,
      },
      contact,
      resume,
      clientFeedback: application.clientFeedback,
      clientFeedbackAt: application.clientFeedbackAt?.toISOString() ?? null,
      events: events.map((event) =>
        toSubmissionEvent(event, application.submittedAt, users),
      ),
    };
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  /**
   * Sends a candidate to the client: stamps the submission fields, advances the
   * application to the job's `SUBMISSION` stage when the pipeline defines one,
   * and records the whole thing as a single timeline entry.
   */
  async submit(
    applicationId: string,
    input: SubmitApplicationRequest,
  ): Promise<SubmissionDetail> {
    const tenantId = requireTenant();
    const userId = requireUser();

    const application = await this.findApplicationOrFail(applicationId);
    if (!RESUBMITTABLE.has(application.submissionStatus)) {
      throw new ConflictError(
        `This candidate is already ${SUBMISSION_STATUS_LABELS[
          application.submissionStatus
        ].toLowerCase()} at the client.`,
      );
    }

    const job = await this.prisma.client.job.findFirst({
      where: { id: application.jobId, deletedAt: null },
      select: {
        id: true,
        clientId: true,
        contactId: true,
        client: { select: { id: true, name: true } },
      },
    });
    if (!job) throw new NotFoundError('Job', application.jobId);

    if (input.resumeId) {
      await this.assertResumeBelongsToCandidate(input.resumeId, application.candidateId);
    }

    const contactId = input.contactId ?? job.contactId ?? null;
    if (input.contactId) await this.assertContactBelongsToClient(input.contactId, job.clientId);

    const now = new Date();
    const stages = await this.pipeline.effectiveJobStages(application.jobId);
    const submissionStage = stages.find((stage) => stage.type === 'SUBMISSION');
    const movingTo = submissionStage && submissionStage.id !== application.stageId ? submissionStage : null;

    const data: Prisma.ApplicationUncheckedUpdateInput = {
      submissionStatus: 'SUBMITTED',
      submittedAt: now,
      submittedById: userId,
      resumeId: input.resumeId ?? null,
      updatedById: userId,
      // A fresh submission starts its client journey again, so stale feedback
      // from a previous round must not carry over.
      clientFeedback: null,
      clientFeedbackAt: null,
    };

    if (movingTo) {
      data.stageId = movingTo.id;
      data.stageEnteredAt = now;
      data.lastStageChangedAt = now;
      data.boardOrder = await this.nextBoardOrder(application.jobId, movingTo.id);
    }

    const durationSeconds = movingTo
      ? Math.max(0, Math.round((now.getTime() - application.stageEnteredAt.getTime()) / 1000))
      : null;
    const subject = job.client ? `Submitted to ${job.client.name}` : 'Submitted to the client';
    const notifyOwnerId =
      application.ownerId && application.ownerId !== userId ? application.ownerId : null;

    await this.prisma.client.$transaction(async (tx) => {
      await tx.application.update({ where: { id: applicationId }, data });

      if (movingTo) {
        await tx.stageHistory.create({
          data: {
            tenantId,
            applicationId,
            fromStageId: application.stageId,
            toStageId: movingTo.id,
            note: 'Submitted to client',
            changedById: userId,
            durationSeconds,
          },
        });
      }

      await tx.activity.create({
        data: {
          tenantId,
          type: 'SUBMISSION',
          subject,
          body: input.note ?? null,
          // Pinned to the same instant as `submittedAt` so the timeline can
          // recognise the "went out" entry by timestamp equality.
          createdAt: now,
          entityType: 'APPLICATION',
          entityId: applicationId,
          applicationId,
          jobId: application.jobId,
          candidateId: application.candidateId,
          clientId: job.clientId ?? null,
          contactId,
          createdById: userId,
        },
      });

      if (notifyOwnerId) {
        await tx.notification.createMany({
          data: [
            {
              tenantId,
              userId: notifyOwnerId,
              type: 'application.submitted',
              channel: 'IN_APP',
              title: 'A candidate was submitted to a client',
              body: `${subject} — one of your applications moved forward`,
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
      description: `${subject}${input.hideContact ? ' · contact details hidden' : ''}`,
    });

    return this.detail(applicationId);
  }

  /** Moves the client-facing state without touching the internal pipeline. */
  async updateStatus(
    applicationId: string,
    input: UpdateSubmissionRequest,
  ): Promise<SubmissionDetail> {
    const tenantId = requireTenant();
    const userId = requireUser();

    const application = await this.findApplicationOrFail(applicationId);
    if (application.submissionStatus === 'DRAFT') {
      throw new ValidationError(
        'Submit this candidate to the client before changing the client status.',
      );
    }
    if (application.submissionStatus === input.status) return this.detail(applicationId);

    const subject = `Client status: ${SUBMISSION_STATUS_LABELS[input.status]}`;

    await this.prisma.client.$transaction(async (tx) => {
      await tx.application.update({
        where: { id: applicationId },
        data: { submissionStatus: input.status, updatedById: userId },
      });

      await tx.activity.create({
        data: {
          tenantId,
          type: 'SUBMISSION',
          subject,
          body: input.note ?? null,
          entityType: 'APPLICATION',
          entityId: applicationId,
          applicationId,
          jobId: application.jobId,
          candidateId: application.candidateId,
          createdById: userId,
        },
      });
    });

    await this.audit.record({
      action: 'STATUS_CHANGE',
      entity: 'Application',
      entityId: applicationId,
      description: subject,
    });

    return this.detail(applicationId);
  }

  /** Records what the client came back with, on the timeline and on the row. */
  async addFeedback(
    applicationId: string,
    input: SubmissionFeedbackRequest,
  ): Promise<SubmissionDetail> {
    const tenantId = requireTenant();
    const userId = requireUser();

    const application = await this.findApplicationOrFail(applicationId);
    if (application.submissionStatus === 'DRAFT') {
      throw new ValidationError(
        'Submit this candidate to the client before recording their feedback.',
      );
    }

    const occurredAt = input.feedbackAt ?? new Date();
    const job = await this.prisma.client.job.findFirst({
      where: { id: application.jobId, deletedAt: null },
      select: { clientId: true },
    });

    await this.prisma.client.$transaction(async (tx) => {
      await tx.application.update({
        where: { id: applicationId },
        data: {
          clientFeedback: input.feedback,
          clientFeedbackAt: occurredAt,
          updatedById: userId,
        },
      });

      await tx.activity.create({
        data: {
          tenantId,
          type: 'EMAIL',
          direction: 'INBOUND',
          subject: FEEDBACK_SUBJECT,
          body: input.feedback,
          occurredAt,
          entityType: 'APPLICATION',
          entityId: applicationId,
          applicationId,
          jobId: application.jobId,
          candidateId: application.candidateId,
          clientId: job?.clientId ?? null,
          createdById: userId,
        },
      });
    });

    await this.audit.record({
      action: 'UPDATE',
      entity: 'Application',
      entityId: applicationId,
      description: 'Recorded client feedback on a submission',
    });

    return this.detail(applicationId);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private buildWhere(query: SubmissionQuery): Prisma.ApplicationWhereInput {
    const userId = requireUser();
    const context = requestContext.getOrThrow();
    const and: Prisma.ApplicationWhereInput[] = [];

    // Only rows that have actually gone out; drafts belong to the pipeline view.
    and.push({ submissionStatus: { not: 'DRAFT' } });

    const canReadAll =
      context.isSuperAdmin || hasPermission(context.permissions, 'application:read_all');
    if (!canReadAll) {
      // Applications the caller owns, or on a job they are assigned to.
      and.push({ OR: [{ ownerId: userId }, { job: { assignments: { some: { userId } } } }] });
    }

    const statuses = toArray(query.status);
    if (statuses.length > 0) and.push({ submissionStatus: { in: statuses } });

    const applicationStatuses = toArray(query.applicationStatus);
    if (applicationStatuses.length > 0) and.push({ status: { in: applicationStatuses } });

    if (query.jobId) and.push({ jobId: query.jobId });
    if (query.clientId) and.push({ job: { clientId: query.clientId } });
    if (query.recruiterId) and.push({ ownerId: query.recruiterId });

    const submittedAt: Prisma.DateTimeNullableFilter = {};
    if (query.from) submittedAt.gte = query.from;
    if (query.to) submittedAt.lte = query.to;
    if (submittedAt.gte || submittedAt.lte) and.push({ submittedAt });

    return { deletedAt: null, AND: and };
  }

  /** Appends to the destination column, mirroring the Kanban board's ordering. */
  private async nextBoardOrder(jobId: string, stageId: string): Promise<number> {
    const last = await this.prisma.client.application.findFirst({
      where: { jobId, stageId },
      orderBy: { boardOrder: 'desc' },
      select: { boardOrder: true },
    });
    return (last?.boardOrder ?? 0) + 1;
  }

  private async findApplicationOrFail(applicationId: string): Promise<SubmissionApplicationRow> {
    const application = await this.prisma.client.application.findFirst({
      where: { id: applicationId, deletedAt: null },
      select: {
        id: true,
        jobId: true,
        candidateId: true,
        stageId: true,
        stageEnteredAt: true,
        ownerId: true,
        submittedAt: true,
        appliedAt: true,
        submissionStatus: true,
        resumeId: true,
        clientFeedback: true,
      },
    });
    if (!application) throw new NotFoundError('Submission', applicationId);
    return application;
  }

  private async assertResumeBelongsToCandidate(
    resumeId: string,
    candidateId: string,
  ): Promise<void> {
    const resume = await this.prisma.client.candidateResume.findFirst({
      where: { id: resumeId, candidateId, deletedAt: null },
      select: { id: true },
    });
    if (!resume) {
      throw new ValidationError('That résumé does not belong to this candidate.', { resumeId });
    }
  }

  private async assertContactBelongsToClient(
    contactId: string,
    clientId: string | null,
  ): Promise<void> {
    if (!clientId) {
      throw new ValidationError('This job is not linked to a client, so it has no contacts.', {
        contactId,
      });
    }

    const contact = await this.prisma.client.clientContact.findFirst({
      where: { id: contactId, clientId, deletedAt: null },
      select: { id: true },
    });
    if (!contact) {
      throw new ValidationError('That contact does not belong to this job’s client.', { contactId });
    }
  }

  private async loadContact(contactId: string | null | undefined): Promise<SubmissionContactRef | null> {
    if (!contactId) return null;

    const contact = await this.prisma.client.clientContact.findFirst({
      where: { id: contactId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true, title: true },
    });
    if (!contact) return null;

    return {
      id: contact.id,
      fullName: composeName(contact.firstName, contact.lastName),
      email: contact.email,
      title: contact.title,
    };
  }

  private async loadUsers(ids: (string | null | undefined)[]): Promise<Map<string, SubmissionUserRef>> {
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

function toSubmissionListItem(
  row: SubmissionWithList | SubmissionWithDetail,
  users: Map<string, SubmissionUserRef>,
  now: number,
): SubmissionListItem {
  return {
    id: row.id,
    submissionStatus: row.submissionStatus,
    applicationStatus: row.status,
    job: { id: row.job.id, title: row.job.title, referenceCode: row.job.referenceCode },
    client: row.job.client ? { id: row.job.client.id, name: row.job.client.name } : null,
    candidate: {
      id: row.candidate.id,
      fullName: composeName(row.candidate.firstName, row.candidate.lastName),
      avatarUrl: null,
    },
    stage: { id: row.stage.id, name: row.stage.name, color: row.stage.color },
    owner: row.owner
      ? { id: row.owner.id, fullName: composeName(row.owner.firstName, row.owner.lastName) }
      : null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    submittedBy: row.submittedById ? users.get(row.submittedById) ?? null : null,
    ageDays: daysSince(row.submittedAt ?? row.appliedAt, now),
    hasFeedback: row.clientFeedback !== null,
  };
}

/**
 * The submit event is the one whose timestamp matches `Application.submittedAt`
 * — both are written with the same `Date` in one transaction — so the timeline
 * can tell "went out" apart from "the client moved it on" without a discriminator
 * column on `Activity`.
 */
function toSubmissionEvent(
  row: {
    id: string;
    type: string;
    direction: string | null;
    subject: string;
    body: string | null;
    createdAt: Date;
    createdById: string | null;
  },
  submittedAt: Date | null,
  users: Map<string, SubmissionUserRef>,
): SubmissionEventItem {
  let kind: SubmissionEventItem['kind'] = 'STATUS';
  if (row.type === 'EMAIL' && row.direction === 'INBOUND') {
    kind = 'FEEDBACK';
  } else if (submittedAt && row.createdAt.getTime() === submittedAt.getTime()) {
    kind = 'SUBMITTED';
  }

  return {
    id: row.id,
    kind,
    subject: row.subject,
    body: row.body,
    author: row.createdById ? users.get(row.createdById) ?? null : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Submission states a candidate can be sent from: never sent, or sent and closed. */
const RESUBMITTABLE: ReadonlySet<string> = new Set(['DRAFT', 'REJECTED', 'WITHDRAWN']);

function buildOrderBy(query: SubmissionQuery): Prisma.ApplicationOrderByWithRelationInput[] {
  const dir = query.sortDir;
  switch (query.sortBy) {
    case 'updatedAt':
      return [{ updatedAt: dir }];
    case 'appliedAt':
      return [{ appliedAt: dir }];
    default:
      return [{ submittedAt: dir }, { createdAt: dir }];
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

/** Mirrors `PermissionsGuard`: holding `_all` satisfies an `_own` requirement. */
function hasPermission(granted: readonly string[], required: string): boolean {
  if (granted.includes(required)) return true;
  if (required.endsWith('_own')) {
    return granted.includes(`${required.replace(/_own$/, '')}_all`);
  }
  return false;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function composeName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

function daysSince(date: Date, now: number): number {
  return Math.max(0, Math.floor((now - date.getTime()) / DAY_MS));
}
