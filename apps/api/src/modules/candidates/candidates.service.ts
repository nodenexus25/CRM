import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  buildPaginationMeta,
  toSkipTake,
  type CandidateDetail,
  type CandidateDuplicateCandidate,
  type CandidateDuplicateGroup,
  type CandidateDuplicateResponse,
  type CandidateListItem,
  type CandidateListItemsSummary,
  type CandidateQuery,
  type CandidateSkillInput,
  type CreateCandidateRequest,
  type DuplicateCheckRequest,
  type MergeCandidatesRequest,
  type Paginated,
  type UpdateCandidateOwnerRequest,
  type UpdateCandidateRequest,
} from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import { PrismaService } from '@/infra/prisma/prisma.service';
import type { TenantScopedClient } from '@/infra/prisma/tenancy.extension';

import { buildDedupeKey, compileBooleanQuery, normalizeEmail, normalizeLinkedin, normalizePhone } from './candidate-search';

/**
 * The extended client's transaction type. `$transaction` hands back the
 * extended client minus its own connection/transaction escape hatches, which is
 * not assignable to `Prisma.TransactionClient`, so the helpers below use this.
 */
type TenantTransactionClient = Omit<
  TenantScopedClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** The fuzzy pre-filter upper bound; only `FUZZY` groups are affected. */
const FUZZY_CANDIDATE_LIMIT = 25;
/** Upper bound on ids an FTS filter may contribute to the paginated `where`. */
const FTS_MATCH_LIMIT = 10_000;

/**
 * Columns a merge may source from another record. Kept to scalar profile fields
 * — the nested collections are merged structurally, not field-by-field.
 */
const MERGEABLE_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'alternatePhone',
  'headline',
  'summary',
  'currentTitle',
  'currentCompany',
  'locationCity',
  'locationState',
  'locationCountry',
  'willingToRelocate',
  'totalExperienceMonths',
  'relevantExperienceMonths',
  'experienceLevel',
  'workAuthorization',
  'workAuthorizationExpiresAt',
  'availability',
  'availabilityDate',
  'noticePeriodDays',
  'expectedSalaryCents',
  'expectedSalaryCurrency',
  'currentSalaryCents',
  'expectedRateCents',
  'currentRateCents',
  'ratePeriod',
  'rateCurrency',
  'linkedinUrl',
  'githubUrl',
  'portfolioUrl',
  'websiteUrl',
  'source',
  'sourceDetail',
  'status',
  'rating',
  'isHot',
  'ownerId',
  'tags',
] as const;

const CANDIDATE_LIST_INCLUDE = {
  owner: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
  candidateSkills: {
    select: {
      skillId: true,
      years: true,
      level: true,
      isPrimary: true,
      lastUsedAt: true,
      skill: { select: { id: true, name: true } },
    },
    orderBy: { isPrimary: 'desc' },
  },
  listMemberships: {
    where: { deletedAt: null },
    select: { list: { select: { id: true, name: true, color: true } } },
  },
  resumes: { where: { deletedAt: null }, select: { id: true }, take: 1 },
} satisfies Prisma.CandidateInclude;

