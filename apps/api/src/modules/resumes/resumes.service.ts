import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type CandidateResume } from '@prisma/client';
import type { Queue } from 'bullmq';

import {
  buildPaginationMeta,
  RESUME_MAX_BYTES,
  resumeParsedDataSchema,
  resumeParserChoiceSchema,
  toSkipTake,
  type AcceptResumeApplied,
  type AcceptResumeRequest,
  type AcceptResumeResponse,
  type CompleteResumeUploadRequest,
  type ExperienceLevel,
  type NormalizedResumeSkill,
  type Paginated,
  type ReparseResumeRequest,
  type ResumeAcceptOverrides,
  type ResumeAcceptSections,
  type ResumeDetail,
  type ResumeParsedData,
  type ResumeQuery,
  type ResumeSummary,
  type ResumeUploadRequest,
  type ResumeUploadTicket,
  type UpdateResumeRequest,
} from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/common/errors/domain-errors';
import { createRequestContext, requestContext } from '@/common/request-context';
import type { AppConfig } from '@/config/configuration';
import { PrismaService } from '@/infra/prisma/prisma.service';
import type { TenantScopedClient } from '@/infra/prisma/tenancy.extension';
import { QUEUE_NAMES, type ResumeParseJob } from '@/infra/queue/queue.constants';
import { StorageService } from '@/infra/storage/storage.service';
import {
  buildDedupeKey,
  normalizeEmail,
  normalizeLinkedin,
  normalizePhone,
} from '@/modules/candidates/candidate-search';
import { CandidatesService } from '@/modules/candidates/candidates.service';

import {
  detectResumeKindFromBytes,
  extractResumeText,
  resolveResumeKind,
  RESUME_SIGNATURE_BYTES,
  type ResumeKind,
} from './resume-text-extractor';
import { selectResumeParser, type AiConfig } from './resume-parser';
import { normalizeResumeSkills } from './skill-dictionary';

/**
 * The extended client's transaction type. `$transaction` hands back the
 * extended client minus its connection/transaction escape hatches, which is not
 * assignable to `Prisma.TransactionClient`.
 */
type TenantTransactionClient = Omit<
  TenantScopedClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Storage prefix for resume objects; the key is `resumes/{tenantId}/{uuid}-{name}`. */
const RESUME_STORAGE_PREFIX = 'resumes';
/** Audit entity written for resume lifecycle events. */
const RESUME_ENTITY = 'Resume';

interface UploaderInfo {
  id: string;
  fullName: string;
}

/** A parsed skill resolved to a tenant `Skill` row. */
interface ResolvedSkill {
  skillId: string;
  name: string;
  years: number | null;
  level: number | null;
}

interface ResolvedProfile {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  headline: string | null;
  summary: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  locationCity: string | null;
  locationState: string | null;
  locationCountry: string | null;
  totalExperienceMonths: number | null;
  experienceLevel: ExperienceLevel | null;
  ownerId: string | null;
  tags: string[];
}

/**
 * Resumes — upload, parse and review (Phase 2, Module 5).
 *
 * The lifecycle is split in three:
 *
 *  1. **Upload** hands the browser a presigned `PUT` so bytes never traverse the
 *     API. A `PENDING` row is created up-front with a null candidate, which is
 *     what lets an upload sit detached until a reviewer decides what to do with it.
 *  2. **Parse** runs off the request path on the `resume-parse` queue: the object
 *     is downloaded, text extracted, and a `ResumeParser` (LLM when configured,
 *     deterministic regex otherwise) produces structured data that is normalised
 *     against the skill dictionary.
 *  3. **Accept** folds a reviewed parse into a candidate — creating one when the
 *     upload is detached — and is idempotent: applying the same resume twice
 *     never duplicates a candidate or its child records.
 *
 * Resume text and contact details are PII: nothing here logs them, only ids.
 */
@Injectable()
export class ResumesService {
  private readonly logger = new Logger(ResumesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly candidates: CandidatesService,
    private readonly config: ConfigService<AppConfig, true>,
    @InjectQueue(QUEUE_NAMES.resumeParse) private readonly parseQueue: Queue<ResumeParseJob>,
  ) {}

  // ---------------------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------------------

