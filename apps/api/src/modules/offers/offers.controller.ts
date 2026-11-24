import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  acceptOfferSchema,
  createOfferSchema,
  idSchema,
  offerQuerySchema,
  updateOfferSchema,
  type AcceptOfferRequest,
  type CreateOfferRequest,
  type OfferListItem,
  type OfferQuery,
  type Paginated,
  type UpdateOfferRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import { RequirePermissions } from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { OffersService } from './offers.service';

const idParamSchema = z.object({ id: idSchema });

/**
 * Offers. Reads are workspace-wide (`offer:read`); changing a status carries its
 * own audit action so the timeline shows who moved the negotiation on.
 */
@ApiTags('offers')
@Controller('offers')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Get()
  @RequirePermissions('offer:read')
  @ApiOperation({ summary: 'List offers with status, job, client and recruiter filters' })
  list(@ZodQuery(offerQuerySchema) query: OfferQuery): Promise<Paginated<OfferListItem>> {
    return this.offers.list(query);
  }

  @Post()
  @RequirePermissions('offer:create')
  @Audit({ action: 'CREATE', entity: 'Offer', description: 'Raised an offer' })
  @ApiOperation({ summary: 'Raise an offer against an application' })
  create(@ZodBody(createOfferSchema) body: CreateOfferRequest): Promise<OfferListItem> {
    return this.offers.create(body);
  }

  @Patch(':id')
  @RequirePermissions('offer:update')
  @Audit({ action: 'UPDATE', entity: 'Offer', description: 'Updated an offer' })
  @ApiOperation({ summary: 'Edit an offer and walk it along its lifecycle' })
  update(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updateOfferSchema) body: UpdateOfferRequest,
  ): Promise<OfferListItem> {
    return this.offers.update(params.id, body);
  }

  @Post(':id/accept')
  @RequirePermissions('offer:update')
  @Audit({
    action: 'STATUS_CHANGE',
    entity: 'Offer',
    description: 'Accepted an offer and created the placement',
  })
  @ApiOperation({ summary: 'Accept an offer, creating or linking its placement' })
  accept(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(acceptOfferSchema) body: AcceptOfferRequest,
  ): Promise<OfferListItem> {
    return this.offers.accept(params.id, body);
  }

  @Delete(':id')
  @RequirePermissions('offer:delete')
  @Audit({ action: 'DELETE', entity: 'Offer', description: 'Deleted an offer' })
  @ApiOperation({ summary: 'Soft-delete an offer' })
  remove(@ZodParam(idParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.offers.remove(params.id);
  }
}
