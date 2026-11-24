import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createNoteSchema,
  idSchema,
  noteQuerySchema,
  updateNoteSchema,
  type CreateNoteRequest,
  type NoteItem,
  type NoteQuery,
  type Paginated,
  type UpdateNoteRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import { RequirePermissions } from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { NotesService } from './notes.service';

const idParamSchema = z.object({ id: idSchema });

/**
 * Notes — free-form, pinnable memos attached to any record. `note:read` is a
 * workspace-wide grant; edits and deletes stay author-only unless the caller
 * also holds the route's write permission, which the service enforces.
 */
@ApiTags('notes')
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  @RequirePermissions('note:read')
  @ApiOperation({ summary: 'List a record’s notes, pinned first' })
  list(@ZodQuery(noteQuerySchema) query: NoteQuery): Promise<Paginated<NoteItem>> {
    return this.notes.list(query);
  }

  @Post()
  @RequirePermissions('note:create')
  @Audit({ action: 'CREATE', entity: 'Note' })
  @ApiOperation({ summary: 'Add a note to a record' })
  create(@ZodBody(createNoteSchema) body: CreateNoteRequest): Promise<NoteItem> {
    return this.notes.create(body);
  }

  @Patch(':id')
  @RequirePermissions('note:update')
  @Audit({ action: 'UPDATE', entity: 'Note' })
  @ApiOperation({ summary: 'Edit a note' })
  update(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updateNoteSchema) body: UpdateNoteRequest,
  ): Promise<NoteItem> {
    return this.notes.update(params.id, body);
  }

  @Delete(':id')
  @RequirePermissions('note:delete')
  @Audit({ action: 'DELETE', entity: 'Note' })
  @ApiOperation({ summary: 'Soft-delete a note' })
  remove(@ZodParam(idParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.notes.remove(params.id);
  }
}