  /**
   * Reserves a resume id and returns the presigned `PUT` the browser uses to
   * drop the file straight into object storage. The declared content type is
   * baked into the signature, so an object cannot be re-typed after upload.
   */
  async createUploadTicket(input: ResumeUploadRequest): Promise<ResumeUploadTicket> {
    const tenantId = requireTenant();
    const userId = requireUser();
    const ttl = this.config.get('storage', { infer: true }).signedUrlTtl;

    const storageKey = this.storage.buildKey(RESUME_STORAGE_PREFIX, tenantId, input.fileName);
    // Build the URL first: a storage outage must not leave an orphan row behind.
    const uploadUrl = await this.storage.getSignedPutUrl(storageKey, input.mimeType, ttl);

    const resume = await this.prisma.client.candidateResume.create({
      data: {
        tenantId,
        candidateId: null,
        fileName: input.fileName,
        storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        parseStatus: 'PENDING',
        uploadedById: userId,
      },
      select: { id: true },
    });

    await this.audit.record({
      action: 'CREATE',
      entity: RESUME_ENTITY,
      entityId: resume.id,
      description: 'Created a resume upload',
    });

    return {
      resumeId: resume.id,
      storageKey,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType },
      expiresInSeconds: ttl,
    };
  }

  /**
   * Called once the browser's `PUT` succeeds. Verifies what actually landed in
   * storage, optionally attaches the upload to an existing candidate, then
   * queues the parse job.
   *
   * The client uploaded straight to storage, so nothing here is trustworthy
   * until it is re-read from the object: the declared MIME type is checked
   * against the file's magic bytes and the stored size against the 10 MB cap.
   */
  async completeUpload(
    resumeId: string,
    input: CompleteResumeUploadRequest,
  ): Promise<ResumeDetail> {
    const tenantId = requireTenant();
    const resume = await this.findResumeOrFail(resumeId);

    const head = await this.storage.describeObject(resume.storageKey);
    if (head.size === 0) {
      throw new ValidationError('The upload did not reach storage. Please try again.');
    }
    if (head.size > RESUME_MAX_BYTES) {
      await this.storage.remove(resume.storageKey).catch(() => undefined);
      throw new ValidationError('Resume files must be 10 MB or smaller.');
    }

    const declared = resolveResumeKind(resume.mimeType, resume.fileName);
    const detected = detectResumeKindFromBytes(
      await this.storage.readPrefix(resume.storageKey, RESUME_SIGNATURE_BYTES),
    );
    if (!isKindCompatible(declared, detected)) {
      await this.storage.remove(resume.storageKey).catch(() => undefined);
      throw new ValidationError(
        `That file does not look like a ${declared.toUpperCase()} document. Upload a PDF, DOCX, DOC, TXT or RTF resume.`,
      );
    }

    let candidateId = resume.candidateId;
    if (input.candidateId) {
      const candidate = await this.prisma.client.candidate.findFirst({
        where: { id: input.candidateId, deletedAt: null },
        select: { id: true },
      });
      if (!candidate) {
        throw new ValidationError('That candidate does not exist in this workspace.');
      }
      candidateId = candidate.id;
    }

    await this.prisma.client.candidateResume.update({
      where: { id: resumeId },
      data: {
        candidateId,
        sizeBytes: head.size,
        mimeType: head.contentType ?? resume.mimeType,
        parseStatus: 'PENDING',
        parseError: null,
      },
    });

    await this.enqueueParse({
      tenantId,
      resumeId,
      candidateId,
      storageKey: resume.storageKey,
      parser: 'auto',
    });

    await this.audit.record({
      action: 'UPDATE',
      entity: RESUME_ENTITY,
      entityId: resumeId,
      description: 'Completed a resume upload',
    });

    return this.detail(resumeId);
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async list(query: ResumeQuery): Promise<Paginated<ResumeSummary>> {
    const where: Prisma.CandidateResumeWhereInput = { deletedAt: null };
    if (query.candidateId) where.candidateId = query.candidateId;
    else if (query.unattached) where.candidateId = null;

    if (query.status) {
      where.parseStatus = Array.isArray(query.status)
        ? { in: query.status }
        : query.status;
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.candidateResume.findMany({
        where,
        orderBy: buildResumeOrderBy(query),
        ...toSkipTake(query),
      }),
      this.prisma.client.candidateResume.count({ where }),
    ]);

    const uploaders = await this.loadUploaders(rows.map((row) => row.uploadedById));

    return {
      items: rows.map((row) => toSummary(row, uploaders.get(row.uploadedById ?? '') ?? null)),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async detail(resumeId: string): Promise<ResumeDetail> {
    const resume = await this.findResumeOrFail(resumeId);
    const uploader = (await this.loadUploaders([resume.uploadedById])).get(
      resume.uploadedById ?? '',
    ) ?? null;

    let downloadUrl: string | null = null;
    try {
      downloadUrl = await this.storage.getSignedUrl(resume.storageKey);
    } catch {
      // A dead storage backend must not hide the parsed data the reviewer needs.
      this.logger.warn(`Could not sign a download URL for resume ${resumeId}`);
    }

    return toDetail(resume, uploader, downloadUrl);
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  async update(resumeId: string, input: UpdateResumeRequest): Promise<ResumeDetail> {
    const resume = await this.findResumeOrFail(resumeId);
    const data: Prisma.CandidateResumeUncheckedUpdateInput = {};

    if (input.fileName !== undefined) data.fileName = input.fileName;

    if (input.isPrimary !== undefined) {
      if (input.isPrimary && !resume.candidateId) {
        throw new ValidationError(
          'Attach the resume to a candidate before making it the primary one.',
        );
      }
      data.isPrimary = input.isPrimary;
    }

    await this.prisma.client.candidateResume.update({ where: { id: resumeId }, data });

    if (input.isPrimary && resume.candidateId) {
      await this.demoteOtherPrimaries(resume.candidateId, resumeId);
    }

    await this.audit.record({
      action: 'UPDATE',
      entity: RESUME_ENTITY,
      entityId: resumeId,
      description: 'Updated a resume',
    });

    return this.detail(resumeId);
  }

  async remove(resumeId: string): Promise<{ deleted: true }> {
    const resume = await this.findResumeOrFail(resumeId);

    await this.prisma.client.candidateResume.update({
      where: { id: resumeId },
      data: { deletedAt: new Date(), isPrimary: false },
    });

    try {
      await this.storage.remove(resume.storageKey);
    } catch {
      this.logger.warn(`Could not delete the stored object for resume ${resumeId}`);
    }

    await this.audit.record({
      action: 'DELETE',
      entity: RESUME_ENTITY,
      entityId: resumeId,
      description: 'Deleted a resume',
    });

    return { deleted: true };
  }

  async reparse(resumeId: string, input: ReparseResumeRequest): Promise<ResumeDetail> {
    const tenantId = requireTenant();
    const resume = await this.findResumeOrFail(resumeId);

    await this.prisma.client.candidateResume.update({
      where: { id: resumeId },
      data: { parseStatus: 'PENDING', parseError: null },
    });

    await this.enqueueParse({
      tenantId,
      resumeId,
      candidateId: resume.candidateId,
      storageKey: resume.storageKey,
      parser: input.parser,
    });

    await this.audit.record({
      action: 'UPDATE',
      entity: RESUME_ENTITY,
      entityId: resumeId,
      description: 'Re-parsed a resume',
    });

    return this.detail(resumeId);
  }

  // ---------------------------------------------------------------------------
  // Accept (review & fold into a candidate)
  // ---------------------------------------------------------------------------

  /**
   * Folds a reviewed parse into a candidate.
   *
   * The target candidate is the one already linked to the resume, else the one
   * named in the request, else a new one. Because a resume remembers its
   * candidate, a second accept reuses the same profile and the child collections
   * are de-duplicated — accepting twice is a no-op rather than a duplicate.
   */
  async accept(resumeId: string, input: AcceptResumeRequest): Promise<AcceptResumeResponse> {
    const tenantId = requireTenant();
    const userId = requireUser();
    const resume = await this.findResumeOrFail(resumeId);
    const parsed = this.readParsedData(resume);
    if (!parsed) {
      throw new ValidationError('This resume has not been parsed yet.');
    }

    const applied: AcceptResumeApplied = {
      profile: false,
      skills: 0,
      experiences: 0,
      educations: 0,
      certifications: 0,
      languages: 0,
    };

    let candidateId = resume.candidateId;
    let created = false;

    if (candidateId) {
      await this.applyToExistingCandidate(tenantId, candidateId, parsed, input, applied);
    } else if (input.candidateId) {
      const target = await this.prisma.client.candidate.findFirst({
        where: { id: input.candidateId, deletedAt: null },
        select: { id: true },
      });
      if (!target) throw new NotFoundError('Candidate', input.candidateId);
      candidateId = target.id;
      await this.applyToExistingCandidate(tenantId, candidateId, parsed, input, applied);
    } else {
      candidateId = await this.createCandidateFromResume(tenantId, userId, parsed, input, applied);
      created = true;
    }

    await this.prisma.client.candidateResume.update({
      where: { id: resumeId },
      data: { candidateId },
    });

    if (input.makePrimary) {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.candidateResume.updateMany({
          where: { candidateId, id: { not: resumeId }, deletedAt: null },
          data: { isPrimary: false },
        });
        await tx.candidateResume.update({ where: { id: resumeId }, data: { isPrimary: true } });
      });
    }

    await this.logActivity(tenantId, candidateId, created ? 'Candidate created from resume' : 'Resume accepted onto candidate');
    await this.audit.record({
      action: created ? 'CREATE' : 'UPDATE',
      entity: 'Candidate',
      entityId: candidateId,
      description: 'Accepted a parsed resume',
    });

    const candidate = await this.candidates.detail(candidateId);
    return { resumeId, candidateId, created, applied, candidate };
  }

  // ---------------------------------------------------------------------------
  // Worker entry point
  // ---------------------------------------------------------------------------

  /**
   * Runs the parse for a queued job. The worker has no HTTP request, so the
   * whole body is wrapped in a tenant request context — without it the
   * tenant-scoped Prisma client refuses every query.
   */
  async runParseJob(job: ResumeParseJob): Promise<void> {
    await requestContext.run(
      createRequestContext({ tenantId: job.tenantId, bypassTenant: false }),
      async () => {
        await this.performParse(job);
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async performParse(job: ResumeParseJob): Promise<void> {
    const startedAt = Date.now();
    const resume = await this.prisma.client.candidateResume.findFirst({
      where: { id: job.resumeId, deletedAt: null },
    });
    if (!resume) {
      this.logger.warn(`Resume ${job.resumeId} no longer exists; skipping parse`);
      return;
    }

    await this.prisma.client.candidateResume.update({
      where: { id: job.resumeId },
      data: { parseStatus: 'PROCESSING', parseError: null },
    });

    try {
      const buffer = await this.storage.download(resume.storageKey);
      const extracted = await extractResumeText(buffer, resume.mimeType, resume.fileName);

      if (extracted.failed) {
        await this.markFailed(job.resumeId, startedAt, 'The file could not be decoded as a resume.');
        return;
      }

      if (!extracted.hasTextLayer) {
        await this.prisma.client.candidateResume.update({
          where: { id: job.resumeId },
          data: {
            parseStatus: 'NEEDS_OCR',
            extractedText: extracted.text.length > 0 ? extracted.text : null,
            parsedData: Prisma.DbNull,
            parsedAt: new Date(),
            parseDurationMs: Date.now() - startedAt,
            parseError: 'No selectable text was found in this file; OCR is required.',
          },
        });
        await this.audit.record({
          action: 'UPDATE',
          entity: RESUME_ENTITY,
          entityId: job.resumeId,
          description: 'Resume requires OCR',
        });
        return;
      }

      const choice = resumeParserChoiceSchema.safeParse(job.parser).success
        ? (job.parser as 'auto' | 'llm' | 'regex')
        : 'auto';
      const output = await this.parseWithFallback(extracted.text, resume.fileName, choice, job.resumeId);

      const normalizedSkills = normalizeResumeSkills(output.data.skills);
      const parsedData = resumeParsedDataSchema.parse({ ...output.data, normalizedSkills });

      await this.prisma.client.candidateResume.update({
        where: { id: job.resumeId },
        data: {
          parseStatus: 'COMPLETED',
          extractedText: extracted.text,
          parsedData: parsedData as unknown as Prisma.InputJsonValue,
          parseError: null,
          parsedAt: new Date(),
          parserUsed: output.parserUsed,
          parserConfidence: output.confidence,
          parseDurationMs: Date.now() - startedAt,
        },
      });

      await this.audit.record({
        action: 'UPDATE',
        entity: RESUME_ENTITY,
        entityId: job.resumeId,
        description: 'Parsed a resume',
      });
    } catch (error) {
      this.logger.error(
        `Resume parsing failed for ${job.resumeId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      await this.markFailed(job.resumeId, startedAt, 'Parsing failed. The file may be corrupt or unsupported.');
    }
  }

  private async parseWithFallback(
    text: string,
    fileName: string,
    choice: 'auto' | 'llm' | 'regex',
    resumeId: string,
  ): Promise<Awaited<ReturnType<ReturnType<typeof selectResumeParser>['parse']>>> {
    const ai = this.aiConfig();
    const parser = selectResumeParser(choice, ai);
    try {
      return await parser.parse({ text, fileName });
    } catch {
      if (parser.name === 'regex') throw new Error('Resume parsing failed.');
      this.logger.warn(`Parser "${parser.name}" failed for ${resumeId}; falling back to regex`);
      return selectResumeParser('regex', ai).parse({ text, fileName });
    }
  }

  private async markFailed(resumeId: string, startedAt: number, message: string): Promise<void> {
    await this.prisma.client.candidateResume
      .update({
        where: { id: resumeId },
        data: {
          parseStatus: 'FAILED',
          parseError: message,
          parseDurationMs: Date.now() - startedAt,
        },
      })
      .catch(() => undefined);
  }

  private async createCandidateFromResume(
    tenantId: string,
    userId: string,
    parsed: ResumeParsedData,
    input: AcceptResumeRequest,
    applied: AcceptResumeApplied,
  ): Promise<string> {
    const profile = mergeProfile(parsedProfileOf(parsed), input.overrides, null);
    const emailNormalized = normalizeEmail(profile.email);
    const phoneNormalized = normalizePhone(profile.phone);
    const linkedinNormalized = normalizeLinkedin(parsed.linkedinUrl);

    if (!input.allowDuplicate) {
      const identifiers: Prisma.CandidateWhereInput[] = [];
      if (emailNormalized) identifiers.push({ emailNormalized });
      if (phoneNormalized) identifiers.push({ phoneNormalized });
      if (linkedinNormalized) identifiers.push({ linkedinNormalized });

      if (identifiers.length > 0) {
        const existing = await this.prisma.client.candidate.findFirst({
          where: { deletedAt: null, OR: identifiers },
          select: { id: true },
        });
        if (existing) {
          throw new ConflictError(
            'A candidate with these details already exists. Send allowDuplicate to create anyway.',
            { candidateId: existing.id },
          );
        }
      }
    }

    return this.prisma.client.$transaction(async (tx) => {
      const candidate = await tx.candidate.create({
        data: {
          tenantId,
          firstName: profile.firstName?.trim() || 'Unknown',
          lastName: profile.lastName?.trim() || 'Unknown',
          email: profile.email ?? null,
          phone: profile.phone ?? null,
          headline: profile.headline ?? null,
          summary: profile.summary ?? null,
          currentTitle: profile.currentTitle ?? null,
          currentCompany: profile.currentCompany ?? null,
          locationCity: profile.locationCity ?? null,
          locationState: profile.locationState ?? null,
          locationCountry: profile.locationCountry ?? null,
          totalExperienceMonths: profile.totalExperienceMonths ?? null,
          experienceLevel: profile.experienceLevel ?? null,
          linkedinUrl: parsed.linkedinUrl ?? null,
          githubUrl: parsed.githubUrl ?? null,
          websiteUrl: parsed.websiteUrl ?? null,
          source: input.source,
          ownerId: profile.ownerId ?? userId,
          tags: profile.tags,
          emailNormalized,
          phoneNormalized,
          linkedinNormalized,
          dedupeKey: buildDedupeKey({
            email: profile.email,
            phone: profile.phone,
            linkedinUrl: parsed.linkedinUrl,
          }),
          createdById: userId,
          updatedById: userId,
        },
        select: { id: true },
      });

      applied.profile = true;

      const resolvedSkills = input.sections.skills
        ? await this.upsertSkills(tx, tenantId, parsed.normalizedSkills)
        : [];

      await this.applyChildCollections(
        tx,
        tenantId,
        candidate.id,
        profile,
        parsed,
        input.sections,
        resolvedSkills,
        applied,
      );

      return candidate.id;
    });
  }

  private async applyToExistingCandidate(
    tenantId: string,
    candidateId: string,
    parsed: ResumeParsedData,
    input: AcceptResumeRequest,
    applied: AcceptResumeApplied,
  ): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.candidate.findFirst({
        where: { id: candidateId, deletedAt: null },
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          headline: true,
          summary: true,
          currentTitle: true,
          currentCompany: true,
          locationCity: true,
          locationState: true,
          locationCountry: true,
          totalExperienceMonths: true,
          experienceLevel: true,
          ownerId: true,
          tags: true,
          linkedinUrl: true,
        },
      });
      if (!existing) throw new NotFoundError('Candidate', candidateId);

      const profile = mergeProfile(parsedProfileOf(parsed), input.overrides, existing);

      if (input.sections.profile) {
        applied.profile = await this.updateExistingProfile(tx, candidateId, existing, profile);
      }

      const resolvedSkills = input.sections.skills
        ? await this.upsertSkills(tx, tenantId, parsed.normalizedSkills)
        : [];

      await this.applyChildCollections(
        tx,
        tenantId,
        candidateId,
        profile,
        parsed,
        input.sections,
        resolvedSkills,
        applied,
      );
    });
  }

  /** Writes the reviewer-confirmed profile onto an existing candidate. */
  private async updateExistingProfile(
    tx: TenantTransactionClient,
    candidateId: string,
    existing: {
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
      headline: string | null;
      summary: string | null;
      currentTitle: string | null;
      currentCompany: string | null;
      locationCity: string | null;
      locationState: string | null;
      locationCountry: string | null;
      totalExperienceMonths: number | null;
      experienceLevel: ExperienceLevel | null;
      ownerId: string | null;
      tags: string[];
      linkedinUrl: string | null;
    },
    profile: ResolvedProfile,
  ): Promise<boolean> {
    const data: Prisma.CandidateUncheckedUpdateInput = {};

    // Required columns can never take a null (a reviewer override of null is a
    // no-op), so they fall back to what the candidate already has.
    const firstName = profile.firstName ?? existing.firstName;
    if (firstName !== existing.firstName) data.firstName = firstName;
    const lastName = profile.lastName ?? existing.lastName;
    if (lastName !== existing.lastName) data.lastName = lastName;

    if (profile.headline !== existing.headline) data.headline = profile.headline;
    if (profile.summary !== existing.summary) data.summary = profile.summary;
    if (profile.currentTitle !== existing.currentTitle) data.currentTitle = profile.currentTitle;
    if (profile.currentCompany !== existing.currentCompany) {
      data.currentCompany = profile.currentCompany;
    }
    if (profile.locationCity !== existing.locationCity) data.locationCity = profile.locationCity;
    if (profile.locationState !== existing.locationState) data.locationState = profile.locationState;
    if (profile.locationCountry !== existing.locationCountry) {
      data.locationCountry = profile.locationCountry;
    }
    if (profile.totalExperienceMonths !== existing.totalExperienceMonths) {
      data.totalExperienceMonths = profile.totalExperienceMonths;
    }
    if (profile.experienceLevel !== existing.experienceLevel) {
      data.experienceLevel = profile.experienceLevel;
    }
    if (profile.ownerId !== existing.ownerId) data.ownerId = profile.ownerId;
    if (profile.tags !== existing.tags) data.tags = profile.tags;
    if (profile.email !== existing.email) data.email = profile.email;
    if (profile.phone !== existing.phone) data.phone = profile.phone;

    if (data.email !== undefined || data.phone !== undefined) {
      data.emailNormalized = normalizeEmail(profile.email);
      data.phoneNormalized = normalizePhone(profile.phone);
      data.dedupeKey = buildDedupeKey({
        email: profile.email,
        phone: profile.phone,
        linkedinUrl: existing.linkedinUrl,
      });
    }

    if (Object.keys(data).length === 0) return false;

    data.updatedById = requestContext.userId ?? null;
    await tx.candidate.update({ where: { id: candidateId }, data });
    return true;
  }

  /** Inserts emails, phones and the four resume sections, skipping duplicates. */
  private async applyChildCollections(
    tx: TenantTransactionClient,
    tenantId: string,
    candidateId: string,
    profile: ResolvedProfile,
    parsed: ResumeParsedData,
    sections: ResumeAcceptSections,
    resolvedSkills: ResolvedSkill[],
    applied: AcceptResumeApplied,
  ): Promise<void> {
    if (sections.profile && profile.email) {
      await this.upsertPrimaryContact(tx, tenantId, candidateId, 'email', profile.email);
    }
    if (sections.profile && profile.phone) {
      await this.upsertPrimaryContact(tx, tenantId, candidateId, 'phone', profile.phone);
    }

    if (sections.experiences) {
      const existing = await tx.candidateExperience.findMany({
        where: { candidateId },
        select: { company: true, title: true, startDate: true },
      });
      const seen = new Set(existing.map((row) => experienceKey(row.company, row.title, row.startDate)));
      const rows = parsed.experiences.filter((entry) => entry.company && entry.title).filter((entry) => {
        const key = experienceKey(entry.company ?? '', entry.title ?? '', entry.startDate);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (rows.length > 0) {
        await tx.candidateExperience.createMany({
          data: rows.map((entry) => ({
            tenantId,
            candidateId,
            company: entry.company ?? '',
            title: entry.title ?? '',
            employmentType: entry.employmentType ?? null,
            location: entry.location ?? null,
            startDate: entry.startDate ?? null,
            endDate: entry.endDate ?? null,
            isCurrent: entry.isCurrent,
            description: entry.description ?? null,
            skills: entry.skills,
          })),
        });
        applied.experiences += rows.length;
      }
    }

    if (sections.educations) {
      const existing = await tx.candidateEducation.findMany({
        where: { candidateId },
        select: { institution: true, degree: true },
      });
      const seen = new Set(existing.map((row) => educationKey(row.institution, row.degree)));
      const rows = parsed.educations.filter((entry) => entry.institution).filter((entry) => {
        const key = educationKey(entry.institution ?? '', entry.degree ?? null);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (rows.length > 0) {
        await tx.candidateEducation.createMany({
          data: rows.map((entry) => ({
            tenantId,
            candidateId,
            institution: entry.institution ?? '',
            degree: entry.degree ?? null,
            fieldOfStudy: entry.fieldOfStudy ?? null,
            startDate: entry.startDate ?? null,
            endDate: entry.endDate ?? null,
            grade: entry.grade ?? null,
            description: entry.description ?? null,
          })),
        });
        applied.educations += rows.length;
      }
    }

    if (sections.skills && resolvedSkills.length > 0) {
      const existing = await tx.candidateSkill.findMany({
        where: { candidateId },
        select: { skillId: true },
      });
      const owned = new Set(existing.map((row) => row.skillId));
      const rows = resolvedSkills.filter((skill) => !owned.has(skill.skillId));
      if (rows.length > 0) {
        await tx.candidateSkill.createMany({
          data: rows.map((skill) => ({
            tenantId,
            candidateId,
            skillId: skill.skillId,
            years: skill.years,
            level: skill.level,
            isPrimary: false,
          })),
          skipDuplicates: true,
        });
        applied.skills += rows.length;
      }
    }

    if (sections.certifications) {
      const existing = await tx.candidateCertification.findMany({
        where: { candidateId },
        select: { name: true },
      });
      const seen = new Set(existing.map((row) => row.name.toLowerCase()));
      const rows = parsed.certifications.filter((entry) => {
        const key = entry.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (rows.length > 0) {
        await tx.candidateCertification.createMany({
          data: rows.map((entry) => ({
            tenantId,
            candidateId,
            name: entry.name,
            issuer: entry.issuer ?? null,
            issuedAt: entry.issuedAt ?? null,
            expiresAt: entry.expiresAt ?? null,
            credentialId: entry.credentialId ?? null,
            credentialUrl: entry.credentialUrl ?? null,
          })),
        });
        applied.certifications += rows.length;
      }
    }

    if (sections.languages) {
      const existing = await tx.candidateLanguage.findMany({
        where: { candidateId },
        select: { name: true },
      });
      const seen = new Set(existing.map((row) => row.name.toLowerCase()));
      const rows = parsed.languages.filter((entry) => {
        const key = entry.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (rows.length > 0) {
        await tx.candidateLanguage.createMany({
          data: rows.map((entry) => ({
            tenantId,
            candidateId,
            name: entry.name,
            proficiency: entry.proficiency,
          })),
        });
        applied.languages += rows.length;
      }
    }
  }

  private async upsertPrimaryContact(
    tx: TenantTransactionClient,
    tenantId: string,
    candidateId: string,
    kind: 'email' | 'phone',
    value: string,
  ): Promise<void> {
    if (kind === 'email') {
      const exists = await tx.candidateEmail.findFirst({
        where: { candidateId, address: value, deletedAt: null },
        select: { id: true },
      });
      if (exists) return;
      await tx.candidateEmail.updateMany({
        where: { candidateId, deletedAt: null },
        data: { isPrimary: false },
      });
      await tx.candidateEmail.create({
        data: { tenantId, candidateId, address: value, isPrimary: true },
      });
      return;
    }

    const exists = await tx.candidatePhone.findFirst({
      where: { candidateId, number: value, deletedAt: null },
      select: { id: true },
    });
    if (exists) return;
    await tx.candidatePhone.updateMany({
      where: { candidateId, deletedAt: null },
      data: { isPrimary: false },
    });
    await tx.candidatePhone.create({
      data: { tenantId, candidateId, number: value, isPrimary: true },
    });
  }

  /** Resolves normalised skills to tenant `Skill` rows, creating them on demand. */
  private async upsertSkills(
    tx: TenantTransactionClient,
    tenantId: string,
    skills: NormalizedResumeSkill[],
  ): Promise<ResolvedSkill[]> {
    const cache = new Map<string, string>();
    const resolved: ResolvedSkill[] = [];

    for (const skill of skills) {
      const name = (skill.matchedName || skill.name).trim();
      if (!name) continue;

      let skillId = cache.get(name.toLowerCase());
      if (!skillId) {
        const aliases = skill.name.trim() && skill.name.trim() !== name ? [skill.name.trim()] : [];
        const row = await tx.skill.upsert({
          where: { tenantId_name: { tenantId, name } },
          update: {},
          create: { tenantId, name, aliases, category: skill.category ?? null, isSystem: false },
          select: { id: true },
        });
        skillId = row.id;
        cache.set(name.toLowerCase(), skillId);
      }

      resolved.push({ skillId, name, years: skill.years, level: skill.level });
    }

    return resolved;
  }

  private async demoteOtherPrimaries(candidateId: string, keepId: string): Promise<void> {
    await this.prisma.client.candidateResume.updateMany({
      where: { candidateId, id: { not: keepId }, deletedAt: null },
      data: { isPrimary: false },
    });
  }

  private async findResumeOrFail(resumeId: string): Promise<CandidateResume> {
    const resume = await this.prisma.client.candidateResume.findFirst({
      where: { id: resumeId, deletedAt: null },
    });
    if (!resume) throw new NotFoundError(RESUME_ENTITY, resumeId);
    return resume;
  }

  private readParsedData(resume: CandidateResume): ResumeParsedData | null {
    if (!resume.parsedData) return null;
    const result = resumeParsedDataSchema.safeParse(resume.parsedData);
    return result.success ? result.data : null;
  }

  private async loadUploaders(
    ids: readonly (string | null)[],
  ): Promise<Map<string, UploaderInfo>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map();

    const users = await this.prisma.client.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true },
    });

    return new Map(
      users.map((user) => [
        user.id,
        { id: user.id, fullName: `${user.firstName} ${user.lastName}`.trim() },
      ]),
    );
  }

  private aiConfig(): AiConfig {
    const ai = this.config.get('ai', { infer: true });
    return { provider: ai.provider, apiKey: ai.apiKey, model: ai.model, baseUrl: ai.baseUrl };
  }

  private async enqueueParse(payload: ResumeParseJob): Promise<void> {
    try {
      await this.parseQueue.add(QUEUE_NAMES.resumeParse, payload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 500,
        removeOnFail: 1_000,
      });
    } catch {
      // A queue outage leaves the resume `PENDING`; the reviewer can re-parse.
      this.logger.error(`Could not enqueue resume ${payload.resumeId} for parsing`);
    }
  }

  private async logActivity(tenantId: string, candidateId: string, subject: string): Promise<void> {
    await this.prisma.client.activity.create({
      data: {
        tenantId,
        type: 'SYSTEM',
        subject,
        body: subject,
        entityType: 'CANDIDATE',
        entityId: candidateId,
        candidateId,
        createdById: requestContext.userId ?? null,
      },
    });
  }
}

// -----------------------------------------------------------------------------
// Mappers
// -----------------------------------------------------------------------------

function toSummary(resume: CandidateResume, uploader: UploaderInfo | null): ResumeSummary {
  return {
    id: resume.id,
    candidateId: resume.candidateId,
    fileName: resume.fileName,
    mimeType: resume.mimeType,
    sizeBytes: resume.sizeBytes,
    isPrimary: resume.isPrimary,
    version: resume.version,
    parseStatus: resume.parseStatus,
    parserUsed: resume.parserUsed,
    parserConfidence: resume.parserConfidence,
    parsedAt: resume.parsedAt?.toISOString() ?? null,
    uploadedBy: uploader,
    createdAt: resume.createdAt.toISOString(),
    updatedAt: resume.updatedAt.toISOString(),
  };
}

function toDetail(
  resume: CandidateResume,
  uploader: UploaderInfo | null,
  downloadUrl: string | null,
): ResumeDetail {
  const parsed = resume.parsedData ? resumeParsedDataSchema.safeParse(resume.parsedData) : null;
  const parsedData = parsed?.success ? parsed.data : null;

  return {
    ...toSummary(resume, uploader),
    storageKey: resume.storageKey,
    extractedText: resume.extractedText,
    parsedData,
    normalizedSkills: parsedData?.normalizedSkills ?? [],
    parseError: resume.parseError,
    parseDurationMs: resume.parseDurationMs,
    downloadUrl,
  };
}

// -----------------------------------------------------------------------------
// Profile resolution
// -----------------------------------------------------------------------------

/** The parsed resume mapped onto candidate profile fields. */
function parsedProfileOf(parsed: ResumeParsedData): ResolvedProfile {
  const current = parsed.experiences.find((entry) => entry.isCurrent) ?? parsed.experiences[0];
  const { firstName, lastName } = splitFullName(parsed.fullName);

  return {
    firstName: parsed.firstName ?? firstName,
    lastName: parsed.lastName ?? lastName,
    email: parsed.email,
    phone: parsed.phone,
    headline: parsed.headline,
    summary: parsed.summary,
    currentTitle: current?.title ?? null,
    currentCompany: current?.company ?? null,
    locationCity: parsed.locationCity,
    locationState: parsed.locationState,
    locationCountry: parsed.locationCountry,
    totalExperienceMonths: parsed.totalExperienceMonths,
    experienceLevel: null,
    ownerId: null,
    tags: [],
  };
}

/**
 * Layering rule: an explicit reviewer override always wins; otherwise an
 * existing candidate value is preserved; otherwise the parsed value fills the
 * gap. This is what makes accepting a resume non-destructive for a profile that
 * already has data.
 */
function mergeProfile(
  parsed: ResolvedProfile,
  overrides: ResumeAcceptOverrides,
  existing: Partial<ResolvedProfile> | null,
): ResolvedProfile {
  const prefer = <T>(
    override: T | undefined,
    current: T | null | undefined,
    fallback: T | null,
  ): T | null => {
    if (override !== undefined) return override;
    if (current !== undefined && current !== null) {
      if (typeof current === 'string' && current.trim() === '') return fallback;
      if (Array.isArray(current) && current.length === 0) return fallback;
      return current;
    }
    return fallback;
  };

  return {
    firstName: prefer(overrides.firstName, existing?.firstName ?? null, parsed.firstName),
    lastName: prefer(overrides.lastName, existing?.lastName ?? null, parsed.lastName),
    email: prefer(overrides.email, existing?.email ?? null, parsed.email),
    phone: prefer(overrides.phone, existing?.phone ?? null, parsed.phone),
    headline: prefer(overrides.headline, existing?.headline ?? null, parsed.headline),
    summary: prefer(overrides.summary, existing?.summary ?? null, parsed.summary),
    currentTitle: prefer(overrides.currentTitle, existing?.currentTitle ?? null, parsed.currentTitle),
    currentCompany: prefer(overrides.currentCompany, existing?.currentCompany ?? null, parsed.currentCompany),
    locationCity: prefer(overrides.locationCity, existing?.locationCity ?? null, parsed.locationCity),
    locationState: prefer(overrides.locationState, existing?.locationState ?? null, parsed.locationState),
    locationCountry: prefer(overrides.locationCountry, existing?.locationCountry ?? null, parsed.locationCountry),
    totalExperienceMonths: prefer(
      overrides.totalExperienceMonths,
      existing?.totalExperienceMonths ?? null,
      parsed.totalExperienceMonths,
    ),
    experienceLevel: prefer(overrides.experienceLevel, existing?.experienceLevel ?? null, parsed.experienceLevel),
    ownerId: prefer(overrides.ownerId, existing?.ownerId ?? null, parsed.ownerId),
    tags: overrides.tags ?? (existing?.tags && existing.tags.length > 0 ? existing.tags : parsed.tags),
  };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

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

/**
 * Compares the declared container with the one found in the file's leading
 * bytes.
 *
 * PDF, DOCX and DOC all carry a reliable signature, so a declared one of those
 * whose bytes match nothing is always a mismatch. Only `txt` and `rtf` — which
 * have no dependable magic bytes — are allowed to read as `unknown`. DOCX and
 * DOC are interchangeable because the same exporter can write either extension
 * around the same container.
 */
function isKindCompatible(declared: ResumeKind, detected: ResumeKind): boolean {
  if (declared === 'txt') return true;
  if (declared === detected) return true;
  if (declared === 'rtf') return detected === 'unknown';

  const wordContainers: readonly ResumeKind[] = ['doc', 'docx'];
  if (wordContainers.includes(declared)) return wordContainers.includes(detected);

  return false;
}

function splitFullName(fullName: string | null): { firstName: string | null; lastName: string | null } {
  if (!fullName) return { firstName: null, lastName: null };
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0] ?? null, lastName: null };
  return { firstName: parts[0] ?? null, lastName: parts[parts.length - 1] ?? null };
}

function experienceKey(company: string, title: string, startDate: Date | null): string {
  return `${company.toLowerCase()}|${title.toLowerCase()}|${startDate?.toISOString() ?? ''}`;
}

function educationKey(institution: string, degree: string | null): string {
  return `${institution.toLowerCase()}|${(degree ?? '').toLowerCase()}`;
}

function buildResumeOrderBy(
  query: ResumeQuery,
): Prisma.CandidateResumeOrderByWithRelationInput[] {
  const dir = query.sortDir;
  switch (query.sortBy) {
    case 'updatedAt':
      return [{ updatedAt: dir }];
    case 'fileName':
      return [{ fileName: dir }];
    case 'parseStatus':
      return [{ parseStatus: dir }];
    default:
      return [{ createdAt: dir }];
  }
}