const CANDIDATE_DETAIL_INCLUDE = {
  ...CANDIDATE_LIST_INCLUDE,
  emails: {
    where: { deletedAt: null },
    select: { id: true, address: true, label: true, isPrimary: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  },
  phones: {
    where: { deletedAt: null },
    select: { id: true, number: true, label: true, isPrimary: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  },
  experiences: {
    where: { deletedAt: null },
    orderBy: [{ isCurrent: 'desc' }, { startDate: 'desc' }],
  },
  educations: { where: { deletedAt: null }, orderBy: { endDate: 'desc' } },
  certifications: { where: { deletedAt: null }, orderBy: { issuedAt: 'desc' } },
  languages: { where: { deletedAt: null }, orderBy: { name: 'asc' } },
  resumes: {
    where: { deletedAt: null },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      isPrimary: true,
      parseStatus: true,
      parsedAt: true,
      createdAt: true,
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
  },
  applications: {
    where: { deletedAt: null },
    select: {
      id: true,
      jobId: true,
      status: true,
      appliedAt: true,
      job: { select: { title: true, referenceCode: true } },
      stage: { select: { id: true, name: true, color: true } },
    },
    orderBy: { appliedAt: 'desc' },
  },
} satisfies Prisma.CandidateInclude;

type CandidateWithList = Prisma.CandidateGetPayload<{ include: typeof CANDIDATE_LIST_INCLUDE }>;
type CandidateWithDetail = Prisma.CandidateGetPayload<{ include: typeof CANDIDATE_DETAIL_INCLUDE }>;

/**
 * Candidates — the person record at the centre of the ATS. This service owns
 * the profile, its nested collections (emails, phones, experience, education,
 * skills, certifications, languages), duplicate detection and merging.
 *
 * Duplicate detection has two halves: normalised columns give O(1) exact hits
 * on email / phone / LinkedIn, and `pg_trgm` similarity catches the same person
 * spelled differently. Nothing here is blocked automatically except at create
 * time, where a likely duplicate is a 409 the caller can override with
 * `allowDuplicate`.
 */
@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async list(query: CandidateQuery): Promise<Paginated<CandidateListItem>> {
    const where = await this.buildWhere(query);
    const canViewPii = this.canViewPii();

    const [rows, total] = await Promise.all([
      this.prisma.client.candidate.findMany({
        where,
        include: CANDIDATE_LIST_INCLUDE,
        orderBy: buildOrderBy(query),
        ...toSkipTake(query),
      }),
      this.prisma.client.candidate.count({ where }),
    ]);

    const counts = await this.activeApplicationCounts(rows.map((row) => row.id));

    return {
      items: rows.map((row) => toListItem(row, counts.get(row.id) ?? 0, canViewPii)),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async detail(candidateId: string): Promise<CandidateDetail> {
    const row = await this.findOrFail(candidateId);
    const counts = await this.activeApplicationCounts([candidateId]);
    return toDetail(row, counts.get(candidateId) ?? 0, this.canViewPii());
  }

  /**
   * Resolves a filter-based bulk selection to concrete candidate ids.
   *
   * Reuses `buildWhere`, so the resolved set matches exactly what the caller
   * sees in the paginated table — including `_own` scoping. `limit` is a hard
   * ceiling: a bulk operation must never enqueue an unbounded amount of work.
   */
  async resolveIdsForBulk(query: CandidateQuery, limit: number): Promise<string[]> {
    const where = await this.buildWhere(query);
    const rows = await this.prisma.client.candidate.findMany({
      where,
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => row.id);
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  async create(input: CreateCandidateRequest): Promise<CandidateDetail> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;

    await this.assertUsersExist(compact([input.ownerId]));
    await this.assertSkillsExist(input.skills.map((skill) => skill.skillId));

    const emails = resolveEmails(input);
    const phones = resolvePhones(input);
    const dedupe = {
      emailNormalized: normalizeEmail(emails[0]?.address ?? input.email),
      phoneNormalized: normalizePhone(phones[0]?.number ?? input.phone),
      linkedinNormalized: normalizeLinkedin(input.linkedinUrl),
    };

    if (!input.allowDuplicate) {
      // Only exact identifier collisions block a create. A shared name or
      // employer is far too common to reject on, so fuzzy matching is reserved
      // for `POST /candidates/duplicates` where the caller reviews (and merges)
      // the candidates before acting.
      const groups = await this.findDuplicates({
        email: input.email ?? emails[0]?.address ?? null,
        phone: input.phone ?? phones[0]?.number ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        // No name/company is passed, so the fuzzy branch has nothing to match on
        // and only the exact identifier groups can block the create.
        fuzzyThreshold: 0.8,
      });
      if (groups.length > 0) {
        throw new ConflictError(
          'A candidate with these details already exists. Send allowDuplicate to create anyway.',
          { duplicates: groups },
        );
      }
    }

    const candidate = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.candidate.create({
        data: {
          tenantId,
          firstName: input.firstName,
          lastName: input.lastName,
          email: emails[0]?.address ?? input.email ?? null,
          phone: phones[0]?.number ?? input.phone ?? null,
          alternatePhone: input.alternatePhone ?? null,
          headline: input.headline ?? null,
          summary: input.summary ?? null,
          currentTitle: input.currentTitle ?? null,
          currentCompany: input.currentCompany ?? null,
          locationCity: input.locationCity ?? null,
          locationState: input.locationState ?? null,
          locationCountry: input.locationCountry ?? null,
          willingToRelocate: input.willingToRelocate,
          totalExperienceMonths: input.totalExperienceMonths ?? null,
          relevantExperienceMonths: input.relevantExperienceMonths ?? null,
          experienceLevel: input.experienceLevel ?? null,
          workAuthorization: input.workAuthorization,
          workAuthorizationExpiresAt: input.workAuthorizationExpiresAt ?? null,
          availability: input.availability ?? null,
          availabilityDate: input.availabilityDate ?? null,
          noticePeriodDays: input.noticePeriodDays ?? null,
          expectedSalaryCents: input.expectedSalaryCents ?? null,
          expectedSalaryCurrency: input.expectedSalaryCurrency ?? null,
          currentSalaryCents: input.currentSalaryCents ?? null,
          expectedRateCents: input.expectedRateCents ?? null,
          currentRateCents: input.currentRateCents ?? null,
          ratePeriod: input.ratePeriod ?? null,
          rateCurrency: input.rateCurrency ?? null,
          linkedinUrl: input.linkedinUrl ?? null,
          githubUrl: input.githubUrl ?? null,
          portfolioUrl: input.portfolioUrl ?? null,
          websiteUrl: input.websiteUrl ?? null,
          source: input.source,
          sourceDetail: input.sourceDetail ?? null,
          status: input.status,
          rating: input.rating ?? null,
          isHot: input.isHot,
          isArchived: input.isArchived,
          ownerId: input.ownerId ?? userId,
          tags: input.tags,
          customFields: input.customFields as Prisma.InputJsonValue,
          dedupeKey: buildDedupeKey({
            email: dedupe.emailNormalized,
            phone: dedupe.phoneNormalized,
            linkedinUrl: dedupe.linkedinNormalized,
          }),
          ...dedupe,
          createdById: userId,
          updatedById: userId,
        },
      });

      await this.createChildren(tx, tenantId, created.id, {
        emails,
        phones,
        experiences: input.experiences,
        educations: input.educations,
        skills: input.skills,
        certifications: input.certifications,
        languages: input.languages,
      });

      return created;
    });

    await this.logActivity(tenantId, candidate.id, 'Candidate created', `${candidate.firstName} ${candidate.lastName}`);
    await this.audit.record({
      action: 'CREATE',
      entity: 'Candidate',
      entityId: candidate.id,
      description: `Created candidate ${candidate.firstName} ${candidate.lastName}`,
    });

    return this.detail(candidate.id);
  }

  async update(candidateId: string, input: UpdateCandidateRequest): Promise<CandidateDetail> {
    const existing = await this.findCandidateOrFail(candidateId);
    const userId = requestContext.userId ?? null;

    if (input.ownerId !== undefined) await this.assertUsersExist(compact([input.ownerId]));

    const data: Prisma.CandidateUncheckedUpdateInput = { updatedById: userId };

    const scalarKeys: (keyof UpdateCandidateRequest)[] = [
      'firstName',
      'lastName',
      'headline',
      'summary',
      'currentTitle',
      'currentCompany',
      'locationCity',
      'locationState',
      'locationCountry',
      'willingToRelocate',
      'totalExperienceMonths',
      'relevantExperienceMonths',
      'experienceLevel',
      'workAuthorization',
      'workAuthorizationExpiresAt',
      'availability',
      'availabilityDate',
      'noticePeriodDays',
      'expectedSalaryCents',
      'expectedSalaryCurrency',
      'currentSalaryCents',
      'expectedRateCents',
      'currentRateCents',
      'ratePeriod',
      'rateCurrency',
      'linkedinUrl',
      'githubUrl',
      'portfolioUrl',
      'websiteUrl',
      'source',
      'sourceDetail',
      'status',
      'rating',
      'isHot',
      'isArchived',
      'ownerId',
      'tags',
      'customFields',
      'email',
      'phone',
      'alternatePhone',
    ];

    for (const key of scalarKeys) {
      const value = input[key];
      if (value === undefined) continue;
      (data as Record<string, unknown>)[key] = key === 'customFields' ? (value as Prisma.InputJsonValue) : (value ?? null);
    }

    // The normalised duplicate columns are derived, so any change to an
    // identifier has to refresh them or detection silently drifts.
    if (input.email !== undefined || input.phone !== undefined || input.linkedinUrl !== undefined) {
      const emailNormalized =
        input.email !== undefined ? normalizeEmail(input.email) : existing.emailNormalized;
      const phoneNormalized =
        input.phone !== undefined ? normalizePhone(input.phone) : existing.phoneNormalized;
      const linkedinNormalized =
        input.linkedinUrl !== undefined ? normalizeLinkedin(input.linkedinUrl) : existing.linkedinNormalized;

      data.emailNormalized = emailNormalized;
      data.phoneNormalized = phoneNormalized;
      data.linkedinNormalized = linkedinNormalized;
      data.dedupeKey = buildDedupeKey({
        email: emailNormalized,
        phone: phoneNormalized,
        linkedinUrl: linkedinNormalized,
      });
    }

    await this.prisma.client.candidate.update({ where: { id: candidateId }, data });

    await this.audit.record({
      action: 'UPDATE',
      entity: 'Candidate',
      entityId: candidateId,
      description: `Updated candidate ${existing.firstName} ${existing.lastName}`,
    });

    return this.detail(candidateId);
  }

  async updateOwner(candidateId: string, input: UpdateCandidateOwnerRequest): Promise<CandidateDetail> {
    const existing = await this.findCandidateOrFail(candidateId);
    await this.assertUsersExist(compact([input.ownerId]));

    await this.prisma.client.candidate.update({
      where: { id: candidateId },
      data: { ownerId: input.ownerId, updatedById: requestContext.userId ?? null },
    });

    await this.audit.record({
      action: 'UPDATE',
      entity: 'Candidate',
      entityId: candidateId,
      description: `Reassigned candidate ${existing.firstName} ${existing.lastName}`,
    });

    return this.detail(candidateId);
  }

  async remove(candidateId: string): Promise<{ deleted: true }> {
    const existing = await this.findCandidateOrFail(candidateId);

    await this.prisma.client.candidate.update({
      where: { id: candidateId },
      data: { deletedAt: new Date(), updatedById: requestContext.userId ?? null },
    });

    await this.audit.record({
      action: 'DELETE',
      entity: 'Candidate',
      entityId: candidateId,
      description: `Deleted candidate ${existing.firstName} ${existing.lastName}`,
    });

    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Duplicates & merge
  // ---------------------------------------------------------------------------

  /**
   * Exact hits on the normalised identifier columns, plus `pg_trgm` fuzzy
   * matches on name and company. The response is grouped by *why* records look
   * alike so the UI can label each cluster.
   */
  async duplicates(input: DuplicateCheckRequest): Promise<CandidateDuplicateResponse> {
    const groups = await this.findDuplicates(input);
    return { groups, scanned: groups.reduce((sum, group) => sum + group.candidates.length, 0) };
  }

  /**
   * Absorbs `duplicateIds` into `primaryId`: scalar fields resolve by
   * `fieldSources` → primary → first duplicate with a value, child collections
   * are repointed without colliding with the primary's own, and the absorbed
   * records are soft-deleted (never hard-deleted — audit history references
   * them).
   */
  async merge(input: MergeCandidatesRequest): Promise<CandidateDetail> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;

    const primary = await this.findCandidateOrFail(input.primaryId);
    const duplicateIds = [...new Set(input.duplicateIds)].filter((id) => id !== input.primaryId);
    if (duplicateIds.length === 0) {
      throw new ValidationError('Choose at least one different candidate to merge into the primary.');
    }

    const duplicates = await this.prisma.client.candidate.findMany({
      where: { id: { in: duplicateIds }, deletedAt: null },
      include: { listMemberships: { where: { deletedAt: null } } },
    });
    if (duplicates.length !== duplicateIds.length) {
      throw new ValidationError('Some of those candidates do not exist in this workspace.', {
        duplicateIds,
      });
    }

    const byId = new Map<string, Record<string, unknown>>();
    byId.set(primary.id, primary as unknown as Record<string, unknown>);
    for (const duplicate of duplicates) byId.set(duplicate.id, duplicate as unknown as Record<string, unknown>);

    const data: Record<string, unknown> = { updatedById: userId };

    for (const field of MERGEABLE_FIELDS) {
      const preferred = input.fieldSources[field];
      if (preferred && byId.has(preferred)) {
        data[field] = byId.get(preferred)?.[field] ?? null;
        continue;
      }
      const primaryValue = byId.get(primary.id)?.[field];
      if (isPresent(primaryValue)) continue;
      for (const duplicate of duplicates) {
        const value = (duplicate as unknown as Record<string, unknown>)[field];
        if (isPresent(value)) {
          data[field] = value;
          break;
        }
      }
    }

    const email = (data.email as string | null | undefined) ?? primary.email;
    const phone = (data.phone as string | null | undefined) ?? primary.phone;
    const linkedinUrl = (data.linkedinUrl as string | null | undefined) ?? primary.linkedinUrl;
    data.emailNormalized = normalizeEmail(email);
    data.phoneNormalized = normalizePhone(phone);
    data.linkedinNormalized = normalizeLinkedin(linkedinUrl);
    data.dedupeKey = buildDedupeKey({ email: data.emailNormalized as string, phone: data.phoneNormalized as string, linkedinUrl: data.linkedinNormalized as string });

    await this.prisma.client.$transaction(async (tx) => {
      await tx.candidate.update({ where: { id: primary.id }, data: data as Prisma.CandidateUncheckedUpdateInput });

      if (input.keepAllChildRecords) {
        await tx.candidateEmail.updateMany({ where: { candidateId: { in: duplicateIds } }, data: { candidateId: primary.id } });
        await tx.candidatePhone.updateMany({ where: { candidateId: { in: duplicateIds } }, data: { candidateId: primary.id } });
        await tx.candidateExperience.updateMany({ where: { candidateId: { in: duplicateIds } }, data: { candidateId: primary.id } });
        await tx.candidateEducation.updateMany({ where: { candidateId: { in: duplicateIds } }, data: { candidateId: primary.id } });
        await tx.candidateCertification.updateMany({ where: { candidateId: { in: duplicateIds } }, data: { candidateId: primary.id } });
        await tx.candidateLanguage.updateMany({ where: { candidateId: { in: duplicateIds } }, data: { candidateId: primary.id } });
        await tx.candidateResume.updateMany({ where: { candidateId: { in: duplicateIds } }, data: { candidateId: primary.id } });

        const skills = await tx.candidateSkill.findMany({
          where: { candidateId: { in: duplicateIds } },
        });
        const primarySkills = await tx.candidateSkill.findMany({ where: { candidateId: primary.id } });
        const owned = new Set(primarySkills.map((skill) => skill.skillId));
        const toMove = skills.filter((skill) => !owned.has(skill.skillId));
        if (toMove.length > 0) {
          await tx.candidateSkill.createMany({
            data: toMove.map((skill) => ({
              tenantId,
              candidateId: primary.id,
              skillId: skill.skillId,
              years: skill.years,
              level: skill.level,
              isPrimary: skill.isPrimary,
              lastUsedAt: skill.lastUsedAt,
            })),
            skipDuplicates: true,
          });
        }
        await tx.candidateSkill.deleteMany({ where: { candidateId: { in: duplicateIds } } });

        // Hotlist membership is unique per (list, candidate), so a candidate on
        // a list the primary is already on just loses the duplicate row.
        const memberships = await tx.candidateListMember.findMany({
          where: { candidateId: { in: duplicateIds } },
        });
        const primaryMemberships = await tx.candidateListMember.findMany({
          where: { candidateId: primary.id },
          select: { listId: true },
        });
        const onList = new Set(primaryMemberships.map((member) => member.listId));
        for (const membership of memberships) {
          if (onList.has(membership.listId)) {
            await tx.candidateListMember.delete({ where: { id: membership.id } });
          } else {
            await tx.candidateListMember.update({
              where: { id: membership.id },
              data: { candidateId: primary.id },
            });
          }
        }
      }

      // Applications always move, otherwise the history would be orphaned. An
      // application on a job the primary already applied to is retired instead:
      // keeping both would break the one-active-application-per-job rule.
      const primaryApplications = await tx.application.findMany({
        where: { candidateId: primary.id, deletedAt: null },
        select: { jobId: true },
      });
      const appliedJobs = new Set(primaryApplications.map((application) => application.jobId));

      const duplicateApplications = await tx.application.findMany({
        where: { candidateId: { in: duplicateIds }, deletedAt: null },
        select: { id: true, jobId: true },
      });
      for (const application of duplicateApplications) {
        if (appliedJobs.has(application.jobId)) {
          await tx.application.update({ where: { id: application.id }, data: { deletedAt: new Date() } });
        } else {
          await tx.application.update({ where: { id: application.id }, data: { candidateId: primary.id } });
        }
      }

      await tx.candidate.updateMany({
        where: { id: { in: duplicateIds } },
        data: { deletedAt: new Date(), updatedById: userId },
      });
    });

    await this.logActivity(
      tenantId,
      primary.id,
      'Candidates merged',
      `${duplicates.length + 1} records merged into ${primary.firstName} ${primary.lastName}`,
    );
    await this.audit.record({
      action: 'UPDATE',
      entity: 'Candidate',
      entityId: primary.id,
      description: `Merged ${duplicates.length} candidate(s) into ${primary.id}`,
    });

    return this.detail(primary.id);
  }

  // ---------------------------------------------------------------------------
  // Sub-resources
  // ---------------------------------------------------------------------------

  async addEmail(candidateId: string, input: { address: string; label?: string | null; isPrimary: boolean }): Promise<CandidateDetail> {
    const tenantId = requireTenant();
    await this.findCandidateOrFail(candidateId);

    await this.prisma.client.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.candidateEmail.updateMany({ where: { candidateId }, data: { isPrimary: false } });
      }
      await tx.candidateEmail.create({
        data: { tenantId, candidateId, address: input.address, label: input.label ?? null, isPrimary: input.isPrimary },
      });
      await syncPrimaryContact(tx, candidateId, tenantId);
    });

    return this.detail(candidateId);
  }

  async updateEmail(candidateId: string, emailId: string, input: Partial<{ address: string; label: string | null; isPrimary: boolean }>): Promise<CandidateDetail> {
    const tenantId = requireTenant();
    await this.findCandidateOrFail(candidateId);

    const existing = await this.prisma.client.candidateEmail.findFirst({ where: { id: emailId, candidateId, deletedAt: null } });
    if (!existing) throw new NotFoundError('Candidate email', emailId);

    await this.prisma.client.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.candidateEmail.updateMany({ where: { candidateId }, data: { isPrimary: false } });
      }
      await tx.candidateEmail.update({
        where: { id: emailId },
        data: {
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
        },
      });
      await syncPrimaryContact(tx, candidateId, tenantId);
    });

    return this.detail(candidateId);
  }

  async removeEmail(candidateId: string, emailId: string): Promise<CandidateDetail> {
    const tenantId = requireTenant();
    await this.findCandidateOrFail(candidateId);
    const existing = await this.prisma.client.candidateEmail.findFirst({ where: { id: emailId, candidateId, deletedAt: null } });
    if (!existing) throw new NotFoundError('Candidate email', emailId);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.candidateEmail.update({ where: { id: emailId }, data: { deletedAt: new Date() } });
      await syncPrimaryContact(tx, candidateId, tenantId);
    });

    return this.detail(candidateId);
  }

  async addPhone(candidateId: string, input: { number: string; label?: string | null; isPrimary: boolean }): Promise<CandidateDetail> {
    const tenantId = requireTenant();
    await this.findCandidateOrFail(candidateId);

    await this.prisma.client.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.candidatePhone.updateMany({ where: { candidateId }, data: { isPrimary: false } });
      }
      await tx.candidatePhone.create({
        data: { tenantId, candidateId, number: input.number, label: input.label ?? null, isPrimary: input.isPrimary },
      });
      await syncPrimaryContact(tx, candidateId, tenantId);
    });

    return this.detail(candidateId);
  }

  async updatePhone(candidateId: string, phoneId: string, input: Partial<{ number: string; label: string | null; isPrimary: boolean }>): Promise<CandidateDetail> {
    const tenantId = requireTenant();
    await this.findCandidateOrFail(candidateId);
    const existing = await this.prisma.client.candidatePhone.findFirst({ where: { id: phoneId, candidateId, deletedAt: null } });
    if (!existing) throw new NotFoundError('Candidate phone', phoneId);

    await this.prisma.client.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.candidatePhone.updateMany({ where: { candidateId }, data: { isPrimary: false } });
      }
      await tx.candidatePhone.update({
        where: { id: phoneId },
        data: {
          ...(input.number !== undefined ? { number: input.number } : {}),
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
        },
      });
      await syncPrimaryContact(tx, candidateId, tenantId);
    });

    return this.detail(candidateId);
  }

  async removePhone(candidateId: string, phoneId: string): Promise<CandidateDetail> {
    const tenantId = requireTenant();
    await this.findCandidateOrFail(candidateId);
    const existing = await this.prisma.client.candidatePhone.findFirst({ where: { id: phoneId, candidateId, deletedAt: null } });
    if (!existing) throw new NotFoundError('Candidate phone', phoneId);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.candidatePhone.update({ where: { id: phoneId }, data: { deletedAt: new Date() } });
      await syncPrimaryContact(tx, candidateId, tenantId);
    });

    return this.detail(candidateId);
  }

  async addExperience(candidateId: string, input: ExperienceInput): Promise<CandidateDetail> {
    const tenantId = requireTenant();
    await this.findCandidateOrFail(candidateId);
    await this.prisma.client.candidateExperience.create({
      data: { tenantId, candidateId, ...experienceCreateData(input) },
    });
    return this.detail(candidateId);
  }

  async updateExperience(candidateId: string, experienceId: string, input: Partial<ExperienceInput>): Promise<CandidateDetail> {
    await this.findChildOrFail(() => this.prisma.client.candidateExperience.findFirst({ where: { id: experienceId, candidateId, deletedAt: null } }), 'Candidate experience', experienceId);
    await this.prisma.client.candidateExperience.update({
      where: { id: experienceId },
      data: experienceData(input) as Prisma.CandidateExperienceUncheckedUpdateInput,
    });
    return this.detail(candidateId);
  }

  async removeExperience(candidateId: string, experienceId: string): Promise<CandidateDetail> {
    await this.findChildOrFail(() => this.prisma.client.candidateExperience.findFirst({ where: { id: experienceId, candidateId, deletedAt: null } }), 'Candidate experience', experienceId);
    await this.prisma.client.candidateExperience.update({ where: { id: experienceId }, data: { deletedAt: new Date() } });
    return this.detail(candidateId);
  }

  async addEducation(candidateId: string, input: EducationInput): Promise<CandidateDetail> {
    const tenantId = requireTenant();
    await this.findCandidateOrFail(candidateId);
    await this.prisma.client.candidateEducation.create({ data: { tenantId, candidateId, ...educationCreateData(input) } });
    return this.detail(candidateId);
  }

  async updateEducation(candidateId: string, educationId: string, input: Partial<EducationInput>): Promise<CandidateDetail> {
    await this.findChildOrFail(() => this.prisma.client.candidateEducation.findFirst({ where: { id: educationId, candidateId, deletedAt: null } }), 'Candidate education', educationId);
    await this.prisma.client.candidateEducation.update({
      where: { id: educationId },
      data: educationData(input) as Prisma.CandidateEducationUncheckedUpdateInput,
    });
    return this.detail(candidateId);
  }

  async removeEducation(candidateId: string, educationId: string): Promise<CandidateDetail> {
    await this.findChildOrFail(() => this.prisma.client.candidateEducation.findFirst({ where: { id: educationId, candidateId, deletedAt: null } }), 'Candidate education', educationId);
    await this.prisma.client.candidateEducation.update({ where: { id: educationId }, data: { deletedAt: new Date() } });
    return this.detail(candidateId);
  }

  async addSkill(candidateId: string, input: CandidateSkillInput): Promise<CandidateDetail> {
    const tenantId = requireTenant();
    await this.findCandidateOrFail(candidateId);
    await this.assertSkillsExist([input.skillId]);

    await this.prisma.client.candidateSkill.upsert({
      where: { candidateId_skillId: { candidateId, skillId: input.skillId } },
      update: { years: input.years ?? null, level: input.level ?? null, isPrimary: input.isPrimary, lastUsedAt: input.lastUsedAt ?? null },
      create: {
        tenantId,
        candidateId,
        skillId: input.skillId,
        years: input.years ?? null,
        level: input.level ?? null,
        isPrimary: input.isPrimary,
        lastUsedAt: input.lastUsedAt ?? null,
      },
    });

    return this.detail(candidateId);
  }

  async updateSkill(candidateId: string, skillId: string, input: Partial<CandidateSkillInput>): Promise<CandidateDetail> {
    await this.findChildOrFail(() => this.prisma.client.candidateSkill.findFirst({ where: { candidateId, skillId } }), 'Candidate skill', skillId);
    await this.prisma.client.candidateSkill.update({
      where: { candidateId_skillId: { candidateId, skillId } },
      data: {
        ...(input.years !== undefined ? { years: input.years ?? null } : {}),
        ...(input.level !== undefined ? { level: input.level ?? null } : {}),
        ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
        ...(input.lastUsedAt !== undefined ? { lastUsedAt: input.lastUsedAt ?? null } : {}),
      },
    });
    return this.detail(candidateId);
  }

  async removeSkill(candidateId: string, skillId: string): Promise<CandidateDetail> {
    await this.findChildOrFail(() => this.prisma.client.candidateSkill.findFirst({ where: { candidateId, skillId } }), 'Candidate skill', skillId);
    await this.prisma.client.candidateSkill.delete({ where: { candidateId_skillId: { candidateId, skillId } } });
    return this.detail(candidateId);
  }

  async addCertification(candidateId: string, input: CertificationInput): Promise<CandidateDetail> {
    const tenantId = requireTenant();
    await this.findCandidateOrFail(candidateId);
    await this.prisma.client.candidateCertification.create({ data: { tenantId, candidateId, ...certificationCreateData(input) } });
    return this.detail(candidateId);
  }

  async updateCertification(candidateId: string, certificationId: string, input: Partial<CertificationInput>): Promise<CandidateDetail> {
    await this.findChildOrFail(() => this.prisma.client.candidateCertification.findFirst({ where: { id: certificationId, candidateId, deletedAt: null } }), 'Candidate certification', certificationId);
    await this.prisma.client.candidateCertification.update({
      where: { id: certificationId },
      data: certificationData(input) as Prisma.CandidateCertificationUncheckedUpdateInput,
    });
    return this.detail(candidateId);
  }

  async removeCertification(candidateId: string, certificationId: string): Promise<CandidateDetail> {
    await this.findChildOrFail(() => this.prisma.client.candidateCertification.findFirst({ where: { id: certificationId, candidateId, deletedAt: null } }), 'Candidate certification', certificationId);
    await this.prisma.client.candidateCertification.update({ where: { id: certificationId }, data: { deletedAt: new Date() } });
    return this.detail(candidateId);
  }

  async addLanguage(candidateId: string, input: { name: string; proficiency: LanguageProficiency }): Promise<CandidateDetail> {
    const tenantId = requireTenant();
    await this.findCandidateOrFail(candidateId);
    await this.prisma.client.candidateLanguage.create({
      data: { tenantId, candidateId, name: input.name, proficiency: input.proficiency },
    });
    return this.detail(candidateId);
  }

  async updateLanguage(candidateId: string, languageId: string, input: Partial<{ name: string; proficiency: LanguageProficiency }>): Promise<CandidateDetail> {
    await this.findChildOrFail(() => this.prisma.client.candidateLanguage.findFirst({ where: { id: languageId, candidateId, deletedAt: null } }), 'Candidate language', languageId);
    await this.prisma.client.candidateLanguage.update({
      where: { id: languageId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.proficiency !== undefined ? { proficiency: input.proficiency } : {}),
      },
    });
    return this.detail(candidateId);
  }

  async removeLanguage(candidateId: string, languageId: string): Promise<CandidateDetail> {
    await this.findChildOrFail(() => this.prisma.client.candidateLanguage.findFirst({ where: { id: languageId, candidateId, deletedAt: null } }), 'Candidate language', languageId);
    await this.prisma.client.candidateLanguage.update({ where: { id: languageId }, data: { deletedAt: new Date() } });
    return this.detail(candidateId);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Composes the list filter. `_all` widens the caller to the whole workspace;
   * otherwise they see candidates they own or that sit on a requisition they
   * are assigned to.
   */
  private async buildWhere(query: CandidateQuery): Promise<Prisma.CandidateWhereInput> {
    const userId = requireUser();
    const context = requestContext.getOrThrow();
    const and: Prisma.CandidateWhereInput[] = [];

    const canReadAll = context.isSuperAdmin || hasPermission(context.permissions, 'candidate:read_all');
    if (!canReadAll || query.myCandidates) {
      and.push({
        OR: [
          { ownerId: userId },
          { applications: { some: { deletedAt: null, job: { assignments: { some: { userId } } } } } },
        ],
      });
    }

    const statuses = toArray(query.status);
    if (statuses.length > 0) and.push({ status: { in: statuses } });

    const sources = toArray(query.source);
    if (sources.length > 0) and.push({ source: { in: sources } });

    const levels = toArray(query.experienceLevel);
    if (levels.length > 0) and.push({ experienceLevel: { in: levels } });

    const availability = toArray(query.availability);
    if (availability.length > 0) and.push({ availability: { in: availability } });

    const authorizations = toArray(query.workAuthorization);
    if (authorizations.length > 0) and.push({ workAuthorization: { in: authorizations } });

    if (query.ownerId) and.push({ ownerId: query.ownerId });
    if (query.listId) and.push({ listMemberships: { some: { listId: query.listId, deletedAt: null } } });
    if (query.jobId) and.push({ applications: { some: { jobId: query.jobId, deletedAt: null } } });
    if (query.isHot !== undefined) and.push({ isHot: query.isHot });

    if (query.skillIds && query.skillIds.length > 0) {
      and.push({ candidateSkills: { some: { skillId: { in: query.skillIds } } } });
    }
    if (query.tags && query.tags.length > 0) and.push({ tags: { hasSome: query.tags } });

    if (query.location) {
      const location = { contains: query.location, mode: 'insensitive' as const };
      and.push({
        OR: [
          { locationCity: location },
          { locationState: location },
          { locationCountry: location },
        ],
      });
    }

    if (query.hasResume !== undefined) {
      and.push(query.hasResume ? { resumes: { some: { deletedAt: null } } } : { resumes: { none: { deletedAt: null } } });
    }

    if (query.minExperienceMonths !== undefined || query.maxExperienceMonths !== undefined) {
      const filter: Prisma.IntNullableFilter = {};
      if (query.minExperienceMonths !== undefined) filter.gte = query.minExperienceMonths;
      if (query.maxExperienceMonths !== undefined) filter.lte = query.maxExperienceMonths;
      and.push({ totalExperienceMonths: filter });
    }

    if (query.createdFrom || query.createdTo) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.createdFrom) createdAt.gte = query.createdFrom;
      if (query.createdTo) createdAt.lte = query.createdTo;
      and.push({ createdAt });
    }

    // Archiving is a filter, not a hidden state: `isArchived` selects only the
    // archive when true, and excludes it otherwise.
    and.push({ isArchived: query.isArchived ?? false });

    if (query.q) {
      const tsquery = compileBooleanQuery(query.q);
      if (tsquery) {
        const ids = await this.searchIds(tsquery);
        and.push({ id: { in: ids } });
      }
    }

    return and.length > 0 ? { deletedAt: null, AND: and } : { deletedAt: null };
  }

  /**
   * Resolves a compiled `tsquery` to candidate ids.
   *
   * Raw SQL is used because Prisma cannot express a `tsvector` match. The
   * tenant predicate is written out explicitly: raw statements bypass the
   * tenancy extension, so nothing else would scope them.
   */
  private async searchIds(tsquery: string): Promise<string[]> {
    const tenantId = requireTenant();
    const rows = await this.prisma.client.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "candidates"
      WHERE "tenantId" = ${tenantId}
        AND "deletedAt" IS NULL
        AND "searchVector" @@ to_tsquery('simple', ${tsquery})
      LIMIT ${FTS_MATCH_LIMIT}
    `);
    return rows.map((row) => row.id);
  }

  private async findDuplicates(input: DuplicateCheckRequest): Promise<CandidateDuplicateGroup[]> {
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);
    const linkedin = normalizeLinkedin(input.linkedinUrl);
    const groups: CandidateDuplicateGroup[] = [];

    const exclude = input.excludeId ? { id: { not: input.excludeId } } : {};

    for (const [matchType, column, value] of [
      ['EMAIL', 'emailNormalized', email],
      ['PHONE', 'phoneNormalized', phone],
      ['LINKEDIN', 'linkedinNormalized', linkedin],
    ] as const) {
      if (!value) continue;
      const rows = await this.prisma.client.candidate.findMany({
        where: { deletedAt: null, [column]: value, ...exclude } as Prisma.CandidateWhereInput,
        include: DUPLICATE_INCLUDE,
        take: 25,
      });
      if (rows.length > 0) {
        groups.push({ matchType, score: 1, candidates: rows.map(toDuplicateCandidate) });
      }
    }

    const fuzzy = await this.fuzzyMatches({
      firstName: normalizeTerm(input.firstName),
      lastName: normalizeTerm(input.lastName),
      company: normalizeTerm(input.currentCompany),
      excludeId: input.excludeId,
      threshold: input.fuzzyThreshold,
    });
    if (fuzzy.length > 0) groups.push(...fuzzy);

    return groups;
  }

  /** `pg_trgm` similarity over name and company, `%`-prefiltered by GIN indexes. */
  private async fuzzyMatches(input: {
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    excludeId?: string;
    threshold: number;
  }): Promise<CandidateDuplicateGroup[]> {
    const tenantId = requireTenant();

    const predicates: Prisma.Sql[] = [];
    const scores: Prisma.Sql[] = [];
    if (input.firstName) {
      predicates.push(Prisma.sql`c."firstName" % ${input.firstName}`);
      scores.push(Prisma.sql`similarity(lower(c."firstName"), ${input.firstName})`);
    }
    if (input.lastName) {
      predicates.push(Prisma.sql`c."lastName" % ${input.lastName}`);
      scores.push(Prisma.sql`similarity(lower(c."lastName"), ${input.lastName})`);
    }
    if (input.company) {
      predicates.push(Prisma.sql`coalesce(c."currentCompany", '') % ${input.company}`);
      scores.push(Prisma.sql`similarity(lower(coalesce(c."currentCompany", '')), ${input.company})`);
    }
    if (predicates.length === 0) return [];

    const rows = await this.prisma.client.$queryRaw<{ id: string; score: number }[]>(Prisma.sql`
      SELECT c."id" AS id,
             GREATEST(${Prisma.join(scores, ', ')}) AS score
      FROM "candidates" c
      WHERE c."tenantId" = ${tenantId}
        AND c."deletedAt" IS NULL
        ${input.excludeId ? Prisma.sql`AND c."id" <> ${input.excludeId}` : Prisma.empty}
        AND (${Prisma.join(predicates, ' OR ')})
      ORDER BY score DESC
      LIMIT ${FUZZY_CANDIDATE_LIMIT}
    `);

    const matches = rows.filter((row) => row.score >= input.threshold);
    if (matches.length === 0) return [];

    const candidates = await this.prisma.client.candidate.findMany({
      where: { id: { in: matches.map((row) => row.id) } },
      include: DUPLICATE_INCLUDE,
    });
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));

    // Near-identical people cluster together; grouping by name+company keeps
    // the UI to one card per plausible person rather than one per pair.
    const clusters = new Map<string, CandidateDuplicateGroup>();
    for (const match of matches) {
      const candidate = byId.get(match.id);
      if (!candidate) continue;
      const key = `${candidate.firstName}|${candidate.lastName}|${candidate.currentCompany ?? ''}`.toLowerCase();
      const existing = clusters.get(key);
      const entry = toDuplicateCandidate(candidate);
      if (existing) {
        existing.candidates.push(entry);
        existing.score = Math.max(existing.score, match.score);
      } else {
        clusters.set(key, { matchType: 'FUZZY', score: match.score, candidates: [entry] });
      }
    }

    return [...clusters.values()];
  }

  private async createChildren(
    tx: TenantTransactionClient,
    tenantId: string,
    candidateId: string,
    input: {
      emails: { address: string; label?: string | null; isPrimary: boolean }[];
      phones: { number: string; label?: string | null; isPrimary: boolean }[];
      experiences: ExperienceInput[];
      educations: EducationInput[];
      skills: CandidateSkillInput[];
      certifications: CertificationInput[];
      languages: { name: string; proficiency: LanguageProficiency }[];
    },
  ): Promise<void> {
    if (input.emails.length > 0) {
      await tx.candidateEmail.createMany({
        data: input.emails.map((email, index) => ({
          tenantId,
          candidateId,
          address: email.address,
          label: email.label ?? null,
          isPrimary: email.isPrimary || (index === 0 && !input.emails.some((entry) => entry.isPrimary)),
        })),
      });
    }
    if (input.phones.length > 0) {
      await tx.candidatePhone.createMany({
        data: input.phones.map((phone, index) => ({
          tenantId,
          candidateId,
          number: phone.number,
          label: phone.label ?? null,
          isPrimary: phone.isPrimary || (index === 0 && !input.phones.some((entry) => entry.isPrimary)),
        })),
      });
    }
    if (input.experiences.length > 0) {
      await tx.candidateExperience.createMany({
        data: input.experiences.map((experience) => ({ tenantId, candidateId, ...experienceCreateData(experience) })),
      });
    }
    if (input.educations.length > 0) {
      await tx.candidateEducation.createMany({
        data: input.educations.map((education) => ({ tenantId, candidateId, ...educationCreateData(education) })),
      });
    }
    if (input.skills.length > 0) {
      await tx.candidateSkill.createMany({
        data: input.skills.map((skill) => ({
          tenantId,
          candidateId,
          skillId: skill.skillId,
          years: skill.years ?? null,
          level: skill.level ?? null,
          isPrimary: skill.isPrimary,
          lastUsedAt: skill.lastUsedAt ?? null,
        })),
        skipDuplicates: true,
      });
    }
    if (input.certifications.length > 0) {
      await tx.candidateCertification.createMany({
        data: input.certifications.map((certification) => ({ tenantId, candidateId, ...certificationCreateData(certification) })),
      });
    }
    if (input.languages.length > 0) {
      await tx.candidateLanguage.createMany({
        data: input.languages.map((language) => ({ tenantId, candidateId, name: language.name, proficiency: language.proficiency })),
      });
    }
  }

  private async findOrFail(candidateId: string): Promise<CandidateWithDetail> {
    const candidate = await this.prisma.client.candidate.findFirst({
      where: { id: candidateId, deletedAt: null },
      include: CANDIDATE_DETAIL_INCLUDE,
    });
    if (!candidate) throw new NotFoundError('Candidate', candidateId);
    return candidate;
  }

  private async findCandidateOrFail(candidateId: string): Promise<{
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    emailNormalized: string | null;
    phoneNormalized: string | null;
    linkedinNormalized: string | null;
  }> {
    const candidate = await this.prisma.client.candidate.findFirst({
      where: { id: candidateId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        linkedinUrl: true,
        emailNormalized: true,
        phoneNormalized: true,
        linkedinNormalized: true,
      },
    });
    if (!candidate) throw new NotFoundError('Candidate', candidateId);
    return candidate;
  }

  private async findChildOrFail<T>(loader: () => Promise<T | null>, entity: string, id: string): Promise<T> {
    const child = await loader();
    if (!child) throw new NotFoundError(entity, id);
    return child;
  }

  private async assertUsersExist(userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;
    const found = await this.prisma.client.user.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true },
    });
    const missing = unique.filter((id) => !found.some((user) => user.id === id));
    if (missing.length > 0) throw new ValidationError('Some of those users do not exist.', { userIds: missing });
  }

  private async assertSkillsExist(skillIds: string[]): Promise<void> {
    const unique = [...new Set(skillIds)];
    if (unique.length === 0) return;
    const found = await this.prisma.client.skill.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true },
    });
    const missing = unique.filter((id) => !found.some((skill) => skill.id === id));
    if (missing.length > 0) throw new ValidationError('Some of those skills do not exist.', { skillIds: missing });
  }

  private async activeApplicationCounts(candidateIds: string[]): Promise<Map<string, number>> {
    if (candidateIds.length === 0) return new Map();
    const grouped = await this.prisma.client.application.groupBy({
      by: ['candidateId'],
      where: { candidateId: { in: candidateIds }, deletedAt: null, status: 'ACTIVE' },
      _count: { _all: true },
    });
    return new Map(grouped.map((row) => [row.candidateId, row._count._all]));
  }

  private canViewPii(): boolean {
    const context = requestContext.getOrThrow();
    return context.isSuperAdmin || hasPermission(context.permissions, 'candidate:view_pii');
  }

  private async logActivity(tenantId: string, candidateId: string, subject: string, body: string): Promise<void> {
    await this.prisma.client.activity.create({
      data: {
        tenantId,
        type: 'SYSTEM',
        subject,
        body,
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

const DUPLICATE_INCLUDE = {
  owner: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.CandidateInclude;

type DuplicateRow = Prisma.CandidateGetPayload<{ include: typeof DUPLICATE_INCLUDE }>;

function toDuplicateCandidate(candidate: DuplicateRow): CandidateDuplicateCandidate {
  return {
    id: candidate.id,
    fullName: fullName(candidate.firstName, candidate.lastName),
    email: candidate.email,
    phone: candidate.phone,
    currentCompany: candidate.currentCompany,
    owner: candidate.owner
      ? { id: candidate.owner.id, fullName: fullName(candidate.owner.firstName, candidate.owner.lastName) }
      : null,
    createdAt: candidate.createdAt.toISOString(),
  };
}

function toListItemsSummary(
  memberships: CandidateWithList['listMemberships'],
): CandidateListItemsSummary[] {
  return memberships.map((membership) => ({
    id: membership.list.id,
    name: membership.list.name,
    color: membership.list.color,
  }));
}

function toListItem(candidate: CandidateWithList, activeApplicationCount: number, canViewPii: boolean): CandidateListItem {
  return {
    id: candidate.id,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    fullName: fullName(candidate.firstName, candidate.lastName),
    email: canViewPii ? candidate.email : null,
    phone: canViewPii ? candidate.phone : null,
    currentTitle: candidate.currentTitle,
    currentCompany: candidate.currentCompany,
    location: composeLocation(candidate.locationCity, candidate.locationState, candidate.locationCountry),
    experienceLevel: candidate.experienceLevel,
    totalExperienceMonths: candidate.totalExperienceMonths,
    status: candidate.status as CandidateListItem['status'],
    source: candidate.source,
    isHot: candidate.isHot,
    isArchived: candidate.isArchived,
    rating: candidate.rating,
    owner: candidate.owner
      ? {
          id: candidate.owner.id,
          fullName: fullName(candidate.owner.firstName, candidate.owner.lastName),
          avatarUrl: candidate.owner.avatarUrl,
        }
      : null,
    tags: candidate.tags,
    skills: candidate.candidateSkills.map((entry) => ({ id: entry.skill.id, name: entry.skill.name })),
    lists: toListItemsSummary(candidate.listMemberships),
    hasResume: candidate.resumes.length > 0,
    activeApplicationCount,
    lastContactedAt: candidate.lastContactedAt?.toISOString() ?? null,
    createdAt: candidate.createdAt.toISOString(),
    updatedAt: candidate.updatedAt.toISOString(),
  };
}

function toDetail(candidate: CandidateWithDetail, activeApplicationCount: number, canViewPii: boolean): CandidateDetail {
  return {
    ...toListItem({ ...candidate, resumes: candidate.resumes.slice(0, 1) }, activeApplicationCount, canViewPii),
    alternatePhone: canViewPii ? candidate.alternatePhone : null,
    headline: candidate.headline,
    summary: candidate.summary,
    locationCity: candidate.locationCity,
    locationState: candidate.locationState,
    locationCountry: candidate.locationCountry,
    willingToRelocate: candidate.willingToRelocate,
    relevantExperienceMonths: candidate.relevantExperienceMonths,
    workAuthorization: candidate.workAuthorization ?? 'UNKNOWN',
    workAuthorizationExpiresAt: candidate.workAuthorizationExpiresAt?.toISOString() ?? null,
    availability: candidate.availability,
    availabilityDate: candidate.availabilityDate?.toISOString() ?? null,
    noticePeriodDays: candidate.noticePeriodDays,
    expectedSalaryCents: candidate.expectedSalaryCents,
    expectedSalaryCurrency: candidate.expectedSalaryCurrency,
    currentSalaryCents: candidate.currentSalaryCents,
    expectedRateCents: candidate.expectedRateCents,
    currentRateCents: candidate.currentRateCents,
    ratePeriod: candidate.ratePeriod,
    rateCurrency: candidate.rateCurrency,
    linkedinUrl: candidate.linkedinUrl,
    githubUrl: candidate.githubUrl,
    portfolioUrl: candidate.portfolioUrl,
    websiteUrl: candidate.websiteUrl,
    sourceDetail: candidate.sourceDetail,
    customFields: (candidate.customFields ?? {}) as Record<string, unknown>,
    emails: candidate.emails,
    phones: candidate.phones,
    experiences: candidate.experiences.map((experience) => ({
      id: experience.id,
      company: experience.company,
      title: experience.title,
      employmentType: experience.employmentType,
      location: experience.location,
      startDate: experience.startDate?.toISOString() ?? null,
      endDate: experience.endDate?.toISOString() ?? null,
      isCurrent: experience.isCurrent,
      description: experience.description,
      skills: experience.skills,
    })),
    educations: candidate.educations.map((education) => ({
      id: education.id,
      institution: education.institution,
      degree: education.degree,
      fieldOfStudy: education.fieldOfStudy,
      startDate: education.startDate?.toISOString() ?? null,
      endDate: education.endDate?.toISOString() ?? null,
      grade: education.grade,
      description: education.description,
    })),
    candidateSkills: candidate.candidateSkills.map((entry) => ({
      skillId: entry.skillId,
      name: entry.skill.name,
      years: entry.years,
      level: entry.level,
      isPrimary: entry.isPrimary,
      lastUsedAt: entry.lastUsedAt?.toISOString() ?? null,
    })),
    certifications: candidate.certifications.map((certification) => ({
      id: certification.id,
      name: certification.name,
      issuer: certification.issuer,
      issuedAt: certification.issuedAt?.toISOString() ?? null,
      expiresAt: certification.expiresAt?.toISOString() ?? null,
      credentialId: certification.credentialId,
      credentialUrl: certification.credentialUrl,
    })),
    languages: candidate.languages.map((language) => ({
      id: language.id,
      name: language.name,
      proficiency: language.proficiency,
    })),
    resumes: candidate.resumes.map((resume) => ({
      id: resume.id,
      fileName: resume.fileName,
      mimeType: resume.mimeType,
      sizeBytes: resume.sizeBytes,
      isPrimary: resume.isPrimary,
      parseStatus: resume.parseStatus,
      parsedAt: resume.parsedAt?.toISOString() ?? null,
      createdAt: resume.createdAt.toISOString(),
    })),
    applications: candidate.applications.map((application) => ({
      id: application.id,
      jobId: application.jobId,
      jobTitle: application.job.title,
      jobReferenceCode: application.job.referenceCode,
      stageId: application.stage.id,
      stageName: application.stage.name,
      stageColor: application.stage.color,
      status: application.status,
      appliedAt: application.appliedAt.toISOString(),
    })),
    lists: toListItemsSummary(candidate.listMemberships),
  };
}

// -----------------------------------------------------------------------------
// Sub-resource payload shapes
// -----------------------------------------------------------------------------

type ExperienceInput = {
  company: string;
  title: string;
  employmentType?: string | null;
  location?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  isCurrent?: boolean;
  description?: string | null;
  skills?: string[];
};

type EducationInput = {
  institution: string;
  degree?: string | null;
  fieldOfStudy?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  grade?: string | null;
  description?: string | null;
};

type CertificationInput = {
  name: string;
  issuer?: string | null;
  issuedAt?: Date | null;
  expiresAt?: Date | null;
  credentialId?: string | null;
  credentialUrl?: string | null;
};

type LanguageProficiency = 'BASIC' | 'CONVERSATIONAL' | 'PROFESSIONAL' | 'NATIVE';

type ExperienceCreateData = Omit<Prisma.CandidateExperienceUncheckedCreateInput, 'tenantId' | 'candidateId'>;
type EducationCreateData = Omit<Prisma.CandidateEducationUncheckedCreateInput, 'tenantId' | 'candidateId'>;
type CertificationCreateData = Omit<
  Prisma.CandidateCertificationUncheckedCreateInput,
  'tenantId' | 'candidateId'
>;

function experienceCreateData(input: ExperienceInput): ExperienceCreateData {
  return {
    company: input.company,
    title: input.title,
    employmentType: input.employmentType ?? null,
    location: input.location ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    isCurrent: input.isCurrent ?? false,
    description: input.description ?? null,
    skills: input.skills ?? [],
  };
}

function educationCreateData(input: EducationInput): EducationCreateData {
  return {
    institution: input.institution,
    degree: input.degree ?? null,
    fieldOfStudy: input.fieldOfStudy ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    grade: input.grade ?? null,
    description: input.description ?? null,
  };
}

function certificationCreateData(input: CertificationInput): CertificationCreateData {
  return {
    name: input.name,
    issuer: input.issuer ?? null,
    issuedAt: input.issuedAt ?? null,
    expiresAt: input.expiresAt ?? null,
    credentialId: input.credentialId ?? null,
    credentialUrl: input.credentialUrl ?? null,
  };
}

function experienceData(input: Partial<ExperienceInput>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (input.company !== undefined) data.company = input.company;
  if (input.title !== undefined) data.title = input.title;
  if (input.employmentType !== undefined) data.employmentType = input.employmentType ?? null;
  if (input.location !== undefined) data.location = input.location ?? null;
  if (input.startDate !== undefined) data.startDate = input.startDate ?? null;
  if (input.endDate !== undefined) data.endDate = input.endDate ?? null;
  if (input.isCurrent !== undefined) data.isCurrent = input.isCurrent;
  if (input.description !== undefined) data.description = input.description ?? null;
  if (input.skills !== undefined) data.skills = input.skills;
  return data;
}

function educationData(input: Partial<EducationInput>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (input.institution !== undefined) data.institution = input.institution;
  if (input.degree !== undefined) data.degree = input.degree ?? null;
  if (input.fieldOfStudy !== undefined) data.fieldOfStudy = input.fieldOfStudy ?? null;
  if (input.startDate !== undefined) data.startDate = input.startDate ?? null;
  if (input.endDate !== undefined) data.endDate = input.endDate ?? null;
  if (input.grade !== undefined) data.grade = input.grade ?? null;
  if (input.description !== undefined) data.description = input.description ?? null;
  return data;
}

function certificationData(input: Partial<CertificationInput>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.issuer !== undefined) data.issuer = input.issuer ?? null;
  if (input.issuedAt !== undefined) data.issuedAt = input.issuedAt ?? null;
  if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt ?? null;
  if (input.credentialId !== undefined) data.credentialId = input.credentialId ?? null;
  if (input.credentialUrl !== undefined) data.credentialUrl = input.credentialUrl ?? null;
  return data;
}

/**
 * Re-derives `Candidate.email` / `Candidate.phone` from the primary child row
 * so the denormalised columns the list view reads can never disagree with the
 * collection the profile edits.
 */
async function syncPrimaryContact(
  tx: TenantTransactionClient,
  candidateId: string,
  tenantId: string,
): Promise<void> {
  const [email, phone] = await Promise.all([
    tx.candidateEmail.findFirst({
      where: { candidateId, deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    }),
    tx.candidatePhone.findFirst({
      where: { candidateId, deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    }),
  ]);

  await tx.candidate.update({
    where: { id: candidateId },
    data: {
      email: email?.address ?? null,
      phone: phone?.number ?? null,
      emailNormalized: normalizeEmail(email?.address ?? null),
      phoneNormalized: normalizePhone(phone?.number ?? null),
    },
  });

  void tenantId;
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

/** Mirrors `PermissionsGuard`: holding `_all` satisfies an `_own` requirement. */
function hasPermission(granted: readonly string[], required: string): boolean {
  if (granted.includes(required)) return true;
  if (required.endsWith('_own')) return granted.includes(`${required.replace(/_own$/, '')}_all`);
  return false;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function compact(values: (string | null | undefined)[]): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function fullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

function composeLocation(city: string | null, state: string | null, country: string | null): string | null {
  const parts = [city, state, country].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(', ') : null;
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function normalizeTerm(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveEmails(input: CreateCandidateRequest): { address: string; label?: string | null; isPrimary: boolean }[] {
  if (input.emails.length > 0) return input.emails;
  return input.email ? [{ address: input.email, isPrimary: true }] : [];
}

function resolvePhones(input: CreateCandidateRequest): { number: string; label?: string | null; isPrimary: boolean }[] {
  if (input.phones.length > 0) return input.phones;
  return input.phone ? [{ number: input.phone, isPrimary: true }] : [];
}

function buildOrderBy(query: CandidateQuery): Prisma.CandidateOrderByWithRelationInput[] {
  const dir = query.sortDir;
  switch (query.sortBy) {
    case 'firstName':
      return [{ firstName: dir }, { lastName: dir }];
    case 'lastName':
      return [{ lastName: dir }, { firstName: dir }];
    case 'currentCompany':
      return [{ currentCompany: dir }];
    case 'expectedRateCents':
      return [{ expectedRateCents: dir }];
    case 'lastContactedAt':
      return [{ lastContactedAt: dir }];
    case 'rating':
      return [{ rating: dir }];
    case 'updatedAt':
      return [{ updatedAt: dir }];
    default:
      return [{ createdAt: dir }];
  }
}
