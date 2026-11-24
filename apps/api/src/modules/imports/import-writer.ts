import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ZodTypeAny } from 'zod';

import {
  candidateSourceSchema,
  createCandidateSchema,
  createJobSchema,
  type CreateCandidateRequest,
  type CreateJobRequest,
  type DuplicateStrategy,
  type ImportEntityType,
} from '@talentflow/types';

import {
  NotFoundError,
  TenantRequiredError,
  ValidationError,
} from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import { PrismaService } from '@/infra/prisma/prisma.service';
import {
  buildDedupeKey,
  normalizeEmail,
  normalizeLinkedin,
  normalizePhone,
} from '@/modules/candidates/candidate-search';
import { CandidatesService } from '@/modules/candidates/candidates.service';
import { JobsService } from '@/modules/jobs/jobs.service';
import { normalizeResumeSkills } from '@/modules/resumes/skill-dictionary';

/**
 * Persistence engine for the CSV/Excel importer (Module 7).
 *
 * A row is written through the *same* services the interactive API uses
 * (`CandidatesService.create`, `JobsService.create`) so an imported record is
 * indistinguishable from a hand-created one — same validation, same side
 * effects (activity log, pipeline copy, tenant job numbering). Entities with no
 * service of their own (clients, contacts) are written directly through the
 * tenant-scoped Prisma client.
 */

/** A record already in the workspace that the incoming row resembles. */
export interface DuplicateHit {
  id: string;
  label: string;
}

/** Outcome of writing a single row. */
export interface ImportWriteResult {
  outcome: 'created' | 'updated' | 'skipped' | 'failed';
  id?: string;
  message?: string;
}

/** The subset of the wizard options that affects persistence. */
export interface ImportWriteOptions {
  duplicateStrategy: DuplicateStrategy;
  ownerId?: string | null;
  defaultSource?: string | null;
  tag?: string | null;
}

/** Candidate fields an update may write, mapped from their import field key. */
const CANDIDATE_UPDATE_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'currentTitle',
  'currentCompany',
  'locationCity',
  'locationState',
  'locationCountry',
  'linkedinUrl',
  'totalExperienceMonths',
  'expectedSalaryCents',
  'availabilityDate',
] as const;

/** Client fields an update may write. */
const CLIENT_FIELDS = ['name', 'legalName', 'industry', 'website', 'phone', 'city', 'country'] as const;

/** Contact fields an update may write. */
const CONTACT_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'title'] as const;

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Case/space/underscore-insensitive match against an enum's allowed values. */
function matchOption(value: string | null | undefined, options: readonly string[]): string | undefined {
  if (!value) return undefined;
  const token = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  return options.find((option) => option.toLowerCase().replace(/[^a-z0-9]/g, '') === token);
}

function requireTenant(): string {
  const tenantId = requestContext.tenantId;
  if (!tenantId) throw new TenantRequiredError();
  return tenantId;
}

function candidateLabel(row: { firstName: string; lastName: string; email: string | null }): string {
  const name = `${row.firstName} ${row.lastName}`.trim();
  return name || row.email || 'Existing candidate';
}

