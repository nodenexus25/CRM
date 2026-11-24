import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildPaginationMeta,
  toSkipTake,
  type ActivityItem,
  type ActivityQuery,
  type CreateActivityRequest,
  type Paginated,
  type UpdateActivityRequest,
} from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import { ForbiddenError, NotFoundError, ValidationError } from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import { PrismaService } from '@/infra/prisma/prisma.service';

type ActivityRow = Prisma.ActivityGetPayload<Record<string, never>>;

type UserBrief = { id: string; fullName: string; avatarUrl: string | null };

/**
 * The engagement timeline. One polymorphic table (`entityType` + `entityId`)
 * backs calls, emails, meetings, notes and the automatic `SYSTEM` /
 * `STAGE_CHANGE` entries the rest of the ATS writes, so a candidate or job
 * timeline is a single filtered, paginated read.
 */
@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ActivityQuery): Promise<Paginated<ActivityItem>> {
    const where = buildWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.client.activity.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        ...toSkipTake(query),
      }),
      this.prisma.client.activity.count({ where }),
    ]);

    const users = await this.loadUsers(rows.map((row) => row.createdById));
    return {
      items: rows.map((row) => toActivityItem(row, users)),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async create(input: CreateActivityRequest): Promise<ActivityItem> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;

    await this.assertReferencesExist(input);

    const created = await this.prisma.client.activity.create({
      data: {
        tenantId,
        type: input.type,
        subject: input.subject,
        body: input.body ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        durationMinutes: input.durationMinutes ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        candidateId: input.candidateId ?? null,
        clientId: input.clientId ?? null,
        jobId: input.jobId ?? null,
        contactId: input.contactId ?? null,
        applicationId: input.applicationId ?? null,
        isPinned: input.isPinned,
        createdById: userId,
        updatedById: userId,
      },
    });

    await this.audit.record({
      action: 'CREATE',
      entity: 'Activity',
      entityId: created.id,
      description: `Logged a ${created.type.toLowerCase()} activity`,
    });

    const users = await this.loadUsers([created.createdById]);
    return toActivityItem(created, users);
  }

  async update(activityId: string, input: UpdateActivityRequest): Promise<ActivityItem> {
    const existing = await this.prisma.client.activity.findFirst({
      where: { id: activityId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError('Activity', activityId);

    const updated = await this.prisma.client.activity.update({
      where: { id: activityId },
      data: {
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
        ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
        ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
        ...(input.nextStepAt !== undefined ? { nextStepAt: input.nextStepAt } : {}),
        ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
        updatedById: requestContext.userId ?? null,
      },
    });

    await this.audit.record({
      action: 'UPDATE',
      entity: 'Activity',
      entityId: activityId,
      description: 'Updated a logged activity',
    });

    const users = await this.loadUsers([updated.createdById]);
    return toActivityItem(updated, users);
  }

  async remove(activityId: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.client.activity.findFirst({
      where: { id: activityId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError('Activity', activityId);

    await this.prisma.client.activity.update({
      where: { id: activityId },
      data: { deletedAt: new Date(), updatedById: requestContext.userId ?? null },
    });

    await this.audit.record({
      action: 'DELETE',
      entity: 'Activity',
      entityId: activityId,
      description: 'Deleted a logged activity',
    });

    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * `candidateId` and `jobId` are backed by foreign keys, so a stale id would
   * otherwise surface as a raw constraint error. Validate them up front and
   * turn it into a 422.
   */
  private async assertReferencesExist(input: CreateActivityRequest): Promise<void> {
    if (input.candidateId) {
      const candidate = await this.prisma.client.candidate.findFirst({
        where: { id: input.candidateId, deletedAt: null },
        select: { id: true },
      });
      if (!candidate) throw new ValidationError('That candidate does not exist.', { candidateId: input.candidateId });
    }

    if (input.jobId) {
      const job = await this.prisma.client.job.findFirst({
        where: { id: input.jobId, deletedAt: null },
        select: { id: true },
      });
      if (!job) throw new ValidationError('That job does not exist.', { jobId: input.jobId });
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
// Mappers & helpers
// -----------------------------------------------------------------------------

function buildWhere(query: ActivityQuery): Prisma.ActivityWhereInput {
  const and: Prisma.ActivityWhereInput[] = [];

  if (query.entityType) and.push({ entityType: query.entityType });
  if (query.entityId) and.push({ entityId: query.entityId });
  if (query.candidateId) and.push({ candidateId: query.candidateId });
  if (query.clientId) and.push({ clientId: query.clientId });
  if (query.contactId) and.push({ contactId: query.contactId });
  if (query.jobId) and.push({ jobId: query.jobId });
  if (query.applicationId) and.push({ applicationId: query.applicationId });
  if (!query.includeSystem) and.push({ type: { not: 'SYSTEM' } });

  // `mine` reads the caller off the context rather than trusting a query param,
  // and falls back to a value no row can hold so an anonymous caller matches
  // nothing instead of everything.
  if (query.mine) and.push({ createdById: requestContext.userId ?? '__unauthenticated__' });

  if (query.from || query.to) {
    and.push({
      occurredAt: {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      },
    });
  }

  const types = toArray(query.type);
  if (types.length > 0) and.push({ type: { in: types } });

  return and.length > 0 ? { deletedAt: null, AND: and } : { deletedAt: null };
}

function toActivityItem(row: ActivityRow, users: Map<string, UserBrief>): ActivityItem {
  const author = row.createdById ? users.get(row.createdById) ?? null : null;
  return {
    id: row.id,
    type: row.type,
    subject: row.subject,
    body: row.body,
    direction: row.direction,
    occurredAt: row.occurredAt.toISOString(),
    durationMinutes: row.durationMinutes,
    entityType: row.entityType,
    entityId: row.entityId,
    candidateId: row.candidateId,
    clientId: row.clientId,
    jobId: row.jobId,
    applicationId: row.applicationId,
    outcome: row.outcome,
    nextStepAt: row.nextStepAt ? row.nextStepAt.toISOString() : null,
    createdBy: author
      ? { id: author.id, fullName: author.fullName, avatarUrl: author.avatarUrl }
      : null,
    isPinned: row.isPinned,
    createdAt: row.createdAt.toISOString(),
  };
}

function requireTenant(): string {
  const tenantId = requestContext.tenantId;
  if (!tenantId) throw new ForbiddenError('This action must run inside a workspace.');
  return tenantId;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function composeName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}
