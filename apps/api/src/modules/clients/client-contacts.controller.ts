import { Controller, Delete, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  idSchema,
  updateClientContactSchema,
  type ClientContactItem,
  type UpdateClientContactRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import { RequirePermissions } from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam } from '@/common/decorators/zod.decorator';

import { ClientsService } from './clients.service';

const idParamSchema = z.object({ id: idSchema });

/**
 * Top-level contact routes. Contacts are created and listed through their
 * client (`/clients/:id/contacts`) but edited and removed by their own id, which
 * is what a contact card in the UI already holds.
 */
@ApiTags('clients')
@Controller('contacts')
export class ClientContactsController {
  constructor(private readonly clients: ClientsService) {}

  @Patch(':id')
  @RequirePermissions('contact:update')
  @Audit({ action: 'UPDATE', entity: 'ClientContact' })
  @ApiOperation({ summary: 'Edit a client contact' })
  update(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updateClientContactSchema) body: UpdateClientContactRequest,
  ): Promise<ClientContactItem> {
    return this.clients.updateContact(params.id, body);
  }

  @Delete(':id')
  @RequirePermissions('contact:delete')
  @Audit({ action: 'DELETE', entity: 'ClientContact' })
  @ApiOperation({ summary: 'Soft-delete a contact (blocked while referenced by an open requisition)' })
  remove(@ZodParam(idParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.clients.removeContact(params.id);
  }
}
