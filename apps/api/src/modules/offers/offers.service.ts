import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  OFFER_STATUS_LABELS,
  buildPaginationMeta,
  toSkipTake,
  type AcceptOfferRequest,
  type CreateOfferRequest,
  type OfferListItem,
  type OfferQuery,
  type Paginated,
  type UpdateOfferRequest,
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
import type { TenantScopedClient } from '@/infra/prisma/tenancy.extension';
import { PipelineService } from '@/modules/pipeline/pipeline.service';

/**
 * The client Prisma hands to a `$transaction` callback — the tenancy-extended
 * client minus its lifecycle methods, so it is derived rather than imported.
 */
type TransactionClient = Parameters<Parameters<TenantScopedClient['$transaction']>[0]>[0];

/** Offer statuses that end the record's life; nothing may follow them. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'WITHDRAWN',
]);

/** Editable terms, applied verbatim from the PATCH body when they are present. */
const OFFER_TERM_FIELDS = [
  'title',
  'salaryCents',
  'payRateCents',
  'billRateCents',
  'ratePeriod',
  'currency',
  'bonusCents',
  'equityNote',
  'startDate',
  'expiresAt',
  'declineReason',
  'notes',
] as const;

const OFFER_INCLUDE = {
  application: {
    select: {
      id: true,
      jobId: true,
      candidateId: true,
      ownerId: true,
      stageId: true,
      stageEnteredAt: true,
      job: {
        select: {
          id: true,
          title: true,
          referenceCode: true,
          clientId: true,
          client: { select: { id: true, name: true } },
        },
      },
      candidate: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  placement: { select: { id: true, status: true, startDate: true } },
} satisfies Prisma.OfferInclude;

type OfferRow = Prisma.OfferGetPayload<{ include: typeof OFFER_INCLUDE }>;

interface StageMove {
  fromStageId: string;
  stageId: string;
  boardOrder: number;
  note: string;
}

/**
 * Offers — the commercial conversation that follows a good interview.
 *
 * Accepting an offer is the one status change that has side effects beyond the
 * offer itself: it raises a `Placement` carrying the same rates and moves the
 * application to the job's `PLACEMENT` stage. Everything else is a plain
 * lifecycle transition, which is why accepting has its own endpoint rather than
 * riding on `PATCH /offers/:id`.
 */
@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async list(query: OfferQuery): Promise<Paginated<OfferListItem>> {
    const where = this.buildWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.client.offer.findMany({
        where,
        include: OFFER_INCLUDE,
        orderBy: buildOrderBy(query),
        ...toSkipTake(query),
      }),
      this.prisma.client.offer.count({ where }),
    ]);

    const users = await this.loadUsers(rows.map((row) => row.createdById));

    return {
      items: rows.map((row) => toOfferListItem(row, users)),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  async create(input: CreateOfferRequest): Promise<OfferListItem> {
    const tenantId = requireTenant();
    const userId = requireUser();

    const application = await this.prisma.client.application.findFirst({
      where: { id: input.applicationId, deletedAt: null },
      select: {
        id: true,
        jobId: true,
        candidateId: true,
        status: true,
        job: { select: { clientId: true } },
      },
    });
    if (!application) throw new NotFoundError('Application', input.applicationId);
    if (application.status === 'REJECTED' || application.status === 'WITHDRAWN') {
      throw new ValidationError(
        'This application is closed. Reopen it before raising an offer.',
        { applicationId: input.applicationId },
      );
    }

    let offerId = '';

    await this.prisma.client.$transaction(async (tx) => {
      const offer = await tx.offer.create({
        data: {
          tenantId,
          applicationId: input.applicationId,
          title: input.title ?? null,
          salaryCents: input.salaryCents ?? null,
          payRateCents: input.payRateCents ?? null,
          billRateCents: input.billRateCents ?? null,
          ratePeriod: input.ratePeriod,
          currency: input.currency,
          bonusCents: input.bonusCents ?? null,
          equityNote: input.equityNote ?? null,
          startDate: input.startDate ?? null,
          expiresAt: input.expiresAt ?? null,
          notes: input.notes ?? null,
          createdById: userId,
          updatedById: userId,
        },
        select: { id: true },
      });
      offerId = offer.id;

      await tx.activity.create({
        data: {
          tenantId,
          type: 'SYSTEM',
          subject: input.title ? `Offer raised · ${input.title}` : 'Offer raised',
          entityType: 'OFFER',
          entityId: offer.id,
          applicationId: application.id,
          jobId: application.jobId,
          candidateId: application.candidateId,
          clientId: application.job.clientId ?? null,
          createdById: userId,
        },
      });
    });

    await this.audit.record({
      action: 'CREATE',
      entity: 'Offer',
      entityId: offerId,
      description: 'Raised an offer',
    });

    return this.present(offerId);
  }

  /** Edits the terms and walks the offer along its lifecycle. */
  async update(id: string, input: UpdateOfferRequest): Promise<OfferListItem> {
    const tenantId = requireTenant();
    const userId = requireUser();

    if (input.status === 'ACCEPTED') {
      throw new ValidationError(
        'Accept an offer through its accept endpoint so the placement is created.',
      );
    }

    const offer = await this.loadOfferRow(id);
    const currentStatus = offer.status;
    const nextStatus = input.status ?? currentStatus;

    if (TERMINAL_STATUSES.has(currentStatus) && nextStatus !== currentStatus) {
      throw new ConflictError(
        `This offer is already ${OFFER_STATUS_LABELS[currentStatus].toLowerCase()} and cannot move on.`,
      );
    }

    const now = new Date();
    const data: Prisma.OfferUncheckedUpdateInput = { updatedById: userId };
    for (const field of OFFER_TERM_FIELDS) {
      const value = input[field];
      if (value !== undefined) Object.assign(data, { [field]: value });
    }

    const statusChanged = input.status !== undefined && input.status !== currentStatus;
    if (input.status !== undefined) {
      data.status = input.status;
      if (input.status === 'SENT' && !offer.sentAt) data.sentAt = now;
      if (TERMINAL_STATUSES.has(input.status) && !offer.respondedAt) data.respondedAt = now;
    }

    // Sending an offer is the moment the candidate is formally at the offer
    // stage, so the board follows the status.
    const stageMove =
      input.status === 'SENT' && currentStatus !== 'SENT'
        ? await this.planStageMove(offer.application.jobId, offer.application.stageId, 'OFFER')
        : null;

    await this.prisma.client.$transaction(async (tx) => {
      await tx.offer.update({ where: { id }, data });

      if (stageMove) {
        await this.applyStageMove(tx, {
          tenantId,
          userId,
          applicationId: offer.applicationId,
          jobId: offer.application.jobId,
          candidateId: offer.application.candidateId,
          clientId: offer.application.job.clientId ?? null,
          offerId: id,
          move: stageMove,
          at: now,
        });
      } else if (statusChanged) {
        await tx.activity.create({
          data: {
            tenantId,
            type: 'SYSTEM',
            subject: `Offer ${OFFER_STATUS_LABELS[input.status!].toLowerCase()}`,
            entityType: 'OFFER',
            entityId: id,
            applicationId: offer.applicationId,
            jobId: offer.application.jobId,
            candidateId: offer.application.candidateId,
            clientId: offer.application.job.clientId ?? null,
            createdById: userId,
          },
        });
      }
    });

    await this.audit.record({
      action: statusChanged ? 'STATUS_CHANGE' : 'UPDATE',
      entity: 'Offer',
      entityId: id,
      description: statusChanged
        ? `Offer set to ${OFFER_STATUS_LABELS[input.status!]}`
        : 'Updated an offer',
    });

    return this.present(id);
  }

  /**
   * Accepts the offer and produces the placement. Idempotent: accepting an
   * already-accepted offer returns the record untouched rather than raising a
   * second placement.
   */
  async accept(id: string, input: AcceptOfferRequest): Promise<OfferListItem> {
    const tenantId = requireTenant();
    const userId = requireUser();

    const offer = await this.loadOfferRow(id);
    if (offer.status === 'ACCEPTED') return toOfferListItem(offer, await this.loadUsers([offer.createdById]));
    if (offer.status === 'DECLINED' || offer.status === 'EXPIRED' || offer.status === 'WITHDRAWN') {
      throw new ConflictError(
        `This offer was ${OFFER_STATUS_LABELS[offer.status].toLowerCase()} and can no longer be accepted.`,
      );
    }

    const now = new Date();
    const startDate = input.startDate ?? offer.startDate;
    const margin = computeMargin(offer.payRateCents, offer.billRateCents);
    const stageMove = await this.planStageMove(
      offer.application.jobId,
      offer.application.stageId,
      'PLACEMENT',
    );

    await this.prisma.client.$transaction(async (tx) => {
      await tx.offer.update({
        where: { id },
        data: {
          status: 'ACCEPTED',
          respondedAt: offer.respondedAt ?? now,
          startDate,
          updatedById: userId,
        },
      });

      const existing = await tx.placement.findFirst({
        where: { applicationId: offer.applicationId, deletedAt: null },
        select: { id: true },
      });

      if (existing) {
        // A placement raised earlier keeps its own negotiated terms; accepting
        // this offer only links the two records together.
        await tx.placement.update({
          where: { id: existing.id },
          data: { offerId: offer.id, updatedById: userId },
        });
      } else {
        await tx.placement.create({
          data: {
            tenantId,
            applicationId: offer.applicationId,
            offerId: offer.id,
            status: 'ACTIVE',
            startDate,
            payRateCents: offer.payRateCents,
            billRateCents: offer.billRateCents,
            ratePeriod: offer.ratePeriod,
            currency: offer.currency,
            marginCents: margin.marginCents,
            marginPercentage: margin.marginPercentage,
            recruiterId: offer.application.ownerId,
            clientId: offer.application.job.clientId ?? null,
            jobId: offer.application.jobId,
            notes: input.notes ?? null,
            createdById: userId,
            updatedById: userId,
          },
          select: { id: true },
        });
      }

      await tx.application.update({
        where: { id: offer.applicationId },
        data: {
          status: 'PLACED',
          updatedById: userId,
          ...(stageMove
            ? {
                stageId: stageMove.stageId,
                stageEnteredAt: now,
                lastStageChangedAt: now,
                boardOrder: stageMove.boardOrder,
              }
            : {}),
        },
      });

      if (stageMove) {
        await tx.stageHistory.create({
          data: {
            tenantId,
            applicationId: offer.applicationId,
            fromStageId: offer.application.stageId,
            toStageId: stageMove.stageId,
            note: stageMove.note,
            changedById: userId,
            durationSeconds: durationSeconds(offer.application.stageEnteredAt, now),
          },
        });
      }

      await tx.activity.create({
        data: {
          tenantId,
          type: 'SYSTEM',
          subject: 'Offer accepted',
          body: input.notes ?? null,
          entityType: 'OFFER',
          entityId: id,
          applicationId: offer.applicationId,
          jobId: offer.application.jobId,
          candidateId: offer.application.candidateId,
          clientId: offer.application.job.clientId ?? null,
          createdById: userId,
        },
      });
    });

    await this.audit.record({
      action: 'STATUS_CHANGE',
      entity: 'Offer',
      entityId: id,
      description: 'Offer accepted and a placement created',
    });

    return this.present(id);
  }

  async remove(id: string): Promise<{ deleted: true }> {
    const userId = requireUser();
    await this.loadOfferRow(id);

    await this.prisma.client.offer.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: userId },
    });

    await this.audit.record({
      action: 'DELETE',
      entity: 'Offer',
      entityId: id,
      description: 'Deleted an offer',
    });

    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private buildWhere(query: OfferQuery): Prisma.OfferWhereInput {
    const and: Prisma.OfferWhereInput[] = [];

    const statuses = toArray(query.status);
    if (statuses.length > 0) and.push({ status: { in: statuses } });
    if (query.applicationId) and.push({ applicationId: query.applicationId });
    if (query.jobId) and.push({ application: { jobId: query.jobId } });
    if (query.clientId) and.push({ application: { job: { clientId: query.clientId } } });
    if (query.recruiterId) and.push({ application: { ownerId: query.recruiterId } });

    if (query.q) {
      const term = query.q;
      and.push({
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { application: { candidate: { firstName: { contains: term, mode: 'insensitive' } } } },
          { application: { candidate: { lastName: { contains: term, mode: 'insensitive' } } } },
          { application: { job: { title: { contains: term, mode: 'insensitive' } } } },
        ],
      });
    }

    return { deletedAt: null, AND: and };
  }

  private async loadOfferRow(id: string): Promise<OfferRow> {
    const row = await this.prisma.client.offer.findFirst({
      where: { id, deletedAt: null },
      include: OFFER_INCLUDE,
    });
    if (!row) throw new NotFoundError('Offer', id);
    return row;
  }

  private async present(id: string): Promise<OfferListItem> {
    const row = await this.loadOfferRow(id);
    return toOfferListItem(row, await this.loadUsers([row.createdById]));
  }

  /**
   * Resolves where the application would move for a given stage type, or `null`
   * when the job has no such stage or the candidate is already past it — the
   * board only ever moves forward.
   */
  private async planStageMove(
    jobId: string,
    currentStageId: string,
    target: 'OFFER' | 'PLACEMENT',
  ): Promise<StageMove | null> {
    const stages = await this.pipeline.effectiveJobStages(jobId);
    const destination = stages.find((stage) => stage.type === target);
    if (!destination) return null;

    const current = stages.find((stage) => stage.id === currentStageId);
    if (current && destination.order <= current.order) return null;

    return {
      fromStageId: currentStageId,
      stageId: destination.id,
      boardOrder: await this.nextBoardOrder(jobId, destination.id),
      note: target === 'OFFER' ? 'Offer sent' : 'Offer accepted',
    };
  }

  /** Applies a planned move inside the caller's transaction, with its timeline row. */
  private async applyStageMove(
    tx: TransactionClient,
    context: {
      tenantId: string;
      userId: string;
      applicationId: string;
      jobId: string;
      candidateId: string;
      clientId: string | null;
      offerId: string;
      move: StageMove;
      at: Date;
    },
  ): Promise<void> {
    const { move, at } = context;

    await tx.application.update({
      where: { id: context.applicationId },
      data: {
        stageId: move.stageId,
        stageEnteredAt: at,
        lastStageChangedAt: at,
        boardOrder: move.boardOrder,
        updatedById: context.userId,
      },
    });

    await tx.stageHistory.create({
      data: {
        tenantId: context.tenantId,
        applicationId: context.applicationId,
        fromStageId: move.fromStageId,
        toStageId: move.stageId,
        note: move.note,
        changedById: context.userId,
        durationSeconds: null,
      },
    });

    await tx.activity.create({
      data: {
        tenantId: context.tenantId,
        type: 'SYSTEM',
        subject: 'Offer sent',
        entityType: 'OFFER',
        entityId: context.offerId,
        applicationId: context.applicationId,
        jobId: context.jobId,
        candidateId: context.candidateId,
        clientId: context.clientId,
        createdById: context.userId,
      },
    });
  }

  private async nextBoardOrder(jobId: string, stageId: string): Promise<number> {
    const last = await this.prisma.client.application.findFirst({
      where: { jobId, stageId },
      orderBy: { boardOrder: 'desc' },
      select: { boardOrder: true },
    });
    return (last?.boardOrder ?? 0) + 1;
  }

  private async loadUsers(
    ids: (string | null | undefined)[],
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
        { id: user.id, fullName: composeName(user.firstName, user.lastName) },
      ]),
    );
  }
}

