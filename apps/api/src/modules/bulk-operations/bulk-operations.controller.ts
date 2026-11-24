import { Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  bulkOperationQuerySchema,
  createBulkOperationSchema,
  idSchema,
  type BulkOperationItem,
  type BulkOperationQuery,
  type CreateBulkOperationRequest,
  type Paginated,
} from '@talentflow/types';
import { z } from 'zod';

import { RequireAnyPermission } from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { BULK_ACTION_PERMISSION_KEYS, BulkOperationsService } from './bulk-operations.service';

const idParamSchema = z.object({ id: idSchema });

/**
 * Bulk actions (Phase 2, Module 6).
 *
 * Every route advertises the union of the permissions a bulk action may need.
 * The body is a discriminated union, so a static `@RequirePermissions` cannot
 * name the one key the requested action actually requires — the service
 * re-checks the exact key (`assertBulkActionAllowed`) before anything runs, and
 * a worker re-applies it on the queued path.
 *
 * The audit entry is written by the service too, because its action
 * (`UPDATE` / `DELETE` / `STATUS_CHANGE` / `EXPORT`) depends on the bulk type,
 * which the `@Audit` decorator cannot see statically.
 */
@ApiTags('bulk-operations')
@Controller('bulk-operations')
export class BulkOperationsController {
  constructor(private readonly bulk: BulkOperationsService) {}

  @Post()
  @RequireAnyPermission(...BULK_ACTION_PERMISSION_KEYS)
  @ApiOperation({ summary: 'Resolve a selection and queue a bulk action' })
  create(
    @ZodBody(createBulkOperationSchema) body: CreateBulkOperationRequest,
  ): Promise<BulkOperationItem> {
    return this.bulk.create(body);
  }

  @Get()
  @RequireAnyPermission(...BULK_ACTION_PERMISSION_KEYS)
  @ApiOperation({ summary: 'List bulk operations with progress and status filters' })
  list(
    @ZodQuery(bulkOperationQuerySchema) query: BulkOperationQuery,
  ): Promise<Paginated<BulkOperationItem>> {
    return this.bulk.list(query);
  }

  @Get(':id')
  @RequireAnyPermission(...BULK_ACTION_PERMISSION_KEYS)
  @ApiOperation({ summary: 'Poll a bulk operation for progress and its result summary' })
  detail(@ZodParam(idParamSchema) params: { id: string }): Promise<BulkOperationItem> {
    return this.bulk.detail(params.id);
  }

  @Get(':id/result')
  @RequireAnyPermission(...BULK_ACTION_PERMISSION_KEYS)
  @ApiOperation({ summary: 'Get a fresh download link for a generated export' })
  result(@ZodParam(idParamSchema) params: { id: string }): Promise<{ downloadUrl: string }> {
    return this.bulk.result(params.id);
  }

  @Delete(':id')
  @RequireAnyPermission(...BULK_ACTION_PERMISSION_KEYS)
  @ApiOperation({ summary: 'Remove a finished operation from history' })
  remove(@ZodParam(idParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.bulk.remove(params.id);
  }
}
