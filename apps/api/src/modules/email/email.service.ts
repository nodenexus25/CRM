import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildPaginationMeta,
  emailTemplateCategorySchema,
  extractMergeFields,
  isMergeField,
  toSkipTake,
  type CreateEmailTemplateRequest,
  type EmailMessageItem,
  type EmailMessageQuery,
  type EmailPreview,
  type EmailTemplateItem,
  type EmailTemplateQuery,
  type EntityType,
  type Paginated,
  type PreviewEmailRequest,
  type SendEmailRequest,
  type UpdateEmailTemplateRequest,
} from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/common/errors/domain-errors';
import { createRequestContext, requestContext } from '@/common/request-context';
import { MailerService } from '@/infra/mail/mailer.service';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { EmailQueueService } from '@/infra/queue/email-queue.service';
import type { EmailOutboundJob } from '@/infra/queue/queue.constants';

import {
  collectMissingFields,
  renderMergeText,
  type MergeContext,
} from './merge-renderer';

const EMAIL_MESSAGE_INCLUDE = {
  template: { select: { id: true, name: true, key: true } },
} satisfies Prisma.EmailMessageInclude;

type EmailTemplateRow = Prisma.EmailTemplateGetPayload<Record<string, never>>;
type EmailMessageRow = Prisma.EmailMessageGetPayload<{ include: typeof EMAIL_MESSAGE_INCLUDE }>;

type UserBrief = { id: string; fullName: string; avatarUrl: string | null };

/** Fields shared by preview and send that drive merge resolution. */
interface MergeResolutionInput {
  entityType?: EntityType;
  entityId?: string;
  candidateId?: string | null;
  jobId?: string | null;
  mergeData?: Record<string, string>;
}

/** Fields shared by preview and send that supply the copy to render. */
interface ContentResolutionInput {
  templateId?: string;
  subject?: string;
  body?: string;
}

interface ResolvedContent {
  subject: string;
  body: string;
  htmlBody: string | null;
  /** The template the copy came from, or `null` for an ad-hoc message. */
  templateId: string | null;
}

const parseCategory = emailTemplateCategorySchema.catch('GENERAL');

