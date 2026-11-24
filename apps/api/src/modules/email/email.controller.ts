import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createEmailTemplateSchema,
  emailMessageQuerySchema,
  emailTemplateQuerySchema,
  idSchema,
  previewEmailSchema,
  sendEmailSchema,
  updateEmailTemplateSchema,
  type CreateEmailTemplateRequest,
  type EmailMessageItem,
  type EmailMessageQuery,
  type EmailPreview,
  type EmailTemplateItem,
  type EmailTemplateQuery,
  type Paginated,
  type PreviewEmailRequest,
  type SendEmailRequest,
  type UpdateEmailTemplateRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import { RequirePermissions } from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { EmailService } from './email.service';

const idParamSchema = z.object({ id: idSchema });

/**
 * Email — templates, server-side merge previews and the outbound message log.
 * Static segments are declared before the parameterised `templates/:id` routes
 * so a literal path is never mistaken for an id.
 */
@ApiTags('email')
@Controller('email')
export class EmailController {
  constructor(private readonly email: EmailService) {}

  @Get('templates')
  @RequirePermissions('email:template_read')
  @ApiOperation({ summary: 'List email templates' })
  listTemplates(
    @ZodQuery(emailTemplateQuerySchema) query: EmailTemplateQuery,
  ): Promise<Paginated<EmailTemplateItem>> {
    return this.email.listTemplates(query);
  }

  @Post('templates')
  @RequirePermissions('email:template_manage')
  @Audit({ action: 'CREATE', entity: 'EmailTemplate' })
  @ApiOperation({ summary: 'Create an email template' })
  createTemplate(
    @ZodBody(createEmailTemplateSchema) body: CreateEmailTemplateRequest,
  ): Promise<EmailTemplateItem> {
    return this.email.createTemplate(body);
  }

  @Post('preview')
  @RequirePermissions('email:send')
  @ApiOperation({ summary: 'Render a template’s merge fields for the compose dialog' })
  preview(@ZodBody(previewEmailSchema) body: PreviewEmailRequest): Promise<EmailPreview> {
    return this.email.preview(body);
  }

  @Post('send')
  @RequirePermissions('email:send')
  @Audit({ action: 'CREATE', entity: 'EmailMessage' })
  @ApiOperation({ summary: 'Send a composed email and log it on the timeline' })
  send(@ZodBody(sendEmailSchema) body: SendEmailRequest): Promise<EmailMessageItem> {
    return this.email.send(body);
  }

  @Get('messages')
  @RequirePermissions('email:template_read')
  @ApiOperation({ summary: 'List sent and received email messages' })
  listMessages(
    @ZodQuery(emailMessageQuerySchema) query: EmailMessageQuery,
  ): Promise<Paginated<EmailMessageItem>> {
    return this.email.listMessages(query);
  }

  @Get('messages/:id')
  @RequirePermissions('email:template_read')
  @ApiOperation({ summary: 'Read a single email message' })
  getMessage(@ZodParam(idParamSchema) params: { id: string }): Promise<EmailMessageItem> {
    return this.email.getMessage(params.id);
  }

  @Patch('templates/:id')
  @RequirePermissions('email:template_manage')
  @Audit({ action: 'UPDATE', entity: 'EmailTemplate' })
  @ApiOperation({ summary: 'Update an email template' })
  updateTemplate(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updateEmailTemplateSchema) body: UpdateEmailTemplateRequest,
  ): Promise<EmailTemplateItem> {
    return this.email.updateTemplate(params.id, body);
  }

  @Delete('templates/:id')
  @RequirePermissions('email:template_manage')
  @Audit({ action: 'DELETE', entity: 'EmailTemplate' })
  @ApiOperation({ summary: 'Soft-delete an email template' })
  removeTemplate(@ZodParam(idParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.email.removeTemplate(params.id);
  }
}
