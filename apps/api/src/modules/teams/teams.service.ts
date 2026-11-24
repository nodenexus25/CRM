import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { CreateTeamRequest, TeamListItem, UpdateTeamRequest } from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import { PrismaService } from '@/infra/prisma/prisma.service';

type TeamWithRelations = Prisma.TeamGetPayload<{
  include: {
    leader: { select: { id: true; firstName: true; lastName: true; avatarUrl: true } };
    _count: { select: { members: true } };
  };
}>;

const TEAM_INCLUDE = {
  leader: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
  _count: { select: { members: true } },
} satisfies Prisma.TeamInclude;

/**
 * Teams group users for reporting and workload distribution, and can be nested
 * to mirror a real org chart. Membership lives in `TeamMember` so a user can
 * belong to several teams.
 */
@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<TeamListItem[]> {
    const teams = await this.prisma.client.team.findMany({
      where: { deletedAt: null },
      include: TEAM_INCLUDE,
      orderBy: [{ name: 'asc' }],
    });

    const openJobs = await this.countOpenJobs(teams.map((team) => team.id));

    return teams.map((team) => toTeamListItem(team, openJobs.get(team.id) ?? 0));
  }

  async create(input: CreateTeamRequest): Promise<TeamListItem> {
    const tenantId = requireTenant();

    await this.assertNameAvailable(input.name);
    if (input.parentId) await this.assertParentExists(input.parentId);
    if (input.leaderId) await this.assertUsersExist([input.leaderId]);
    if (input.memberIds.length > 0) await this.assertUsersExist(input.memberIds);

    const members = withLeader(input.memberIds, input.leaderId);

    const team = await this.prisma.client.team.create({
      data: {
        tenantId,
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? null,
        parentId: input.parentId ?? null,
        leaderId: input.leaderId ?? null,
      },
    });

    if (members.length > 0) await this.replaceMembers(team.id, members, input.leaderId ?? null);

    await this.audit.record({
      action: 'CREATE',
      entity: 'Team',
      entityId: team.id,
      description: `Created team ${team.name}`,
    });

    return this.detail(team.id);
  }

  async update(teamId: string, input: UpdateTeamRequest): Promise<TeamListItem> {
    const existing = await this.findOrFail(teamId);

    if (input.name && input.name !== existing.name) {
      await this.assertNameAvailable(input.name, teamId);
    }

    if (input.parentId) {
      if (input.parentId === teamId) {
        throw new ValidationError('A team cannot be its own parent.');
      }
      await this.assertParentExists(input.parentId);
      await this.assertNoCycle(teamId, input.parentId);
    }

    if (input.leaderId) await this.assertUsersExist([input.leaderId]);
    if (input.memberIds) await this.assertUsersExist(input.memberIds);

    const leaderId = input.leaderId === undefined ? existing.leaderId : input.leaderId;
    const memberIds = input.memberIds
      ? withLeader(input.memberIds, leaderId)
      : input.leaderId
        ? withLeader(
            (
              await this.prisma.client.teamMember.findMany({
                where: { teamId },
                select: { userId: true },
              })
            ).map((member) => member.userId),
            leaderId,
          )
        : null;

    const data: Prisma.TeamUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.color !== undefined) data.color = input.color ?? null;
    if (input.parentId !== undefined) data.parentId = input.parentId ?? null;
    if (input.leaderId !== undefined) data.leaderId = input.leaderId ?? null;

    await this.prisma.client.team.update({ where: { id: teamId }, data });

    if (memberIds) await this.replaceMembers(teamId, memberIds, leaderId ?? null);

    await this.audit.record({
      action: 'UPDATE',
      entity: 'Team',
      entityId: teamId,
      description: `Updated team ${input.name ?? existing.name}`,
    });

    return this.detail(teamId);
  }

  async remove(teamId: string): Promise<{ deleted: true }> {
    const team = await this.findOrFail(teamId);

    const childCount = await this.prisma.client.team.count({
      where: { parentId: teamId, deletedAt: null },
    });
    if (childCount > 0) {
      throw new ConflictError(
        'This team still has sub-teams. Move or remove them before deleting it.',
      );
    }

    await this.prisma.client.team.update({
      where: { id: teamId },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      action: 'DELETE',
      entity: 'Team',
      entityId: teamId,
      description: `Deleted team ${team.name}`,
    });

    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async detail(teamId: string): Promise<TeamListItem> {
    const team = await this.prisma.client.team.findFirst({
      where: { id: teamId, deletedAt: null },
      include: TEAM_INCLUDE,
    });
    if (!team) throw new NotFoundError('Team', teamId);

    const openJobs = await this.countOpenJobs([teamId]);
    return toTeamListItem(team, openJobs.get(teamId) ?? 0);
  }

  private async findOrFail(teamId: string): Promise<{ id: string; name: string; leaderId: string | null }> {
    const team = await this.prisma.client.team.findFirst({
      where: { id: teamId, deletedAt: null },
      select: { id: true, name: true, leaderId: true },
    });
    if (!team) throw new NotFoundError('Team', teamId);
    return team;
  }

  private async assertNameAvailable(name: string, exceptId?: string): Promise<void> {
    const duplicate = await this.prisma.client.team.findFirst({
      where: {
        name,
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictError(`A team named “${name}” already exists.`);
    }
  }

  private async assertParentExists(parentId: string): Promise<void> {
    const parent = await this.prisma.client.team.findFirst({
      where: { id: parentId, deletedAt: null },
      select: { id: true },
    });
    if (!parent) throw new ValidationError('That parent team does not exist.', { parentId });
  }

  /** Walks up from the proposed parent to make sure the move stays acyclic. */
  private async assertNoCycle(teamId: string, parentId: string): Promise<void> {
    let cursor: string | null = parentId;
    const seen = new Set<string>();

    while (cursor) {
      if (cursor === teamId) {
        throw new ValidationError('That would create a loop in the team hierarchy.');
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);

      const parent: { parentId: string | null } | null = await this.prisma.client.team.findFirst({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = parent?.parentId ?? null;
    }
  }

  private async assertUsersExist(userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    const found = await this.prisma.client.user.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true },
    });

    const missing = unique.filter((id) => !found.some((user) => user.id === id));
    if (missing.length > 0) {
      throw new ValidationError('Some of those users do not exist.', { userIds: missing });
    }
  }

  private async replaceMembers(
    teamId: string,
    userIds: string[],
    leaderId: string | null,
  ): Promise<void> {
    const tenantId = requireTenant();
    const unique = [...new Set(userIds)];

    await this.prisma.client.$transaction([
      this.prisma.client.teamMember.deleteMany({ where: { teamId } }),
      this.prisma.client.teamMember.createMany({
        data: unique.map((userId) => ({
          tenantId,
          teamId,
          userId,
          isLead: userId === leaderId,
        })),
        skipDuplicates: true,
      }),
    ]);
  }

  /** Open requisitions per team, as a map, for the list view. */
  private async countOpenJobs(teamIds: string[]): Promise<Map<string, number>> {
    if (teamIds.length === 0) return new Map();

    const grouped = await this.prisma.client.job.groupBy({
      by: ['teamId'],
      where: { teamId: { in: teamIds }, status: 'OPEN', deletedAt: null },
      _count: { _all: true },
    });

    const map = new Map<string, number>();
    for (const row of grouped) {
      if (row.teamId) map.set(row.teamId, row._count._all);
    }
    return map;
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function toTeamListItem(team: TeamWithRelations, openJobs: number): TeamListItem {
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    color: team.color,
    parentId: team.parentId,
    leader: team.leader
      ? {
          id: team.leader.id,
          fullName: `${team.leader.firstName} ${team.leader.lastName}`.trim(),
          avatarUrl: team.leader.avatarUrl,
        }
      : null,
    memberCount: team._count.members,
    openJobs,
    createdAt: team.createdAt.toISOString(),
  };
}

/** The leader is always a member, so the two fields cannot drift apart. */
function withLeader(memberIds: string[], leaderId: string | null | undefined): string[] {
  const unique = [...new Set(memberIds)];
  if (leaderId && !unique.includes(leaderId)) unique.push(leaderId);
  return unique;
}

function requireTenant(): string {
  const tenantId = requestContext.tenantId;
  if (!tenantId) throw new ForbiddenError('This action must run inside a workspace.');
  return tenantId;
}
