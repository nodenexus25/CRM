import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  buildPaginationMeta,
  toSkipTake,
  type CandidateListQuery,
  type CandidateListSummary,
  type CandidateListMembershipRequest,
  type CreateCandidateListRequest,
  type Paginated,
  type UpdateCandidateListRequest,
} from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import { ConflictError, NotFoundError, ValidationError } from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import { PrismaService } from '@/infra/prisma/prisma.service';

const LIST_INCLUDE = {
  members: { where: { deletedAt: null }, select: { id: true } },
} satisfies Prisma.CandidateListInclude;

type ListRow = Prisma.CandidateListGetPayload<{ include: typeof LIST_INCLUDE }>;

/**
 * Hotlists / talent pools — named collections of candidates used for bench
 * sales, campaigns and outreach. Membership is many-to-many with a soft-delete
 * on the join row, so removing a candidate from a pool never touches the
 * candidate itself.
 */
@Injectable()
export class CandidateListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: CandidateListQuery): Promise<Paginated<CandidateListSummary>> {
    const userId = requestContext.userId ?? null;
    const where: Prisma.CandidateListWhereInput = {
      deletedAt: null,
      ...(query.mine && userId ? { ownerId: userId } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.candidateList.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: buildOrderBy(query),
        ...toSkipTake(query),
      }),
      this.prisma.client.candidateList.count({ where }),
    ]);

    const owners = await this.resolveOwners(rows.map((row) => row.ownerId));

    return {
      items: rows.map((row) => toSummary(row, owners.get(row.ownerId ?? '') ?? null)),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async detail(listId: string): Promise<CandidateListSummary> {
    const row = await this.findOrFail(listId);
    const owners = await this.resolveOwners([row.ownerId]);
    return toSummary(row, owners.get(row.ownerId ?? '') ?? null);
  }

  async create(input: CreateCandidateListRequest): Promise<CandidateListSummary> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;

    const existing = await this.prisma.client.candidateList.findFirst({
      where: { name: input.name, deletedAt: null },
      select: { id: true },
    });
    if (existing) throw new ConflictError('A hotlist with that name already exists.');

    const created = await this.prisma.client.candidateList.create({
      data: {
        tenantId,
        name: input.name,
        description: input.description ?? null,
        color: input.color,
        visibility: input.visibility,
        ownerId: userId,
        createdById: userId,
        updatedById: userId,
      },
      include: LIST_INCLUDE,
    });

    await this.audit.record({
      action: 'CREATE',
      entity: 'CandidateList',
      entityId: created.id,
      description: `Created hotlist ${created.name}`,
    });

    const owners = await this.resolveOwners([created.ownerId]);
    return toSummary(created, owners.get(created.ownerId ?? '') ?? null);
  }

  async update(listId: string, input: UpdateCandidateListRequest): Promise<CandidateListSummary> {
    const existing = await this.findOrFail(listId);

    if (input.name && input.name !== existing.name) {
      const clash = await this.prisma.client.candidateList.findFirst({
        where: { name: input.name, deletedAt: null, id: { not: listId } },
        select: { id: true },
      });
      if (clash) throw new ConflictError('A hotlist with that name already exists.');
    }

    const updated = await this.prisma.client.candidateList.update({
      where: { id: listId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        updatedById: requestContext.userId ?? null,
      },
      include: LIST_INCLUDE,
    });

    await this.audit.record({
      action: 'UPDATE',
      entity: 'CandidateList',
      entityId: listId,
      description: `Updated hotlist ${updated.name}`,
    });

    const owners = await this.resolveOwners([updated.ownerId]);
    return toSummary(updated, owners.get(updated.ownerId ?? '') ?? null);
  }

  async remove(listId: string): Promise<{ deleted: true }> {
    const existing = await this.findOrFail(listId);

    await this.prisma.client.candidateList.update({
      where: { id: listId },
      data: { deletedAt: new Date(), updatedById: requestContext.userId ?? null },
    });

    await this.audit.record({
      action: 'DELETE',
      entity: 'CandidateList',
      entityId: listId,
      description: `Deleted hotlist ${existing.name}`,
    });

    return { deleted: true };
  }

  async addMembers(listId: string, input: CandidateListMembershipRequest): Promise<CandidateListSummary> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;
    await this.findOrFail(listId);

    const candidateIds = [...new Set(input.candidateIds)];
    const found = await this.prisma.client.candidate.findMany({
      where: { id: { in: candidateIds }, deletedAt: null },
      select: { id: true },
    });
    const missing = candidateIds.filter((id) => !found.some((candidate) => candidate.id === id));
    if (missing.length > 0) {
      throw new ValidationError('Some of those candidates do not exist in this workspace.', {
        candidateIds: missing,
      });
    }

    // Membership is unique on (list, candidate); a candidate already on the list
    // is a no-op rather than an error, so bulk adds are idempotent.
    await this.prisma.client.candidateListMember.createMany({
      data: candidateIds.map((candidateId) => ({ tenantId, listId, candidateId, addedById: userId })),
      skipDuplicates: true,
    });

    // `createMany … skipDuplicates` also skips rows that are soft-deleted, so
    // restore any that were previously removed from the pool.
    await this.prisma.client.candidateListMember.updateMany({
      where: { listId, candidateId: { in: candidateIds }, deletedAt: { not: null } },
      data: { deletedAt: null, addedById: userId },
    });

    return this.detail(listId);
  }

  async removeMembers(listId: string, input: CandidateListMembershipRequest): Promise<CandidateListSummary> {
    await this.findOrFail(listId);
    await this.prisma.client.candidateListMember.updateMany({
      where: { listId, candidateId: { in: [...new Set(input.candidateIds)] }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return this.detail(listId);
  }

  // ---------------------------------------------------------------------------

  private async findOrFail(listId: string): Promise<ListRow> {
    const row = await this.prisma.client.candidateList.findFirst({
      where: { id: listId, deletedAt: null },
      include: LIST_INCLUDE,
    });
    if (!row) throw new NotFoundError('Hotlist', listId);
    return row;
  }

  /**
   * `CandidateList.ownerId` is a plain column with no Prisma relation, so owner
   * summaries are resolved with one batched lookup rather than an `include`.
   */
  private async resolveOwners(
    ownerIds: (string | null)[],
  ): Promise<Map<string, { id: string; fullName: string; avatarUrl: string | null }>> {
    const unique = [...new Set(ownerIds.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.client.user.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true },
    });
    return new Map(
      users.map((user) => [
        user.id,
        { id: user.id, fullName: `${user.firstName} ${user.lastName}`.trim(), avatarUrl: user.avatarUrl },
      ]),
    );
  }
}

function toSummary(
  row: ListRow,
  owner: { id: string; fullName: string; avatarUrl: string | null } | null,
): CandidateListSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    visibility: row.visibility,
    owner,
    memberCount: row.members.length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildOrderBy(query: CandidateListQuery): Prisma.CandidateListOrderByWithRelationInput[] {
  switch (query.sortBy) {
    case 'name':
      return [{ name: query.sortDir }];
    case 'memberCount':
      return [{ members: { _count: query.sortDir } }];
    default:
      return [{ createdAt: query.sortDir }];
  }
}

function requireTenant(): string {
  const tenantId = requestContext.tenantId;
  if (!tenantId) throw new ValidationError('This action must run inside a workspace.');
  return tenantId;
}
