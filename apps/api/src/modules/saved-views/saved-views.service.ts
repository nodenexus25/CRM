import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type CreateSavedViewRequest,
  type SavedViewEntity,
  type SavedViewItem,
  type SavedViewQuery,
  type UpdateSavedViewRequest,
} from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import { ConflictError, ForbiddenError, NotFoundError } from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import { PrismaService } from '@/infra/prisma/prisma.service';

type SavedViewRow = Prisma.SavedSearchGetPayload<Record<string, never>>;

/**
 * Saved views — reusable list configurations ("My hot jobs", "Stale
 * submissions").
 *
 * A view is either owned by a single user (`userId` set) or shared with the
 * whole workspace (`userId = null`). Ownership decides who may edit or delete:
 * a private view is invisible to everyone else, while a `TEAM`/`TENANT` view is
 * readable by every member but still writable only by its author.
 */
@Injectable()
export class SavedViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: SavedViewQuery): Promise<SavedViewItem[]> {
    const userId = requireUser();

    const rows = await this.prisma.client.savedSearch.findMany({
      where: {
        deletedAt: null,
        ...(query.entity ? { entity: query.entity } : {}),
        OR: [{ userId }, { userId: null }, { visibility: { in: ['TEAM', 'TENANT'] } }],
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => toSavedViewItem(row, userId));
  }

  async create(input: CreateSavedViewRequest): Promise<SavedViewItem> {
    const tenantId = requireTenant();
    const userId = requireUser();

    await this.assertNameAvailable(userId, input.entity, input.name);

    const created = await this.prisma.client.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.savedSearch.updateMany({
          where: { userId, entity: input.entity, isDefault: true, deletedAt: null },
          data: { isDefault: false },
        });
      }

      return tx.savedSearch.create({
        data: {
          tenantId,
          userId,
          entity: input.entity,
          name: input.name,
          filters: input.filters as Prisma.InputJsonValue,
          columns: input.columns,
          sortBy: input.sortBy ?? null,
          sortDir: input.sortDir ?? null,
          visibility: input.visibility,
          isDefault: input.isDefault,
        },
      });
    });

    await this.audit.record({
      action: 'CREATE',
      entity: 'SavedView',
      entityId: created.id,
      description: `Saved a ${input.entity.toLowerCase()} view “${created.name}”`,
    });

    return toSavedViewItem(created, userId);
  }

  async update(viewId: string, input: UpdateSavedViewRequest): Promise<SavedViewItem> {
    const userId = requireUser();
    const existing = await this.findOwnedOrFail(viewId, userId);

    if (input.name !== undefined && input.name !== existing.name) {
      await this.assertNameAvailable(userId, existing.entity as SavedViewEntity, input.name, viewId);
    }

    const data: Prisma.SavedSearchUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.filters !== undefined) data.filters = input.filters as Prisma.InputJsonValue;
    if (input.columns !== undefined) data.columns = input.columns;
    if (input.sortBy !== undefined) data.sortBy = input.sortBy ?? null;
    if (input.sortDir !== undefined) data.sortDir = input.sortDir ?? null;
    if (input.visibility !== undefined) data.visibility = input.visibility;
    if (input.isDefault !== undefined) data.isDefault = input.isDefault;

    const updated = await this.prisma.client.$transaction(async (tx) => {
      if (input.isDefault === true) {
        await tx.savedSearch.updateMany({
          where: {
            userId,
            entity: existing.entity,
            isDefault: true,
            deletedAt: null,
            id: { not: viewId },
          },
          data: { isDefault: false },
        });
      }

      return tx.savedSearch.update({ where: { id: viewId }, data });
    });

    await this.audit.record({
      action: 'UPDATE',
      entity: 'SavedView',
      entityId: viewId,
      description: `Updated the view “${updated.name}”`,
    });

    return toSavedViewItem(updated, userId);
  }

  async remove(viewId: string): Promise<{ deleted: true }> {
    const userId = requireUser();
    await this.findOwnedOrFail(viewId, userId);

    await this.prisma.client.savedSearch.update({
      where: { id: viewId },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      action: 'DELETE',
      entity: 'SavedView',
      entityId: viewId,
      description: 'Deleted a saved view',
    });

    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** A view is editable only by the user who created it. Shared views are not. */
  private async findOwnedOrFail(viewId: string, userId: string): Promise<SavedViewRow> {
    const view = await this.prisma.client.savedSearch.findFirst({
      where: { id: viewId, deletedAt: null },
    });
    if (!view) throw new NotFoundError('Saved view', viewId);
    if (view.userId !== userId) {
      throw new ForbiddenError('Only the owner can change a saved view.');
    }
    return view;
  }

  private async assertNameAvailable(
    userId: string,
    entity: SavedViewEntity,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const duplicate = await this.prisma.client.savedSearch.findFirst({
      where: {
        userId,
        entity,
        name,
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) throw new ConflictError(`You already have a view named “${name}”.`);
  }
}

// -----------------------------------------------------------------------------
// Mappers & helpers
// -----------------------------------------------------------------------------

function toSavedViewItem(row: SavedViewRow, userId: string): SavedViewItem {
  return {
    id: row.id,
    entity: row.entity as SavedViewEntity,
    name: row.name,
    filters: toFilterRecord(row.filters),
    columns: row.columns,
    sortBy: row.sortBy,
    sortDir: row.sortDir === 'asc' || row.sortDir === 'desc' ? row.sortDir : null,
    visibility: row.visibility,
    isDefault: row.isDefault,
    ownerId: row.userId,
    isOwn: row.userId === userId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** `filters` is stored as arbitrary JSON; normalise anything non-object to `{}`. */
function toFilterRecord(value: Prisma.JsonValue): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
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