@Injectable()
export class ImportWriter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidates: CandidatesService,
    private readonly jobs: JobsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Duplicate detection
  // ---------------------------------------------------------------------------

  /**
   * Finds an existing record the row would collide with.
   *
   * The key is the entity's own identity: a candidate matches on email, then
   * phone, then LinkedIn; clients and contacts match on their name/email. Jobs
   * never match — a requisition's identity is its server-generated reference
   * code, so a job row is always a create.
   */
  async findDuplicate(
    entity: ImportEntityType,
    mapped: Record<string, unknown>,
    tenantId: string,
  ): Promise<DuplicateHit | null> {
    switch (entity) {
      case 'CANDIDATE':
        return this.findCandidateDuplicate(mapped, tenantId);
      case 'CLIENT':
        return this.findClientDuplicate(mapped, tenantId);
      case 'CONTACT':
        return this.findContactDuplicate(mapped, tenantId);
      default:
        return null;
    }
  }

  private async findCandidateDuplicate(
    mapped: Record<string, unknown>,
    tenantId: string,
  ): Promise<DuplicateHit | null> {
    const email = normalizeEmail(asString(mapped.email));
    const phone = normalizePhone(asString(mapped.phone));
    const linkedin = normalizeLinkedin(asString(mapped.linkedinUrl));

    const probes: Prisma.CandidateWhereInput[] = [];
    if (email) probes.push({ emailNormalized: email });
    if (phone) probes.push({ phoneNormalized: phone });
    if (linkedin) probes.push({ linkedinNormalized: linkedin });
    if (probes.length === 0) return null;

    for (const probe of probes) {
      const hit = await this.prisma.client.candidate.findFirst({
        where: { tenantId, deletedAt: null, ...probe },
        select: { id: true, firstName: true, lastName: true, email: true },
      });
      if (hit) return { id: hit.id, label: candidateLabel(hit) };
    }
    return null;
  }

  private async findClientDuplicate(
    mapped: Record<string, unknown>,
    tenantId: string,
  ): Promise<DuplicateHit | null> {
    const name = asString(mapped.name);
    if (!name) return null;

    const hit = await this.prisma.client.client.findFirst({
      where: { tenantId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    return hit ? { id: hit.id, label: hit.name } : null;
  }

  private async findContactDuplicate(
    mapped: Record<string, unknown>,
    tenantId: string,
  ): Promise<DuplicateHit | null> {
    const email = normalizeEmail(asString(mapped.email));
    if (!email) return null;

    const hit = await this.prisma.client.clientContact.findFirst({
      where: { tenantId, deletedAt: null, email: { equals: email, mode: 'insensitive' } },
      select: { id: true, firstName: true, lastName: true },
    });
    return hit ? { id: hit.id, label: `${hit.firstName} ${hit.lastName}`.trim() } : null;
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  /**
   * Writes one row, honouring the duplicate strategy.
   *
   * `SKIP` drops a row that matches an existing record; `UPDATE` overwrites its
   * mapped fields; `CREATE` always inserts. A row that fails validation throws a
   * domain error — the caller turns that into a per-row failure so one bad row
   * never aborts the run.
   */
  async writeRow(
    entity: ImportEntityType,
    mapped: Record<string, unknown>,
    options: ImportWriteOptions,
    actorId: string | null,
  ): Promise<ImportWriteResult> {
    const tenantId = requireTenant();
    const duplicate = await this.findDuplicate(entity, mapped, tenantId);

    if (duplicate && options.duplicateStrategy === 'SKIP') {
      return { outcome: 'skipped', id: duplicate.id };
    }
    if (duplicate && options.duplicateStrategy === 'UPDATE') {
      const id = await this.updateExisting(entity, duplicate.id, mapped, options, actorId);
      return { outcome: 'updated', id };
    }

    const id = await this.createNew(entity, mapped, options, actorId);
    return { outcome: 'created', id };
  }

  private async createNew(
    entity: ImportEntityType,
    mapped: Record<string, unknown>,
    options: ImportWriteOptions,
    actorId: string | null,
  ): Promise<string> {
    switch (entity) {
      case 'CANDIDATE':
        return this.createCandidate(mapped, options);
      case 'JOB':
        return this.createJob(mapped, options);
      case 'CLIENT':
        return this.createClient(mapped, options, actorId);
      default:
        return this.createContact(mapped, actorId);
    }
  }

  private async updateExisting(
    entity: ImportEntityType,
    id: string,
    mapped: Record<string, unknown>,
    options: ImportWriteOptions,
    actorId: string | null,
  ): Promise<string> {
    switch (entity) {
      case 'CANDIDATE':
        await this.updateCandidate(id, mapped, actorId);
        return id;
      case 'CLIENT':
        await this.updateClient(id, mapped, actorId);
        return id;
      case 'CONTACT':
        await this.updateContact(id, mapped, actorId);
        return id;
      default:
        // Jobs have no duplicate key, so reaching here means the strategy was
        // `UPDATE` but nothing matched; the caller falls back to an insert.
        return this.createJob(mapped, options);
    }
  }

  // -- Candidates -------------------------------------------------------------

  private async createCandidate(
    mapped: Record<string, unknown>,
    options: ImportWriteOptions,
  ): Promise<string> {
    const tags = [...toStringArray(mapped.tags)];
    if (options.tag) tags.push(options.tag);

    const skillIds = await this.resolveSkillIds(toStringArray(mapped.skills));
    const source =
      asString(mapped.source) ?? matchOption(options.defaultSource, candidateSourceSchema.options) ?? 'IMPORT';

    const input = parseDto<CreateCandidateRequest>(createCandidateSchema, {
      firstName: mapped.firstName,
      lastName: mapped.lastName,
      email: asString(mapped.email),
      phone: asString(mapped.phone),
      currentTitle: asString(mapped.currentTitle),
      currentCompany: asString(mapped.currentCompany),
      locationCity: asString(mapped.locationCity),
      locationState: asString(mapped.locationState),
      locationCountry: asString(mapped.locationCountry),
      linkedinUrl: asString(mapped.linkedinUrl),
      totalExperienceMonths: mapped.totalExperienceMonths ?? null,
      expectedSalaryCents: mapped.expectedSalaryCents ?? null,
      availabilityDate: asString(mapped.availabilityDate),
      source,
      tags,
      skills: skillIds.map((skillId) => ({ skillId })),
      ownerId: options.ownerId ?? undefined,
      // The duplicate decision was made above; the create must not second-guess it.
      allowDuplicate: true,
    });

    const candidate = await this.candidates.create(input);
    return candidate.id;
  }

  private async updateCandidate(
    id: string,
    mapped: Record<string, unknown>,
    actorId: string | null,
  ): Promise<void> {
    const existing = await this.prisma.client.candidate.findFirst({
      where: { id, deletedAt: null },
      select: { email: true, phone: true, linkedinUrl: true },
    });
    if (!existing) throw new NotFoundError('Candidate', id);

    const data: Record<string, unknown> = { updatedById: actorId };

    for (const field of CANDIDATE_UPDATE_FIELDS) {
      if (!(field in mapped)) continue;
      if (field === 'availabilityDate') {
        const iso = asString(mapped[field]);
        data.availabilityDate = iso ? new Date(iso) : null;
      } else if (field === 'totalExperienceMonths' || field === 'expectedSalaryCents') {
        data[field] = (mapped[field] as number | null) ?? null;
      } else {
        data[field] = asString(mapped[field]);
      }
    }
    if (Array.isArray(mapped.tags)) data.tags = toStringArray(mapped.tags);
    if ('source' in mapped) data.source = asString(mapped.source);

    const email = asString(mapped.email) ?? existing.email;
    const phone = asString(mapped.phone) ?? existing.phone;
    const linkedinUrl = asString(mapped.linkedinUrl) ?? existing.linkedinUrl;
    data.emailNormalized = normalizeEmail(email);
    data.phoneNormalized = normalizePhone(phone);
    data.linkedinNormalized = normalizeLinkedin(linkedinUrl);
    data.dedupeKey = buildDedupeKey({ email, phone, linkedinUrl });

    await this.prisma.client.candidate.update({
      where: { id },
      data: data as unknown as Prisma.CandidateUncheckedUpdateInput,
    });
  }

  // -- Jobs -------------------------------------------------------------------

  private async createJob(mapped: Record<string, unknown>, options: ImportWriteOptions): Promise<string> {
    const clientName = asString(mapped.clientName);
    const clientId = clientName ? await this.resolveClientId(clientName) : null;

    const input = parseDto<CreateJobRequest>(createJobSchema, {
      title: mapped.title,
      clientId: clientId ?? undefined,
      description: asString(mapped.description),
      locationCity: asString(mapped.locationCity),
      status: asString(mapped.status) ?? undefined,
      openings: mapped.openings ?? undefined,
      targetFillAt: asString(mapped.targetFillAt),
      ownerId: options.ownerId ?? undefined,
    });

    // The `JOB-#####` reference comes from the tenant sequence inside the jobs
    // service, so an import can never collide with a hand-created requisition.
    const job = await this.jobs.create(input);
    return job.id;
  }

  // -- Clients ----------------------------------------------------------------

  private async createClient(
    mapped: Record<string, unknown>,
    options: ImportWriteOptions,
    actorId: string | null,
  ): Promise<string> {
    const client = await this.prisma.client.client.create({
      data: {
        tenantId: requireTenant(),
        name: requireString(mapped.name, 'Company name'),
        legalName: asString(mapped.legalName),
        industry: asString(mapped.industry),
        website: asString(mapped.website),
        phone: asString(mapped.phone),
        city: asString(mapped.city),
        country: asString(mapped.country),
        ownerId: options.ownerId ?? actorId,
        createdById: actorId,
        updatedById: actorId,
      },
      select: { id: true },
    });
    return client.id;
  }

  private async updateClient(
    id: string,
    mapped: Record<string, unknown>,
    actorId: string | null,
  ): Promise<void> {
    const data: Record<string, unknown> = { updatedById: actorId };
    for (const field of CLIENT_FIELDS) {
      if (field in mapped) data[field] = asString(mapped[field]);
    }
    await this.prisma.client.client.update({
      where: { id },
      data: data as unknown as Prisma.ClientUncheckedUpdateInput,
    });
  }

  // -- Contacts ---------------------------------------------------------------

  private async createContact(
    mapped: Record<string, unknown>,
    actorId: string | null,
  ): Promise<string> {
    const clientId = await this.resolveContactClientId(mapped);

    const contact = await this.prisma.client.clientContact.create({
      data: {
        tenantId: requireTenant(),
        clientId,
        firstName: requireString(mapped.firstName, 'First name'),
        lastName: requireString(mapped.lastName, 'Last name'),
        email: asString(mapped.email),
        phone: asString(mapped.phone),
        title: asString(mapped.title),
        createdById: actorId,
        updatedById: actorId,
      },
      select: { id: true },
    });
    return contact.id;
  }

  private async updateContact(
    id: string,
    mapped: Record<string, unknown>,
    actorId: string | null,
  ): Promise<void> {
    const data: Record<string, unknown> = { updatedById: actorId };
    for (const field of CONTACT_FIELDS) {
      if (field in mapped) data[field] = asString(mapped[field]);
    }
    if (asString(mapped.clientName)) data.clientId = await this.resolveContactClientId(mapped);
    await this.prisma.client.clientContact.update({
      where: { id },
      data: data as unknown as Prisma.ClientContactUncheckedUpdateInput,
    });
  }

  /** A contact must belong to a client; an unresolvable company fails the row. */
  private async resolveContactClientId(mapped: Record<string, unknown>): Promise<string> {
    const clientName = asString(mapped.clientName);
    if (!clientName) {
      throw new ValidationError('Client company is required to import contacts. Import clients first.');
    }
    return this.resolveClientId(clientName);
  }

  private async resolveClientId(clientName: string): Promise<string> {
    const client = await this.prisma.client.client.findFirst({
      where: { tenantId: requireTenant(), deletedAt: null, name: { equals: clientName, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!client) throw new ValidationError(`Unknown client "${clientName}". Import clients first.`);
    return client.id;
  }

  // -- Skills -----------------------------------------------------------------

  /**
   * Resolves free-text skill names to tenant `Skill` ids, creating any that do
   * not exist yet. Mirrors the resume parser's resolution so an imported
   * candidate and a parsed one share the same skill vocabulary.
   */
  private async resolveSkillIds(names: string[]): Promise<string[]> {
    if (names.length === 0) return [];
    const tenantId = requireTenant();
    const normalized = normalizeResumeSkills(names.map((name) => ({ name, years: null, level: null })));

    const ids: string[] = [];
    for (const skill of normalized) {
      const name = (skill.matchedName || skill.name).trim();
      if (!name) continue;

      const existing = await this.prisma.client.skill.findFirst({
        where: { tenantId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existing) {
        ids.push(existing.id);
        continue;
      }

      const created = await this.prisma.client.skill.upsert({
        where: { tenantId_name: { tenantId, name } },
        update: {},
        create: { tenantId, name, aliases: [], category: skill.category ?? null, isSystem: false },
        select: { id: true },
      });
      ids.push(created.id);
    }

    return [...new Set(ids)];
  }
}

/** Throws a `ValidationError` when a required coerced value is missing. */
function requireString(value: unknown, label: string): string {
  const text = asString(value);
  if (!text) throw new ValidationError(`${label} is required.`);
  return text;
}

/**
 * Runs a DTO schema and converts a Zod failure into a user-safe
 * `ValidationError`, so a row-level problem reads as a field message rather
 * than an opaque 500.
 */
function parseDto<T>(schema: ZodTypeAny, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data as T;

  const issue = result.error.issues[0];
  const message = issue
    ? `${issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''}${issue.message}`
    : 'That row is not valid.';
  throw new ValidationError(message);
}
