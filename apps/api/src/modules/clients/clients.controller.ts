import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  clientQuerySchema,
  createClientContactSchema,
  createClientSchema,
  idSchema,
  updateClientSchema,
  type ClientContactItem,
  type ClientDetail,
  type ClientListItem,
  type ClientQuery,
  type ClientStats,
  type CreateClientContactRequest,
  type CreateClientRequest,
  type Paginated,
  type UpdateClientRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { ClientsService } from './clients.service';

const idParamSchema = z.object({ id: idSchema });

/**
 * CRM clients. Reads are visible to anyone holding `client:read_all`, or to the
 * owner when the caller only has `client:read_own` — the service applies the
 * owner scoping. Writes are gated per action.
 */
@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @RequireAnyPermission('client:read_all', 'client:read_own')
  @ApiOperation({ summary: 'List clients with status, industry, owner and search filters' })
  list(@ZodQuery(clientQuerySchema) query: ClientQuery): Promise<Paginated<ClientListItem>> {
    return this.clients.list(query);
  }

  @Get('stats')
  @RequireAnyPermission('client:read_all', 'client:read_own')
  @ApiOperation({ summary: 'Client counts by status plus open-job and placement roll-ups' })
  stats(): Promise<ClientStats> {
    return this.clients.stats();
  }

  @Post()
  @RequirePermissions('client:create')
  @Audit({ action: 'CREATE', entity: 'Client' })
  @ApiOperation({ summary: 'Create a client' })
  create(@ZodBody(createClientSchema) body: CreateClientRequest): Promise<ClientDetail> {
    return this.clients.create(body);
  }

  @Get(':id')
  @RequireAnyPermission('client:read_all', 'client:read_own')
  @ApiOperation({ summary: 'Read a client with its contacts, jobs and placements' })
  detail(@ZodParam(idParamSchema) params: { id: string }): Promise<ClientDetail> {
    return this.clients.detail(params.id);
  }

  @Patch(':id')
  @RequirePermissions('client:update')
  @Audit({ action: 'UPDATE', entity: 'Client' })
  @ApiOperation({ summary: 'Edit a client' })
  update(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updateClientSchema) body: UpdateClientRequest,
  ): Promise<ClientDetail> {
    return this.clients.update(params.id, body);
  }

  @Delete(':id')
  @RequirePermissions('client:delete')
  @Audit({ action: 'DELETE', entity: 'Client' })
  @ApiOperation({ summary: 'Soft-delete a client (blocked while it has open requisitions)' })
  remove(@ZodParam(idParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.clients.remove(params.id);
  }

  @Get(':id/contacts')
  @RequireAnyPermission('contact:read_all', 'contact:read_own')
  @ApiOperation({ summary: 'List the contacts of a client' })
  listContacts(@ZodParam(idParamSchema) params: { id: string }): Promise<ClientContactItem[]> {
    return this.clients.listContacts(params.id);
  }

  @Post(':id/contacts')
  @RequirePermissions('contact:create')
  @Audit({ action: 'CREATE', entity: 'ClientContact' })
  @ApiOperation({ summary: 'Add a contact to a client' })
  createContact(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(createClientContactSchema) body: CreateClientContactRequest,
  ): Promise<ClientContactItem> {
    return this.clients.createContact(params.id, body);
  }
}
