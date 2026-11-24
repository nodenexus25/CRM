import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  buildPaginationMeta,
  toSkipTake,
  type Paginated,
  type PlacementListItem,
  type PlacementQuery,
  type PlacementStats,
  type UpdatePlacementRequest,
} from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import { ForbiddenError, NotFoundError } from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { computeMargin } from '@/modules/offers/offers.service';

/**
 * Fields a caller may edit. `applicationId` and `offerId` are structural — a
 * placement is raised from an accepted offer, never re-pointed at another one.
 */
const PLACEMENT_EDITABLE_FIELDS = [
  'startDate',
  'endDate',
  'payRateCents',
  'billRateCents',
  'ratePeriod',
  'currency',
  'feeCents',
  'feePercentage',
  'guaranteeDays',
  'recruiterId',
  'notes',
  'invoiceRef',
] as const;

const PLACEMENT_INCLUDE = {
  application: {
    select: {
      id: true,
      candidate: { select: { id: true, firstName: true, lastName: true } },
      job: {
        select: {
          id: true,
          title: true,
          client: { select: { id: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.PlacementInclude;

type PlacementRow = Prisma.PlacementGetPayload<{ include: typeof PLACEMENT_INCLUDE }>;

/**
 * Placements — the money side of a hire. A placement is created by accepting an
 * offer, so this module has no create endpoint: it reports on what exists and
 * lets an admin correct the terms afterwards.
 *
 * Margin is the one field that is permission-gated at the API boundary rather
 * than in the UI: callers without `placement:view_margin` receive `margin: null`
 * and never see the spread leave the server.
 */
@Injectable()
export class PlacementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async list(query: PlacementQuery): Promise<Paginated<PlacementListItem>> {
    const where = this.buildWhere(query);
    const showMargin = canViewMargin();

    const [rows, total] = await Promise.all([
      this.prisma.client.placement.findMany({
        where,
        include: PLACEMENT_INCLUDE,
        orderBy: buildOrderBy(query),
        ...toSkipTake(query),
      }),
      this.prisma.client.placement.count({ where }),
    ]);

    const users = await this.loadUsers(rows.map((row) => row.recruiterId));

    return {
      items: rows.map((row) => toPlacementListItem(row, users, showMargin)),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  /** Headline counts for the placements page, with margin only when permitted. */
  async stats(query: PlacementQuery): Promise<PlacementStats> {
    const where = this.buildWhere(query);

    const [grouped, totals, sample] = await Promise.all([
      this.prisma.client.placement.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.client.placement.aggregate({
        where,
        _sum: { marginCents: true, feeCents: true },
        _avg: { marginPercentage: true },
      }),
      this.prisma.client.placement.findFirst({
        where,
        orderBy: { createdAt: 'desc' },
        select: { currency: true },
      }),
    ]);

    const counts = new Map(grouped.map((row) => [row.status, row._count._all]));

    return {
      total: grouped.reduce((sum, row) => sum + row._count._all, 0),
      pending: counts.get('PENDING') ?? 0,
      active: counts.get('ACTIVE') ?? 0,
      completed: counts.get('COMPLETED') ?? 0,
      terminated: counts.get('TERMINATED') ?? 0,
      margin: canViewMargin()
        ? {
            totalMarginCents: totals._sum.marginCents ?? 0,
            totalFeeCents: totals._sum.feeCents ?? 0,
            averageMarginPercentage: toNumber(totals._avg.marginPercentage),
            currency: sample?.currency ?? null,
          }
        : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  async update(id: string, input: UpdatePlacementRequest): Promise<PlacementListItem> {
    const userId = requireUser();
    const placement = await this.loadRow(id);

    const data: Prisma.PlacementUncheckedUpdateInput = { updatedById: userId };
    for (const field of PLACEMENT_EDITABLE_FIELDS) {
      const value = input[field];
      if (value !== undefined) Object.assign(data, { [field]: value });
    }

    if (input.recruiterId) {
      const recruiter = await this.prisma.client.user.findFirst({
        where: { id: input.recruiterId, deletedAt: null },
        select: { id: true },
      });
      if (!recruiter) throw new NotFoundError('User', input.recruiterId);
    }

    // The margin is derived, so it is recomputed from the effective rates rather
    // than trusted from the body — an edited bill rate must move the spread.
    const payRateCents = input.payRateCents !== undefined ? input.payRateCents : placement.payRateCents;
    const billRateCents =
      input.billRateCents !== undefined ? input.billRateCents : placement.billRateCents;
    if (input.payRateCents !== undefined || input.billRateCents !== undefined) {
      const margin = computeMargin(payRateCents, billRateCents);
      data.marginCents = margin.marginCents;
      data.marginPercentage = margin.marginPercentage;
    }

    const statusChanged = input.status !== undefined && input.status !== placement.status;
    if (statusChanged) {
      data.status = input.status;
      const closing = input.status === 'COMPLETED' || input.status === 'TERMINATED';
      if (closing && input.endDate === undefined && !placement.endDate) {
        data.endDate = new Date();
      }
    }

    await this.prisma.client.placement.update({ where: { id }, data });

    await this.audit.record({
      action: statusChanged ? 'STATUS_CHANGE' : 'UPDATE',
      entity: 'Placement',
      entityId: id,
      description: statusChanged ? `Placement set to ${input.status}` : 'Updated a placement',
    });

    return this.present(id);
  }

  async remove(id: string): Promise<{ deleted: true }> {
    const userId = requireUser();
    await this.loadRow(id);

    await this.prisma.client.placement.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: userId },
    });

    await this.audit.record({
      action: 'DELETE',
      entity: 'Placement',
      entityId: id,
      description: 'Deleted a placement',
    });

    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Read scoping. A caller holding only `placement:read_own` sees the placements
   * they own; `_all` (or super admin) lifts the filter. Without either the guard
   * has already rejected the request, so an empty filter is safe here.
   */
  private buildWhere(query: PlacementQuery): Prisma.PlacementWhereInput {
    const and: Prisma.PlacementWhereInput[] = [];
    const context = requestContext.getOrThrow();

    const canReadAll =
      context.isSuperAdmin || hasPermission(context.permissions, 'placement:read_all');
    if (!canReadAll) {
      const userId = requireUser();
      and.push({ recruiterId: userId });
    }

    const statuses = toArray(query.status);
    if (statuses.length > 0) and.push({ status: { in: statuses } });
    if (query.clientId) and.push({ clientId: query.clientId });
    if (query.jobId) and.push({ jobId: query.jobId });
    if (query.applicationId) and.push({ applicationId: query.applicationId });
    if (query.recruiterId) and.push({ recruiterId: query.recruiterId });

    if (query.from || query.to) {
      and.push({
        startDate: {
          ...(query.from ? { gte: query.from } : {}),
          ...(query.to ? { lte: query.to } : {}),
        },
      });
    }

    if (query.q) {
      const term = query.q;
      and.push({
        OR: [
          { invoiceRef: { contains: term, mode: 'insensitive' } },
          { application: { candidate: { firstName: { contains: term, mode: 'insensitive' } } } },
          { application: { candidate: { lastName: { contains: term, mode: 'insensitive' } } } },
          { application: { job: { title: { contains: term, mode: 'insensitive' } } } },
        ],
      });
    }

    return { deletedAt: null, AND: and };
  }

  private async loadRow(id: string): Promise<PlacementRow> {
    const row = await this.prisma.client.placement.findFirst({
      where: { id, deletedAt: null },
      include: PLACEMENT_INCLUDE,
    });
    if (!row) throw new NotFoundError('Placement', id);
    return row;
  }

  private async present(id: string): Promise<PlacementListItem> {
    const row = await this.loadRow(id);
    return toPlacementListItem(row, await this.loadUsers([row.recruiterId]), canViewMargin());
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

function toPlacementListItem(
  row: PlacementRow,
  users: Map<string, { id: string; fullName: string }>,
  showMargin: boolean,
): PlacementListItem {
  const marginCents = row.marginCents;
  const marginPercentage = toNumber(row.marginPercentage);
  const hasMargin = marginCents !== null || marginPercentage !== null;

  return {
    id: row.id,
    status: row.status,
    applicationId: row.applicationId,
    offerId: row.offerId,
    candidate: {
      id: row.application.candidate.id,
      fullName: composeName(
        row.application.candidate.firstName,
        row.application.candidate.lastName,
      ),
    },
    job: row.application.job
      ? { id: row.application.job.id, title: row.application.job.title }
      : null,
    client: row.application.job?.client
      ? { id: row.application.job.client.id, name: row.application.job.client.name }
      : null,
    recruiter: row.recruiterId ? users.get(row.recruiterId) ?? null : null,
    startDate: row.startDate?.toISOString() ?? null,
    endDate: row.endDate?.toISOString() ?? null,
    payRateCents: row.payRateCents,
    billRateCents: row.billRateCents,
    ratePeriod: row.ratePeriod,
    currency: row.currency,
    feeCents: row.feeCents,
    feePercentage: toNumber(row.feePercentage),
    guaranteeDays: row.guaranteeDays,
    notes: row.notes,
    invoiceRef: row.invoiceRef,
    margin: showMargin && hasMargin ? { marginCents, marginPercentage } : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildOrderBy(query: PlacementQuery): Prisma.PlacementOrderByWithRelationInput[] {
  const dir = query.sortDir;
  switch (query.sortBy) {
    case 'updatedAt':
      return [{ updatedAt: dir }];
    case 'startDate':
      return [{ startDate: dir }, { createdAt: dir }];
    default:
      return [{ createdAt: dir }];
  }
}

/** Prisma hands decimals back as `Decimal`; the wire contract is a number. */
function toNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

function canViewMargin(): boolean {
  const context = requestContext.getOrThrow();
  if (context.isSuperAdmin) return true;
  return hasPermission(context.permissions, 'placement:view_margin');
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