// -----------------------------------------------------------------------------
// Mappers & helpers
// -----------------------------------------------------------------------------

function toOfferListItem(
  row: OfferRow,
  users: Map<string, { id: string; fullName: string }>,
): OfferListItem {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    salaryCents: row.salaryCents,
    payRateCents: row.payRateCents,
    billRateCents: row.billRateCents,
    ratePeriod: row.ratePeriod,
    currency: row.currency,
    bonusCents: row.bonusCents,
    equityNote: row.equityNote,
    startDate: row.startDate?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    declineReason: row.declineReason,
    notes: row.notes,
    application: {
      id: row.application.id,
      job: {
        id: row.application.job.id,
        title: row.application.job.title,
        referenceCode: row.application.job.referenceCode,
      },
      candidate: {
        id: row.application.candidate.id,
        fullName: composeName(
          row.application.candidate.firstName,
          row.application.candidate.lastName,
        ),
      },
      client: row.application.job.client
        ? { id: row.application.job.client.id, name: row.application.job.client.name }
        : null,
    },
    placement: row.placement
      ? {
          id: row.placement.id,
          status: row.placement.status,
          startDate: row.placement.startDate?.toISOString() ?? null,
        }
      : null,
    createdBy: row.createdById ? users.get(row.createdById) ?? null : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** `marginCents = bill − pay`, and the percentage of the bill it represents. */
export function computeMargin(
  payRateCents: number | null,
  billRateCents: number | null,
): { marginCents: number | null; marginPercentage: number | null } {
  if (payRateCents === null || billRateCents === null) {
    return { marginCents: null, marginPercentage: null };
  }

  const marginCents = billRateCents - payRateCents;
  const marginPercentage =
    billRateCents > 0 ? round2((marginCents / billRateCents) * 100) : null;
  return { marginCents, marginPercentage };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function durationSeconds(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
}

function buildOrderBy(query: OfferQuery): Prisma.OfferOrderByWithRelationInput[] {
  const dir = query.sortDir;
  switch (query.sortBy) {
    case 'updatedAt':
      return [{ updatedAt: dir }];
    case 'sentAt':
      return [{ sentAt: dir }, { createdAt: dir }];
    case 'startDate':
      return [{ startDate: dir }, { createdAt: dir }];
    default:
      return [{ createdAt: dir }];
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
