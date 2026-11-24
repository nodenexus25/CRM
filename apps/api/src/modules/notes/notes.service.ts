import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildPaginationMeta,
  toSkipTake,
  type CreateNoteRequest,
  type NoteItem,
  type NoteQuery,
  type Paginated,
  type UpdateNoteRequest,
} from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import { ForbiddenError, NotFoundError, ValidationError } from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import { PrismaService } from '@/infra/prisma/prisma.service';

type NoteRow = Prisma.NoteGetPayload<Record<string, never>>;

type UserBrief = { id: string; fullName: string; avatarUrl: string | null };

/**
 * Notes — free-form, pinnable memos attached to any record.
 *
 * Distinct from `Activity`: a note is always editable and never carries a
 * direction, duration or outcome, so the two are kept apart rather than folded
 * into one polymorphic table with half the columns unused.
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: NoteQuery): Promise<Paginated<NoteItem>> {
    const where = buildWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.client.note.findMany({
        where,
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        ...toSkipTake(query),
      }),
      this.prisma.client.note.count({ where }),
    ]);

    const users = await this.loadUsers(rows.map((row) => row.createdById));
    return {
      items: rows.map((row) => toNoteItem(row, users)),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async create(input: CreateNoteRequest): Promise<NoteItem> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;

    await this.assertCandidateExists(input.candidateId);

    const created = await this.prisma.client.note.create({
      data: {
        tenantId,
        body: input.body,
        isPinned: input.isPinned,
        entityType: input.entityType,
        entityId: input.entityId,
        candidateId: input.candidateId ?? null,
        createdById: userId,
        updatedById: userId,
      },
    });

    await this.audit.record({
      action: 'CREATE',
      entity: 'Note',
      entityId: created.id,
      description: 'Added a note',
    });

    const users = await this.loadUsers([created.createdById]);
    return toNoteItem(created, users);
  }

  async update(noteId: string, input: UpdateNoteRequest): Promise<NoteItem> {
    const existing = await this.prisma.client.note.findFirst({
      where: { id: noteId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!existing) throw new NotFoundError('Note', noteId);
    // `note:update` is "edit own notes" and the route guard already proved the
    // caller holds it, so the override has to be a *different* grant — the
    // moderator-tier `note:delete` — or the author check could never fail.
    assertCanMutate(existing.createdById, 'note:delete', 'You can only edit notes you wrote.');

    const updated = await this.prisma.client.note.update({
      where: { id: noteId },
      data: {
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
        updatedById: requestContext.userId ?? null,
      },
    });

    await this.audit.record({
      action: 'UPDATE',
      entity: 'Note',
      entityId: noteId,
      description: 'Updated a note',
    });

    const users = await this.loadUsers([updated.createdById]);
    return toNoteItem(updated, users);
  }

  async remove(noteId: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.client.note.findFirst({
      where: { id: noteId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!existing) throw new NotFoundError('Note', noteId);
    assertCanMutate(existing.createdById, 'note:delete', 'You can only delete notes you wrote.');

    await this.prisma.client.note.update({
      where: { id: noteId },
      data: { deletedAt: new Date(), updatedById: requestContext.userId ?? null },
    });

    await this.audit.record({
      action: 'DELETE',
      entity: 'Note',
      entityId: noteId,
      description: 'Deleted a note',
    });

    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** `candidateId` is a nullable FK; a stale id surfaces as raw error, so 422 it. */
  private async assertCandidateExists(candidateId: string | null | undefined): Promise<void> {
    if (!candidateId) return;

    const candidate = await this.prisma.client.candidate.findFirst({
      where: { id: candidateId, deletedAt: null },
      select: { id: true },
    });
    if (!candidate) throw new ValidationError('That candidate does not exist.', { candidateId });
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

function buildWhere(query: NoteQuery): Prisma.NoteWhereInput {
  const and: Prisma.NoteWhereInput[] = [];

  if (query.entityType) and.push({ entityType: query.entityType });
  if (query.entityId) and.push({ entityId: query.entityId });
  if (query.candidateId) and.push({ candidateId: query.candidateId });
  if (query.pinnedOnly) and.push({ isPinned: true });

  return and.length > 0 ? { deletedAt: null, AND: and } : { deletedAt: null };
}

function toNoteItem(row: NoteRow, users: Map<string, UserBrief>): NoteItem {
  const author = row.createdById ? users.get(row.createdById) ?? null : null;
  return {
    id: row.id,
    body: row.body,
    isPinned: row.isPinned,
    entityType: row.entityType,
    entityId: row.entityId,
    candidateId: row.candidateId,
    createdBy: author
      ? { id: author.id, fullName: author.fullName, avatarUrl: author.avatarUrl }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A note belongs to whoever wrote it. The route guard proves the caller holds
 * the route's permission; this adds the author check the guard cannot express.
 * `overridePermission` must be a grant the route does *not* already require,
 * otherwise every caller who reached the handler would pass.
 */
function assertCanMutate(createdById: string | null, overridePermission: string, message: string): void {
  const userId = requestContext.userId;
  const isAuthor = createdById !== null && createdById === userId;
  const canOverride = (requestContext.get()?.permissions ?? []).includes(overridePermission);
  if (!isAuthor && !canOverride) throw new ForbiddenError(message);
}

function requireTenant(): string {
  const tenantId = requestContext.tenantId;
  if (!tenantId) throw new ForbiddenError('This action must run inside a workspace.');
  return tenantId;
}

function composeName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}
