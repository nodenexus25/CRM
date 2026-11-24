import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createImportTemplateSchema,
  idSchema,
  importEntityTypeSchema,
  importJobQuerySchema,
  importMappingSchema,
  importPreviewQuerySchema,
  importRunSchema,
  importTemplateQuerySchema,
  importUploadQuerySchema,
  updateImportTemplateSchema,
  type CreateImportTemplateRequest,
  type ImportEntityType,
  type ImportFieldDefinition,
  type ImportJobQuery,
  type ImportJobSummary,
  type ImportMappingRequest,
  type ImportPreviewQuery,
  type ImportPreviewResponse,
  type ImportRunRequest,
  type ImportSampleTemplate,
  type ImportTemplateQuery,
  type ImportTemplateSummary,
  type ImportUploadQuery,
  type ImportUploadTicket,
  type Paginated,
  type UpdateImportTemplateRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { IMPORT_ANY_PERMISSIONS, ImportsService } from './imports.service';

const idParamSchema = z.object({ id: idSchema });
/** `fields` and `sample` need a concrete entity; the wizard picks it first. */
const entityQuerySchema = z.object({ entity: importEntityTypeSchema });
type EntityQuery = { entity: ImportEntityType };

/**
 * CSV/Excel import (Phase 2, Module 7).
 *
 * A four-step wizard over one `ImportJob`: request a presigned `PUT`, preview
 * the mapping against a sample of rows, run it, then poll or download the
 * rejects. Bytes never pass through the API — the browser uploads straight to
 * object storage and the wizard only ever hands the API a row id.
 *
 * The write routes advertise the union of every permission an import may need
 * (`IMPORT_ANY_PERMISSIONS`), because the entity that decides the exact keys
 * lives in the body or the stored row, which a static decorator cannot see. The
 * service re-checks the entity's full permission set before anything is
 * written. Template and history-management routes are gated on `import:create`.
 *
 * Static path segments are declared before `:id` so `fields`, `sample`,
 * `templates` and `upload-url` are never captured as an id.
 */
@ApiTags('imports')
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  // ---------------------------------------------------------------------------
  // Wizard metadata
  // ---------------------------------------------------------------------------

  @Get('fields')
  @RequireAnyPermission(...IMPORT_ANY_PERMISSIONS)
  @ApiOperation({ summary: 'List the mappable fields for an entity' })
  fields(@ZodQuery(entityQuerySchema) query: EntityQuery): ImportFieldDefinition[] {
    return this.imports.fields(query.entity);
  }

  @Get('sample')
  @RequireAnyPermission(...IMPORT_ANY_PERMISSIONS)
  @ApiOperation({ summary: 'Download a CSV template with canonical headers' })
  sample(@ZodQuery(entityQuerySchema) query: EntityQuery): ImportSampleTemplate {
    return this.imports.sample(query.entity);
  }

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------

  @Get('templates')
  @RequireAnyPermission(...IMPORT_ANY_PERMISSIONS)
  @ApiOperation({ summary: 'List saved import templates' })
  listTemplates(
    @ZodQuery(importTemplateQuerySchema) query: ImportTemplateQuery,
  ): Promise<ImportTemplateSummary[]> {
    return this.imports.listTemplates(query);
  }

  @Post('templates')
  @RequirePermissions('import:create')
  @Audit({ action: 'CREATE', entity: 'ImportTemplate', description: 'Saved an import template' })
  @ApiOperation({ summary: 'Save a reusable mapping as a template' })
  createTemplate(
    @ZodBody(createImportTemplateSchema) body: CreateImportTemplateRequest,
  ): Promise<ImportTemplateSummary> {
    return this.imports.createTemplate(body);
  }

  @Patch('templates/:id')
  @RequirePermissions('import:create')
  @Audit({ action: 'UPDATE', entity: 'ImportTemplate' })
  @ApiOperation({ summary: 'Update a saved import template' })
  updateTemplate(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updateImportTemplateSchema) body: UpdateImportTemplateRequest,
  ): Promise<ImportTemplateSummary> {
    return this.imports.updateTemplate(params.id, body);
  }

  @Delete('templates/:id')
  @RequirePermissions('import:create')
  @Audit({ action: 'DELETE', entity: 'ImportTemplate' })
  @ApiOperation({ summary: 'Delete a saved import template' })
  removeTemplate(@ZodParam(idParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.imports.removeTemplate(params.id);
  }

  // ---------------------------------------------------------------------------
  // Wizard steps
  // ---------------------------------------------------------------------------

  @Post('upload-url')
  @RequireAnyPermission(...IMPORT_ANY_PERMISSIONS)
  @Audit({ action: 'CREATE', entity: 'ImportJob', description: 'Created an import upload' })
  @ApiOperation({ summary: 'Reserve an import and return a presigned PUT URL' })
  createUploadUrl(
    @ZodBody(importUploadQuerySchema) body: ImportUploadQuery,
  ): Promise<ImportUploadTicket> {
    return this.imports.createUploadTicket(body);
  }

  @Post(':id/preview')
  @RequireAnyPermission(...IMPORT_ANY_PERMISSIONS)
  @ApiOperation({ summary: 'Preview the mapping against a sample of rows' })
  preview(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(importMappingSchema) body: ImportMappingRequest,
    @ZodQuery(importPreviewQuerySchema) query: ImportPreviewQuery,
  ): Promise<ImportPreviewResponse> {
    return this.imports.preview(params.id, body, query.limit);
  }

  @Post(':id/run')
  @RequireAnyPermission(...IMPORT_ANY_PERMISSIONS)
  @Audit({ action: 'IMPORT', entity: 'ImportJob', description: 'Started a CSV/Excel import' })
  @ApiOperation({ summary: 'Persist the mapping and queue the import' })
  run(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(importRunSchema) body: ImportRunRequest,
  ): Promise<ImportJobSummary> {
    return this.imports.run(params.id, body);
  }

  @Post(':id/cancel')
  @RequireAnyPermission(...IMPORT_ANY_PERMISSIONS)
  @Audit({ action: 'UPDATE', entity: 'ImportJob', description: 'Cancelled an import' })
  @ApiOperation({ summary: 'Cancel an unfinished import' })
  cancel(@ZodParam(idParamSchema) params: { id: string }): Promise<ImportJobSummary> {
    return this.imports.cancel(params.id);
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  @Get()
  @RequireAnyPermission(...IMPORT_ANY_PERMISSIONS)
  @ApiOperation({ summary: 'List imports with progress and status filters' })
  list(@ZodQuery(importJobQuerySchema) query: ImportJobQuery): Promise<Paginated<ImportJobSummary>> {
    return this.imports.list(query);
  }

  @Get(':id/errors')
  @RequireAnyPermission(...IMPORT_ANY_PERMISSIONS)
  @ApiOperation({ summary: 'Get a fresh download link for the row-error CSV' })
  errors(@ZodParam(idParamSchema) params: { id: string }): Promise<{ downloadUrl: string }> {
    return this.imports.errors(params.id);
  }

  @Get(':id')
  @RequireAnyPermission(...IMPORT_ANY_PERMISSIONS)
  @ApiOperation({ summary: 'Poll an import for progress and its result counters' })
  detail(@ZodParam(idParamSchema) params: { id: string }): Promise<ImportJobSummary> {
    return this.imports.detail(params.id);
  }

  @Delete(':id')
  @RequirePermissions('import:create')
  @Audit({ action: 'DELETE', entity: 'ImportJob' })
  @ApiOperation({ summary: 'Remove a finished import from history' })
  remove(@ZodParam(idParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.imports.remove(params.id);
  }
}