/**
 * Email — tenant-authored templates, server-side merge rendering and the
 * outbound message log.
 *
 * Templates are soft-deleted and their `key` is unique per tenant; the shipped
 * `isSystem` rows can be deactivated but never removed. Every send renders its
 * merge fields from a whitelisted, per-entity context and then hands delivery
 * to the `email-outbound` queue, so a slow SMTP server never blocks the request.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
    private readonly emailQueue: EmailQueueService,
  ) {}

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------

  async listTemplates(query: EmailTemplateQuery): Promise<Paginated<EmailTemplateItem>> {
    const where = buildTemplateWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.client.emailTemplate.findMany({
        where,
        orderBy: buildTemplateOrderBy(query),
        ...toSkipTake(query),
      }),
      this.prisma.client.emailTemplate.count({ where }),
    ]);

    return {
      items: rows.map(toEmailTemplateItem),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async createTemplate(input: CreateEmailTemplateRequest): Promise<EmailTemplateItem> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;

    // The unique constraint spans soft-deleted rows too, so check without the
    // `deletedAt` filter and surface a clean 409 instead of a constraint error.
    const existing = await this.prisma.client.emailTemplate.findFirst({
      where: { key: input.key },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError('A template with that key already exists.', { key: input.key });
    }

    const created = await this.prisma.client.emailTemplate.create({
      data: {
        tenantId,
        name: input.name,
        key: input.key,
        subject: input.subject,
        body: input.body,
        htmlBody: input.htmlBody ?? null,
        category: input.category,
        mergeFields: resolveMergeFields(input.mergeFields, input.subject, input.body, input.htmlBody ?? null),
        isActive: input.isActive,
        createdById: userId,
        updatedById: userId,
      },
    });

    await this.audit.record({
      action: 'CREATE',
      entity: 'EmailTemplate',
      entityId: created.id,
      description: `Created email template "${created.name}"`,
    });

    return toEmailTemplateItem(created);
  }

  async updateTemplate(templateId: string, input: UpdateEmailTemplateRequest): Promise<EmailTemplateItem> {
    const existing = await this.prisma.client.emailTemplate.findFirst({
      where: { id: templateId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError('EmailTemplate', templateId);

    // `key`, `isSystem` and `tenantId` are intentionally immutable here.
    const updated = await this.prisma.client.emailTemplate.update({
      where: { id: templateId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.htmlBody !== undefined ? { htmlBody: input.htmlBody } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.mergeFields !== undefined
          ? { mergeFields: assertMergeFields(input.mergeFields) }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedById: requestContext.userId ?? null,
      },
    });

    await this.audit.record({
      action: 'UPDATE',
      entity: 'EmailTemplate',
      entityId: templateId,
      description: `Updated email template "${updated.name}"`,
    });

    return toEmailTemplateItem(updated);
  }

  async removeTemplate(templateId: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.client.emailTemplate.findFirst({
      where: { id: templateId, deletedAt: null },
      select: { id: true, isSystem: true },
    });
    if (!existing) throw new NotFoundError('EmailTemplate', templateId);
    if (existing.isSystem) {
      throw new ConflictError('System templates can be deactivated but not deleted.');
    }

    await this.prisma.client.emailTemplate.update({
      where: { id: templateId },
      data: { deletedAt: new Date(), updatedById: requestContext.userId ?? null },
    });

    await this.audit.record({
      action: 'DELETE',
      entity: 'EmailTemplate',
      entityId: templateId,
      description: 'Deleted an email template',
    });

    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Composing
  // ---------------------------------------------------------------------------

  async preview(input: PreviewEmailRequest): Promise<EmailPreview> {
    const content = await this.resolveContent(input);
    const context = await this.resolveMergeContext(input);

    return {
      subject: renderMergeText(content.subject, context),
      body: renderMergeText(content.body, context),
      missingFields: collectMissingFields([content.subject, content.body], context),
    };
  }

  async send(input: SendEmailRequest): Promise<EmailMessageItem> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;

    const content = await this.resolveContent(input);
    const context = await this.resolveMergeContext(input);

    const subject = renderMergeText(content.subject, context);
    const bodyText = renderMergeText(content.body, context);
    const bodyHtml = content.htmlBody ? renderMergeText(content.htmlBody, context) : null;

    const tenant = await this.prisma.client.tenant.findFirst({
      where: { id: tenantId },
      select: { name: true },
    });

    const message = await this.prisma.client.emailMessage.create({
      data: {
        tenantId,
        direction: 'OUTBOUND',
        fromAddress: this.mailer.fromAddress,
        fromName: tenant?.name ?? null,
        toAddresses: input.to,
        ccAddresses: input.cc,
        bccAddresses: input.bcc,
        replyTo: input.replyTo ?? null,
        subject,
        bodyText,
        bodyHtml,
        status: 'QUEUED',
        templateId: content.templateId,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        candidateId: input.candidateId ?? null,
        jobId: input.jobId ?? null,
        createdById: userId,
      },
    });

    await this.createTimelineEntry(tenantId, input, message.id, subject, bodyText, userId);

    try {
      await this.emailQueue.enqueueOutbound({ tenantId, messageId: message.id, userId });
    } catch (error) {
      // The queue is unreachable: the message was never handed to a worker, so
      // record that honestly rather than leaving it looking queued.
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to enqueue outbound email ${message.id}: ${detail}`);
      await this.prisma.client.emailMessage.update({
        where: { id: message.id },
        data: { status: 'FAILED', error: detail.slice(0, 1000) },
      });
    }

    const stored = await this.prisma.client.emailMessage.findFirst({
      where: { id: message.id, deletedAt: null },
      include: EMAIL_MESSAGE_INCLUDE,
    });
    if (!stored) throw new NotFoundError('EmailMessage', message.id);

    const users = await this.loadUsers([stored.createdById]);
    return toEmailMessageItem(stored, users);
  }

  // ---------------------------------------------------------------------------
  // Message log
  // ---------------------------------------------------------------------------

  async listMessages(query: EmailMessageQuery): Promise<Paginated<EmailMessageItem>> {
    const where = buildMessageWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.client.emailMessage.findMany({
        where,
        include: EMAIL_MESSAGE_INCLUDE,
        orderBy: buildMessageOrderBy(query),
        ...toSkipTake(query),
      }),
      this.prisma.client.emailMessage.count({ where }),
    ]);

    const users = await this.loadUsers(rows.map((row) => row.createdById));
    return {
      items: rows.map((row) => toEmailMessageItem(row, users)),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async getMessage(messageId: string): Promise<EmailMessageItem> {
    const row = await this.prisma.client.emailMessage.findFirst({
      where: { id: messageId, deletedAt: null },
      include: EMAIL_MESSAGE_INCLUDE,
    });
    if (!row) throw new NotFoundError('EmailMessage', messageId);

    const users = await this.loadUsers([row.createdById]);
    return toEmailMessageItem(row, users);
  }

  // ---------------------------------------------------------------------------
  // Worker entry point
  // ---------------------------------------------------------------------------

  /**
   * Delivers one queued `EmailMessage`. The worker has no HTTP request to
   * inherit a tenant from, so it re-enters a tenant context before touching the
   * database. Only ids reach the logs — bodies and recipients are PII.
   */
  async runOutboundJob(job: EmailOutboundJob): Promise<void> {
    await requestContext.run(
      createRequestContext({ tenantId: job.tenantId, bypassTenant: false }),
      async () => {
        const record = await this.prisma.client.emailMessage.findFirst({
          where: { id: job.messageId, deletedAt: null },
        });
        if (!record) {
          this.logger.warn(`Email message ${job.messageId} no longer exists; skipping delivery`);
          return;
        }
        // A retry must never deliver a message twice.
        if (record.status !== 'QUEUED' && record.status !== 'FAILED') {
          this.logger.debug(`Email message ${job.messageId} is already ${record.status}; skipping`);
          return;
        }

        // Only the SMTP hand-off is allowed to fail the job: BullMQ retries a
        // thrown job, so an error raised *after* a successful send would
        // re-deliver the message to every recipient.
        try {
          await this.mailer.sendRaw({
            to: record.toAddresses,
            cc: record.ccAddresses,
            bcc: record.bccAddresses,
            subject: record.subject,
            text: record.bodyText ?? record.bodyHtml ?? '',
            html: record.bodyHtml ?? undefined,
            replyTo: record.replyTo ?? undefined,
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          await this.markDelivery(job.messageId, { status: 'FAILED', error: detail.slice(0, 1000) });
          throw error;
        }

        await this.markDelivery(job.messageId, { status: 'SENT', sentAt: new Date(), error: null });
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Records a delivery outcome. `updateMany` tolerates a row that was deleted
   * mid-flight, and a bookkeeping failure is logged rather than thrown so it
   * can never turn into a retry (and so a duplicate send).
   */
  private async markDelivery(
    messageId: string,
    data: Prisma.EmailMessageUpdateManyMutationInput,
  ): Promise<void> {
    try {
      await this.prisma.client.emailMessage.updateMany({ where: { id: messageId }, data });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`Could not record delivery status for email ${messageId}: ${detail}`);
    }
  }

  /** Resolves the subject/body to render, loading the template when asked. */
  private async resolveContent(input: ContentResolutionInput): Promise<ResolvedContent> {
    if (input.templateId) {
      const template = await this.prisma.client.emailTemplate.findFirst({
        where: { id: input.templateId, deletedAt: null },
        select: { subject: true, body: true, htmlBody: true },
      });
      if (!template) throw new NotFoundError('EmailTemplate', input.templateId);
      return {
        subject: template.subject,
        body: template.body,
        htmlBody: template.htmlBody,
        templateId: input.templateId,
      };
    }

    return {
      subject: input.subject ?? '',
      body: input.body ?? '',
      htmlBody: null,
      templateId: null,
    };
  }

  /**
   * Builds the flat, whitelisted merge context for a request. Values are read
   * from the linked record the request names (candidate, job, interview, …)
   * and then `mergeData` is overlaid so the client can override anything.
   */
  private async resolveMergeContext(request: MergeResolutionInput): Promise<MergeContext> {
    let candidateId = request.candidateId ?? null;
    let jobId = request.jobId ?? null;

    if (request.entityType === 'CANDIDATE' && request.entityId) candidateId = request.entityId;
    if (request.entityType === 'JOB' && request.entityId) jobId = request.entityId;

    let interview: { scheduledStart: Date; meetingUrl: string | null } | null = null;
    if (request.entityType === 'INTERVIEW' && request.entityId) {
      const found = await this.prisma.client.interview.findFirst({
        where: { id: request.entityId, deletedAt: null },
        select: {
          scheduledStart: true,
          meetingUrl: true,
          application: { select: { candidateId: true, jobId: true } },
        },
      });
      if (found) {
        interview = { scheduledStart: found.scheduledStart, meetingUrl: found.meetingUrl };
        candidateId = candidateId ?? found.application.candidateId;
        jobId = jobId ?? found.application.jobId;
      }
    }

    const candidate = candidateId
      ? await this.prisma.client.candidate.findFirst({
          where: { id: candidateId, deletedAt: null },
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            headline: true,
            currentTitle: true,
            locationCity: true,
          },
        })
      : null;

    const job = jobId
      ? await this.prisma.client.job.findFirst({
          where: { id: jobId, deletedAt: null },
          select: { title: true, referenceCode: true, locationCity: true, clientId: true, contactId: true },
        })
      : null;

    const contactId = job?.contactId ?? (request.entityType === 'CONTACT' ? request.entityId ?? null : null);
    const contact = contactId
      ? await this.prisma.client.clientContact.findFirst({
          where: { id: contactId, deletedAt: null },
          select: { firstName: true, lastName: true, email: true, clientId: true },
        })
      : null;

    let clientId = job?.clientId ?? null;
    if (!clientId && request.entityType === 'CLIENT') clientId = request.entityId ?? null;
    if (!clientId && contact) clientId = contact.clientId;

    const userId = requestContext.userId ?? null;
    const tenantId = requestContext.tenantId ?? null;

    const [client, sender, tenant] = await Promise.all([
      clientId
        ? this.prisma.client.client.findFirst({
            where: { id: clientId, deletedAt: null },
            select: { name: true, industry: true },
          })
        : Promise.resolve(null),
      userId
        ? this.prisma.client.user.findFirst({
            where: { id: userId, deletedAt: null },
            select: { firstName: true, lastName: true, email: true },
          })
        : Promise.resolve(null),
      tenantId
        ? this.prisma.client.tenant.findFirst({ where: { id: tenantId }, select: { name: true } })
        : Promise.resolve(null),
    ]);

    const context: MergeContext = {};

    if (candidate) {
      put(context, 'candidate.firstName', candidate.firstName);
      put(context, 'candidate.lastName', candidate.lastName);
      put(context, 'candidate.fullName', composeName(candidate.firstName, candidate.lastName));
      put(context, 'candidate.email', candidate.email);
      put(context, 'candidate.phone', candidate.phone);
      put(context, 'candidate.headline', candidate.headline);
      put(context, 'candidate.currentTitle', candidate.currentTitle);
      put(context, 'candidate.locationCity', candidate.locationCity);
    }

    if (job) {
      put(context, 'job.title', job.title);
      put(context, 'job.referenceCode', job.referenceCode);
      put(context, 'job.locationCity', job.locationCity);
    }

    if (client) {
      put(context, 'client.name', client.name);
      put(context, 'client.industry', client.industry);
    }

    if (contact) {
      put(context, 'contact.firstName', contact.firstName);
      put(context, 'contact.lastName', contact.lastName);
      put(context, 'contact.fullName', composeName(contact.firstName, contact.lastName));
      put(context, 'contact.email', contact.email);
    }

    if (interview) {
      put(context, 'interview.scheduledStart', formatDateTime(interview.scheduledStart));
      put(context, 'interview.meetingUrl', interview.meetingUrl);
    }

    if (sender) {
      put(context, 'sender.fullName', composeName(sender.firstName, sender.lastName));
      put(context, 'sender.email', sender.email);
    }

    if (tenant) put(context, 'tenant.name', tenant.name);
    context.today = formatDate(new Date());

    // Client overrides win — `mergeData` carries the `interview.*` values the
    // server cannot infer, and lets the compose dialog tweak anything else.
    if (request.mergeData) {
      for (const [key, value] of Object.entries(request.mergeData)) context[key] = value;
    }

    return context;
  }

  /** Mirrors the timeline entry an outbound email leaves on its record. */
  private async createTimelineEntry(
    tenantId: string,
    input: SendEmailRequest,
    emailMessageId: string,
    subject: string,
    body: string,
    userId: string | null,
  ): Promise<void> {
    const link = resolveEntityLink(input);
    if (!link) {
      // `Activity.entityType`/`entityId` are required; a message with no linked
      // record simply has no timeline to appear on.
      this.logger.debug(`Email ${emailMessageId} has no linked entity; skipping timeline entry`);
      return;
    }

    const data: Prisma.ActivityUncheckedCreateInput = {
      tenantId,
      type: 'EMAIL',
      direction: 'OUTBOUND',
      subject,
      body,
      occurredAt: new Date(),
      emailMessageId,
      entityType: link.entityType,
      entityId: link.entityId,
      candidateId: input.candidateId ?? (link.entityType === 'CANDIDATE' ? link.entityId : null),
      jobId: input.jobId ?? (link.entityType === 'JOB' ? link.entityId : null),
      createdById: userId,
      updatedById: userId,
    };

    await this.prisma.client.activity.create({ data });
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

function buildTemplateWhere(query: EmailTemplateQuery): Prisma.EmailTemplateWhereInput {
  const and: Prisma.EmailTemplateWhereInput[] = [];

  if (query.category) and.push({ category: query.category });
  if (query.isActive !== undefined) and.push({ isActive: query.isActive });
  if (query.q) {
    const like = { contains: query.q, mode: 'insensitive' as const };
    and.push({ OR: [{ name: like }, { key: like }] });
  }

  return and.length > 0 ? { deletedAt: null, AND: and } : { deletedAt: null };
}

function buildTemplateOrderBy(query: EmailTemplateQuery): Prisma.EmailTemplateOrderByWithRelationInput[] {
  const dir = query.sortDir;
  switch (query.sortBy) {
    case 'createdAt':
      return [{ createdAt: dir }];
    case 'updatedAt':
      return [{ updatedAt: dir }];
    default:
      return [{ name: dir }];
  }
}

function buildMessageWhere(query: EmailMessageQuery): Prisma.EmailMessageWhereInput {
  const and: Prisma.EmailMessageWhereInput[] = [];

  const statuses = toArray(query.status);
  if (statuses.length > 0) and.push({ status: { in: statuses } });
  if (query.entityType) and.push({ entityType: query.entityType });
  if (query.entityId) and.push({ entityId: query.entityId });
  if (query.candidateId) and.push({ candidateId: query.candidateId });
  if (query.templateId) and.push({ templateId: query.templateId });

  return and.length > 0 ? { deletedAt: null, AND: and } : { deletedAt: null };
}

function buildMessageOrderBy(query: EmailMessageQuery): Prisma.EmailMessageOrderByWithRelationInput[] {
  const dir = query.sortDir;
  return query.sortBy === 'sentAt' ? [{ sentAt: dir }] : [{ createdAt: dir }];
}

function toEmailTemplateItem(row: EmailTemplateRow): EmailTemplateItem {
  return {
    id: row.id,
    name: row.name,
    key: row.key,
    subject: row.subject,
    body: row.body,
    htmlBody: row.htmlBody,
    category: parseCategory.parse(row.category),
    mergeFields: row.mergeFields,
    isSystem: row.isSystem,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toEmailMessageItem(row: EmailMessageRow, users: Map<string, UserBrief>): EmailMessageItem {
  const author = row.createdById ? users.get(row.createdById) ?? null : null;
  return {
    id: row.id,
    direction: row.direction,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    toAddresses: row.toAddresses,
    ccAddresses: row.ccAddresses,
    bccAddresses: row.bccAddresses,
    replyTo: row.replyTo,
    subject: row.subject,
    bodyText: row.bodyText,
    bodyHtml: row.bodyHtml,
    status: row.status,
    error: row.error,
    messageId: row.messageId,
    template: row.template
      ? { id: row.template.id, name: row.template.name, key: row.template.key }
      : null,
    entityType: row.entityType,
    entityId: row.entityId,
    candidateId: row.candidateId,
    jobId: row.jobId,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    createdBy: author ? { id: author.id, fullName: author.fullName, avatarUrl: author.avatarUrl } : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A create derives its merge fields from the copy when none were supplied;
 * when supplied, every key must be one the renderer knows how to resolve.
 */
function resolveMergeFields(
  supplied: string[] | undefined,
  subject: string,
  body: string,
  htmlBody: string | null,
): string[] {
  if (supplied && supplied.length > 0) return assertMergeFields(supplied);
  return extractMergeFields(subject, body, htmlBody ?? '');
}

function assertMergeFields(keys: string[]): string[] {
  const invalid = keys.filter((key) => !isMergeField(key));
  if (invalid.length > 0) {
    throw new ValidationError('That merge field is not available.', { mergeFields: invalid });
  }
  return keys;
}

function resolveEntityLink(input: SendEmailRequest): { entityType: EntityType; entityId: string } | null {
  if (input.entityType && input.entityId) return { entityType: input.entityType, entityId: input.entityId };
  if (input.candidateId) return { entityType: 'CANDIDATE', entityId: input.candidateId };
  if (input.jobId) return { entityType: 'JOB', entityId: input.jobId };
  return null;
}

/** Records a resolved, non-empty value; blanks stay "unresolved" for the preview. */
function put(context: MergeContext, key: string, value: string | null | undefined): void {
  if (value !== null && value !== undefined && value !== '') context[key] = value;
}

function requireTenant(): string {
  const tenantId = requestContext.tenantId;
  if (!tenantId) throw new ForbiddenError('This action must run inside a workspace.');
  return tenantId;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function composeName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `DD MMM YYYY`, e.g. `02 Nov 2026`. */
function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTHS[date.getMonth()] ?? '';
  return `${day} ${month} ${date.getFullYear()}`;
}

/** `DD MMM YYYY HH:mm`. */
function formatDateTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${formatDate(date)} ${hours}:${minutes}`;
}
