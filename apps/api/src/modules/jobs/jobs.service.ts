import { Injectable } from '@nestjs/common';
import type { JobStatus, Priority, Prisma } from '@prisma/client';

import {
  JOB_STATUS_TRANSITIONS,
  buildPaginationMeta,
  toSkipTake,
  type AssignRecruitersRequest,
  type ChangeJobStatusRequest,
  type CloneJobRequest,
  type CreateJobRequest,
  type JobDetail,
  type JobListItem,
  type JobListOwner,
  type JobListSkill,
  type JobPipelineStageSummary,
  type JobQuery,
  type JobStats,
  type Paginated,
  type PipelineStageItem,
  type UpdateJobRequest,
} from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import { ForbiddenError, NotFoundError, ValidationError } from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import { PrismaService } from '@/infra/prisma/prisma.service';
import type { TenantScopedClient } from '@/infra/prisma/tenancy.extension';
import { PipelineService } from '@/modules/pipeline/pipeline.service';

/**
 * The transaction-scoped handle yielded inside `prisma.client.$transaction(fn)`.
 *
 * The extended client wraps every model delegate, so this is *not* assignable to
 * `Prisma.TransactionClient`. Deriving it from the extended client keeps helpers
 * such as the sequence allocator correctly typed.
 */
type TenantTransactionClient = Omit<
  TenantScopedClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Rows younger than this count as "new" applicants in the list view. */
const NEW_APPLICANT_DAYS = 7;
const JOB_SEQUENCE_KEY = 'JOB';
const CLOSED_STATUSES: readonly JobStatus[] = ['CLOSED', 'FILLED', 'CANCELLED'];

const JOB_LIST_INCLUDE = {
  client: { select: { id: true, name: true } },
  owner: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
  jobSkills: {
    select: {
      weight: true,
      required: true,
      minYears: true,
      skill: { select: { id: true, name: true } },
    },
    orderBy: { weight: 'desc' },
  },
} satisfies Prisma.JobInclude;

const JOB_DETAIL_INCLUDE = {
  ...JOB_LIST_INCLUDE,
  contact: { select: { id: true, firstName: true, lastName: true, email: true } },
  assignments: {
    include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.JobInclude;

type JobWithList = Prisma.JobGetPayload<{ include: typeof JOB_LIST_INCLUDE }>;
type JobWithDetail = Prisma.JobGetPayload<{ include: typeof JOB_DETAIL_INCLUDE }>;

/**
 * Requisitions — the hub of the ATS. Everything else (applications, interviews,
 * offers, placements) hangs off a job, so this service owns the job lifecycle:
 * creation with a concurrency-safe `JOB-0001` code, the status state machine,
 * recruiter assignment and the roll-up stats behind the job header.
 */
@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async list(query: JobQuery): Promise<Paginated<JobListItem>> {
    const where = this.buildWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.client.job.findMany({
        where,
        include: JOB_LIST_INCLUDE,
        orderBy: buildOrderBy(query),
        ...toSkipTake(query),
      }),
      this.prisma.client.job.count({ where }),
    ]);

    const ids = rows.map((row) => row.id);
    const [applicants, fresh] = await Promise.all([
      this.applicantCounts(ids),
      this.newApplicantCounts(ids),
    ]);

    return {
      items: rows.map((row) =>
        toJobListItem(row, applicants.get(row.id) ?? 0, fresh.get(row.id) ?? 0),
      ),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async detail(jobId: string): Promise<JobDetail> {
    const job = await this.prisma.client.job.findFirst({
      where: { id: jobId, deletedAt: null },
      include: JOB_DETAIL_INCLUDE,
    });
    if (!job) throw new NotFoundError('Job', jobId);

    const [stages, applicants, fresh, hasCustomPipeline] = await Promise.all([
      this.pipeline.effectiveJobStages(jobId),
      this.applicantCounts([jobId]),
      this.newApplicantCounts([jobId]),
      this.pipeline.hasOwnStages(jobId),
    ]);

    return toJobDetail(
      job,
      stages.map(toStageSummary),
      applicants.get(jobId) ?? 0,
      fresh.get(jobId) ?? 0,
      hasCustomPipeline,
    );
  }

  /** The job's effective pipeline, for the Kanban board header. */
  async pipelineStages(jobId: string): Promise<JobPipelineStageSummary[]> {
    await this.findJobOrFail(jobId);
    const stages = await this.pipeline.effectiveJobStages(jobId);
    return stages.map(toStageSummary);
  }

  /**
   * Resolves a filter-based bulk selection to concrete job ids.
   *
   * Reuses `buildWhere`, so the resolved set matches exactly what the caller
   * sees in the paginated table — including `_own` scoping. `limit` is a hard
   * ceiling: a bulk operation must never enqueue an unbounded amount of work.
   */
  async resolveIdsForBulk(query: JobQuery, limit: number): Promise<string[]> {
    const where = this.buildWhere(query);
    const rows = await this.prisma.client.job.findMany({
      where,
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => row.id);
  }

  async stats(jobId: string): Promise<JobStats> {
    await this.findJobOrFail(jobId);

    const stages = await this.pipeline.effectiveJobStages(jobId);
    const stageIds = stages.map((stage) => stage.id);

    const [byStatus, applications, interviews, offers] = await Promise.all([
      this.prisma.client.application.groupBy({
        by: ['status'],
        where: { jobId, deletedAt: null },
        _count: { _all: true },
      }),
      stageIds.length > 0
        ? this.prisma.client.application.findMany({
            where: { jobId, deletedAt: null, stageId: { in: stageIds } },
            select: { stageId: true, stageEnteredAt: true },
          })
        : Promise.resolve([] as { stageId: string; stageEnteredAt: Date }[]),
      this.prisma.client.interview.count({
        where: { deletedAt: null, application: { jobId, deletedAt: null } },
      }),
      this.prisma.client.offer.count({
        where: { deletedAt: null, application: { jobId, deletedAt: null } },
      }),
    ]);

    const statusCount = new Map(byStatus.map((row) => [row.status, row._count._all]));
    const totals = byStatus.reduce((sum, row) => sum + row._count._all, 0);

    const daysByStage = new Map<string, number>();
    const now = Date.now();
    for (const application of applications) {
      const days = (now - application.stageEnteredAt.getTime()) / 86_400_000;
      daysByStage.set(application.stageId, (daysByStage.get(application.stageId) ?? 0) + days);
    }

    return {
      pipeline: stages.map(toStageSummary),
      totals: {
        applications: totals,
        active: statusCount.get('ACTIVE') ?? 0,
        rejected: statusCount.get('REJECTED') ?? 0,
        withdrawn: statusCount.get('WITHDRAWN') ?? 0,
        placed: statusCount.get('PLACED') ?? 0,
        interviews,
        offers,
      },
      averageDaysInStage: stages.map((stage) => {
        const sum = daysByStage.get(stage.id) ?? 0;
        const count = stage.applicationCount;
        return {
          stageId: stage.id,
          stageName: stage.name,
          averageDays: count > 0 ? round1(sum / count) : 0,
        };
      }),
      submissionFunnel: stages.map((stage) => ({
        stageKey: stage.key,
        stageName: stage.name,
        count: stage.applicationCount,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  async create(input: CreateJobRequest): Promise<JobDetail> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;
    const now = new Date();

    await this.assertClientExists(input.clientId);
    await this.assertContactBelongsToClient(input.contactId, input.clientId);
    await this.assertUsersExist(compact([input.ownerId]));
    await this.assertTeamExists(input.teamId);
    await this.assertSkillsExist(input.skills.map((skill) => skill.skillId));

    const margin = computeMargin(input.payRateMinCents, input.payRateMaxCents, input.billRateCents);

    const job = await this.prisma.client.$transaction(async (tx) => {
      const sequence = await nextJobSequence(tx, tenantId);
      const created = await tx.job.create({
        data: {
          tenantId,
          title: input.title,
          referenceCode: formatJobReference(sequence),
          jobCodeSeq: sequence,
          status: input.status,
          jobType: input.jobType,
          remoteType: input.remoteType,
          priority: input.priority,
          clientId: input.clientId ?? null,
          contactId: input.contactId ?? null,
          description: input.description ?? null,
          requirements: input.requirements ?? null,
          responsibilities: input.responsibilities ?? null,
          locationCity: input.locationCity ?? null,
          locationState: input.locationState ?? null,
          locationCountry: input.locationCountry ?? null,
          openings: input.openings,
          payRateMinCents: input.payRateMinCents ?? null,
          payRateMaxCents: input.payRateMaxCents ?? null,
          billRateCents: input.billRateCents ?? null,
          rateType: input.rateType ?? null,
          billRateType: input.billRateType ?? null,
          marginCents: margin.marginCents,
          marginPercentage: margin.marginPercentage,
          currency: input.currency,
          minExperienceYears: input.minExperienceYears ?? null,
          maxExperienceYears: input.maxExperienceYears ?? null,
          educationLevel: input.educationLevel ?? null,
          workAuthorizations: input.workAuthorizations,
          visaSponsorship: input.visaSponsorship ?? null,
          targetFillAt: input.targetFillAt ?? null,
          openedAt: input.status === 'OPEN' ? now : null,
          closedAt: CLOSED_STATUSES.includes(input.status) ? now : null,
          ownerId: input.ownerId ?? userId,
          teamId: input.teamId ?? null,
          source: input.source ?? null,
          customFields: input.customFields as Prisma.InputJsonValue,
          createdById: userId,
          updatedById: userId,
        },
      });

      if (input.skills.length > 0) {
        await tx.jobSkill.createMany({
          data: input.skills.map((skill) => ({
            tenantId,
            jobId: created.id,
            skillId: skill.skillId,
            weight: skill.weight,
            required: skill.required,
            minYears: skill.minYears ?? null,
          })),
          skipDuplicates: true,
        });
      }

      return created;
    });

    if (input.useDefaultPipeline) await this.pipeline.copyTenantStagesToJob(job.id);

    await this.logActivity(job.id, 'Created requisition', `${job.title} (${job.referenceCode})`);
    await this.audit.record({
      action: 'CREATE',
      entity: 'Job',
      entityId: job.id,
      description: `Created job ${job.referenceCode}`,
    });

    return this.detail(job.id);
  }

  async update(jobId: string, input: UpdateJobRequest): Promise<JobDetail> {
    const existing = await this.findJobOrFail(jobId);
    const userId = requestContext.userId ?? null;

    if (input.clientId !== undefined) await this.assertClientExists(input.clientId);
    if (input.contactId !== undefined) {
      await this.assertContactBelongsToClient(
        input.contactId,
        input.clientId === undefined ? existing.clientId : input.clientId,
      );
    }
    if (input.ownerId !== undefined) await this.assertUsersExist(compact([input.ownerId]));
    if (input.teamId !== undefined) await this.assertTeamExists(input.teamId);

    const data: Prisma.JobUncheckedUpdateInput = { updatedById: userId };

    if (input.title !== undefined) data.title = input.title;
    if (input.clientId !== undefined) data.clientId = input.clientId ?? null;
    if (input.contactId !== undefined) data.contactId = input.contactId ?? null;
    if (input.jobType !== undefined) data.jobType = input.jobType;
    if (input.remoteType !== undefined) data.remoteType = input.remoteType;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.requirements !== undefined) data.requirements = input.requirements ?? null;
    if (input.responsibilities !== undefined) data.responsibilities = input.responsibilities ?? null;
    if (input.locationCity !== undefined) data.locationCity = input.locationCity ?? null;
    if (input.locationState !== undefined) data.locationState = input.locationState ?? null;
    if (input.locationCountry !== undefined) data.locationCountry = input.locationCountry ?? null;
    if (input.openings !== undefined) data.openings = input.openings;
    if (input.rateType !== undefined) data.rateType = input.rateType ?? null;
    if (input.billRateType !== undefined) data.billRateType = input.billRateType ?? null;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.minExperienceYears !== undefined) data.minExperienceYears = input.minExperienceYears ?? null;
    if (input.maxExperienceYears !== undefined) data.maxExperienceYears = input.maxExperienceYears ?? null;
    if (input.educationLevel !== undefined) data.educationLevel = input.educationLevel ?? null;
    if (input.workAuthorizations !== undefined) data.workAuthorizations = input.workAuthorizations;
    if (input.visaSponsorship !== undefined) data.visaSponsorship = input.visaSponsorship ?? null;
    if (input.targetFillAt !== undefined) data.targetFillAt = input.targetFillAt ?? null;
    if (input.ownerId !== undefined) data.ownerId = input.ownerId ?? null;
    if (input.teamId !== undefined) data.teamId = input.teamId ?? null;
    if (input.source !== undefined) data.source = input.source ?? null;
    if (input.customFields !== undefined) data.customFields = input.customFields as Prisma.InputJsonValue;

    // Rates are recomputed together so a change to any leg keeps the margin honest.
    const touchesRates =
      input.payRateMinCents !== undefined ||
      input.payRateMaxCents !== undefined ||
      input.billRateCents !== undefined;

    if (touchesRates) {
      const payMin = pick(input.payRateMinCents, existing.payRateMinCents);
      const payMax = pick(input.payRateMaxCents, existing.payRateMaxCents);
      const bill = pick(input.billRateCents, existing.billRateCents);
      data.payRateMinCents = payMin;
      data.payRateMaxCents = payMax;
      data.billRateCents = bill;
      const margin = computeMargin(payMin, payMax, bill);
      data.marginCents = margin.marginCents;
      data.marginPercentage = margin.marginPercentage;
    }

    await this.prisma.client.job.update({ where: { id: jobId }, data });

    await this.audit.record({
      action: 'UPDATE',
      entity: 'Job',
      entityId: jobId,
      description: `Updated job ${existing.referenceCode}`,
    });

    return this.detail(jobId);
  }

  async remove(jobId: string): Promise<{ deleted: true }> {
    const job = await this.findJobOrFail(jobId);

    await this.prisma.client.job.update({
      where: { id: jobId },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      action: 'DELETE',
      entity: 'Job',
      entityId: jobId,
      description: `Deleted job ${job.referenceCode}`,
    });

    return { deleted: true };
  }

  async clone(jobId: string, input: CloneJobRequest): Promise<JobDetail> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;

    const source = await this.prisma.client.job.findFirst({
      where: { id: jobId, deletedAt: null },
      include: { jobSkills: true },
    });
    if (!source) throw new NotFoundError('Job', jobId);

    const job = await this.prisma.client.$transaction(async (tx) => {
      const sequence = await nextJobSequence(tx, tenantId);
      const created = await tx.job.create({
        data: {
          tenantId,
          title: input.title ?? `${source.title} (copy)`,
          referenceCode: formatJobReference(sequence),
          jobCodeSeq: sequence,
          status: 'DRAFT',
          jobType: source.jobType,
          remoteType: source.remoteType,
          priority: source.priority,
          clientId: source.clientId,
          contactId: source.contactId,
          description: source.description,
          requirements: source.requirements,
          responsibilities: source.responsibilities,
          locationCity: source.locationCity,
          locationState: source.locationState,
          locationCountry: source.locationCountry,
          openings: source.openings,
          payRateMinCents: source.payRateMinCents,
          payRateMaxCents: source.payRateMaxCents,
          billRateCents: source.billRateCents,
          rateType: source.rateType,
          billRateType: source.billRateType,
          marginCents: source.marginCents,
          marginPercentage: source.marginPercentage,
          currency: source.currency,
          minExperienceYears: source.minExperienceYears,
          maxExperienceYears: source.maxExperienceYears,
          educationLevel: source.educationLevel,
          workAuthorizations: source.workAuthorizations,
          visaSponsorship: source.visaSponsorship,
          targetFillAt: source.targetFillAt,
          ownerId: source.ownerId ?? userId,
          teamId: source.teamId,
          source: source.source,
          customFields: source.customFields as Prisma.InputJsonValue,
          createdById: userId,
          updatedById: userId,
        },
      });

      if (source.jobSkills.length > 0) {
        await tx.jobSkill.createMany({
          data: source.jobSkills.map((skill) => ({
            tenantId,
            jobId: created.id,
            skillId: skill.skillId,
            weight: skill.weight,
            required: skill.required,
            minYears: skill.minYears,
          })),
          skipDuplicates: true,
        });
      }

      return created;
    });

    if (input.clonePipeline) await this.pipeline.copyTenantStagesToJob(job.id);

    await this.logActivity(job.id, 'Cloned requisition', `Cloned from ${source.referenceCode}`);
    await this.audit.record({
      action: 'CREATE',
      entity: 'Job',
      entityId: job.id,
      description: `Cloned job ${source.referenceCode} → ${job.referenceCode}`,
    });

    return this.detail(job.id);
  }

  async changeStatus(jobId: string, input: ChangeJobStatusRequest): Promise<JobDetail> {
    const job = await this.findJobOrFail(jobId);
    if (job.status === input.status) return this.detail(jobId);

    const allowed = JOB_STATUS_TRANSITIONS[job.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new ValidationError(
        `A ${statusLabel(job.status)} job cannot move to ${statusLabel(input.status)}.`,
        { from: job.status, to: input.status, allowed },
      );
    }

    const now = new Date();
    const data: Prisma.JobUncheckedUpdateInput = {
      status: input.status,
      updatedById: requestContext.userId ?? null,
    };

    if (input.status === 'OPEN') {
      data.openedAt = job.openedAt ?? now;
      data.closedAt = null;
      data.closedReason = null;
    }
    if (CLOSED_STATUSES.includes(input.status)) {
      data.closedAt = now;
      data.closedReason = input.reason ?? null;
    }

    await this.prisma.client.job.update({ where: { id: jobId }, data });

    await this.logActivity(
      jobId,
      `Status changed to ${statusLabel(input.status)}`,
      input.reason ?? `${statusLabel(job.status)} → ${statusLabel(input.status)}`,
    );
    await this.audit.record({
      action: 'STATUS_CHANGE',
      entity: 'Job',
      entityId: jobId,
      description: `${job.referenceCode}: ${job.status} → ${input.status}`,
    });

    return this.detail(jobId);
  }

  async assignRecruiters(jobId: string, input: AssignRecruitersRequest): Promise<JobDetail> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;
    const job = await this.findJobOrFail(jobId);

    const desired = dedupeAssignments(input.assignments);
    await this.assertUsersExist(desired.map((entry) => entry.userId));

    const current = await this.prisma.client.jobAssignment.findMany({
      where: { jobId },
      select: { userId: true },
    });
    const currentIds = new Set(current.map((entry) => entry.userId));
    const desiredIds = new Set(desired.map((entry) => entry.userId));

    const added = desired.filter((entry) => !currentIds.has(entry.userId));
    const removed = [...currentIds].filter((id) => !desiredIds.has(id));

    const operations: Prisma.PrismaPromise<unknown>[] = [];
    for (const entry of desired) {
      operations.push(
        this.prisma.client.jobAssignment.upsert({
          where: { jobId_userId: { jobId, userId: entry.userId } },
          update: { role: entry.role, isPrimary: entry.isPrimary },
          create: {
            tenantId,
            jobId,
            userId: entry.userId,
            role: entry.role,
            isPrimary: entry.isPrimary,
            assignedById: userId,
          },
        }),
      );
    }
    if (removed.length > 0) {
      operations.push(
        this.prisma.client.jobAssignment.deleteMany({ where: { jobId, userId: { in: removed } } }),
      );
    }
    if (operations.length > 0) await this.prisma.client.$transaction(operations);

    if (input.notify && added.length > 0) {
      const recipients = added.filter((entry) => entry.userId !== userId);
      if (recipients.length > 0) {
        await this.prisma.client.notification.createMany({
          data: recipients.map((entry) => ({
            tenantId,
            userId: entry.userId,
            type: 'job.assigned',
            channel: 'IN_APP' as const,
            title: 'You were added to a requisition',
            body: `${job.title} (${job.referenceCode})`,
            link: `/jobs/${jobId}`,
            actorId: userId,
            entityType: 'JOB' as const,
            entityId: jobId,
          })),
        });
      }
    }

    await this.audit.record({
      action: 'UPDATE',
      entity: 'JobAssignment',
      entityId: jobId,
      description: `Set recruiters on ${job.referenceCode}`,
    });

    return this.detail(jobId);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private buildWhere(query: JobQuery): Prisma.JobWhereInput {
    const userId = requireUser();
    const context = requestContext.getOrThrow();
    const and: Prisma.JobWhereInput[] = [];

    // Records the caller may see: everything when they hold `job:read_all`,
    // only their own otherwise. `myJobs` narrows an all-access user the same way.
    const canReadAll = context.isSuperAdmin || hasPermission(context.permissions, 'job:read_all');
    if (!canReadAll || query.myJobs) {
      and.push({ OR: [{ ownerId: userId }, { assignments: { some: { userId } } }] });
    }

    const statuses = toArray(query.status);
    if (statuses.length > 0) and.push({ status: { in: statuses } });

    const priorities = toArray(query.priority);
    if (priorities.length > 0) {
      and.push({ priority: { in: priorities } });
    } else if (query.hot) {
      and.push({ priority: { in: ['HIGH', 'URGENT'] satisfies Priority[] } });
    }

    const jobTypes = toArray(query.jobType);
    if (jobTypes.length > 0) and.push({ jobType: { in: jobTypes } });

    const remoteTypes = toArray(query.remoteType);
    if (remoteTypes.length > 0) and.push({ remoteType: { in: remoteTypes } });

    if (query.clientId) and.push({ clientId: query.clientId });
    if (query.ownerId) and.push({ ownerId: query.ownerId });
    if (query.teamId) and.push({ teamId: query.teamId });
    if (query.recruiterId) and.push({ assignments: { some: { userId: query.recruiterId } } });

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

    if (query.skillIds && query.skillIds.length > 0) {
      and.push({ jobSkills: { some: { skillId: { in: query.skillIds } } } });
    }

    if (query.createdFrom || query.createdTo) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.createdFrom) createdAt.gte = query.createdFrom;
      if (query.createdTo) createdAt.lte = query.createdTo;
      and.push({ createdAt });
    }

    if (query.dueBefore) and.push({ targetFillAt: { lte: query.dueBefore } });

    if (query.q) {
      const like = { contains: query.q, mode: 'insensitive' as const };
      and.push({
        OR: [
          { title: like },
          { referenceCode: like },
          { locationCity: like },
          { description: like },
        ],
      });
    }

    return and.length > 0 ? { deletedAt: null, AND: and } : { deletedAt: null };
  }

  private async findJobOrFail(jobId: string): Promise<{
    id: string;
    title: string;
    referenceCode: string;
    status: JobStatus;
    openedAt: Date | null;
    clientId: string | null;
    payRateMinCents: number | null;
    payRateMaxCents: number | null;
    billRateCents: number | null;
  }> {
    const job = await this.prisma.client.job.findFirst({
      where: { id: jobId, deletedAt: null },
      select: {
        id: true,
        title: true,
        referenceCode: true,
        status: true,
        openedAt: true,
        clientId: true,
        payRateMinCents: true,
        payRateMaxCents: true,
        billRateCents: true,
      },
    });
    if (!job) throw new NotFoundError('Job', jobId);
    return job;
  }

  private async assertClientExists(clientId: string | null | undefined): Promise<void> {
    if (!clientId) return;
    const client = await this.prisma.client.client.findFirst({
      where: { id: clientId, deletedAt: null },
      select: { id: true },
    });
    if (!client) throw new ValidationError('That client does not exist.', { clientId });
  }

  private async assertContactBelongsToClient(
    contactId: string | null | undefined,
    clientId: string | null | undefined,
  ): Promise<void> {
    if (!contactId) return;
    const contact = await this.prisma.client.clientContact.findFirst({
      where: { id: contactId, deletedAt: null },
      select: { id: true, clientId: true },
    });
    if (!contact) throw new ValidationError('That contact does not exist.', { contactId });
    if (clientId && contact.clientId !== clientId) {
      throw new ValidationError('That contact does not belong to the selected client.', {
        contactId,
        clientId,
      });
    }
  }

  private async assertTeamExists(teamId: string | null | undefined): Promise<void> {
    if (!teamId) return;
    const team = await this.prisma.client.team.findFirst({
      where: { id: teamId, deletedAt: null },
      select: { id: true },
    });
    if (!team) throw new ValidationError('That team does not exist.', { teamId });
  }

  private async assertUsersExist(userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;

    const found = await this.prisma.client.user.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true },
    });

    const missing = unique.filter((id) => !found.some((user) => user.id === id));
    if (missing.length > 0) {
      throw new ValidationError('Some of those users do not exist.', { userIds: missing });
    }
  }

  private async assertSkillsExist(skillIds: string[]): Promise<void> {
    const unique = [...new Set(skillIds)];
    if (unique.length === 0) return;

    const found = await this.prisma.client.skill.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true },
    });

    const missing = unique.filter((id) => !found.some((skill) => skill.id === id));
    if (missing.length > 0) {
      throw new ValidationError('Some of those skills do not exist.', { skillIds: missing });
    }
  }

  private async applicantCounts(jobIds: string[]): Promise<Map<string, number>> {
    if (jobIds.length === 0) return new Map();
    const grouped = await this.prisma.client.application.groupBy({
      by: ['jobId'],
      where: { jobId: { in: jobIds }, deletedAt: null },
      _count: { _all: true },
    });
    return new Map(grouped.map((row) => [row.jobId, row._count._all]));
  }

  private async newApplicantCounts(jobIds: string[]): Promise<Map<string, number>> {
    if (jobIds.length === 0) return new Map();
    const since = new Date(Date.now() - NEW_APPLICANT_DAYS * 86_400_000);
    const grouped = await this.prisma.client.application.groupBy({
      by: ['jobId'],
      where: { jobId: { in: jobIds }, deletedAt: null, appliedAt: { gte: since } },
      _count: { _all: true },
    });
    return new Map(grouped.map((row) => [row.jobId, row._count._all]));
  }

  private async logActivity(jobId: string, subject: string, body?: string): Promise<void> {
    const tenantId = requireTenant();
    await this.prisma.client.activity.create({
      data: {
        tenantId,
        type: 'SYSTEM',
        subject,
        body: body ?? null,
        entityType: 'JOB',
        entityId: jobId,
        jobId,
        createdById: requestContext.userId ?? null,
      },
    });
  }
}

// -----------------------------------------------------------------------------
// Sequencer
// -----------------------------------------------------------------------------

/**
 * Allocates the next `JOB-####` counter for a tenant.
 *
 * The no-op `upsert` guarantees the row exists, then the `increment` update is
 * a single statement that takes a row lock, so two parallel creates inside
 * their own transactions serialise and can never read the same value. Both
 * writes carry `tenantId` explicitly, so they stay correct even on the
 * transaction client where the tenant extension is not applied.
 */
async function nextJobSequence(
  tx: TenantTransactionClient,
  tenantId: string,
): Promise<number> {
  await tx.tenantSequence.upsert({
    where: { tenantId_key: { tenantId, key: JOB_SEQUENCE_KEY } },
    update: {},
    create: { tenantId, key: JOB_SEQUENCE_KEY, value: 0 },
  });

  const next = await tx.tenantSequence.update({
    where: { tenantId_key: { tenantId, key: JOB_SEQUENCE_KEY } },
    data: { value: { increment: 1 } },
    select: { value: true },
  });

  return next.value;
}

/** `1` → `JOB-0001`. */
function formatJobReference(sequence: number): string {
  return `${JOB_SEQUENCE_KEY}-${String(sequence).padStart(4, '0')}`;
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
  if (required.endsWith('_own')) {
    return granted.includes(`${required.replace(/_own$/, '')}_all`);
  }
  return false;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function compact(values: (string | null | undefined)[]): string[] {
  return values.filter((value): value is string => Boolean(value));
}

/** Chooses the incoming value when the patch supplied one, else keeps what is stored. */
function pick<T>(incoming: T | null | undefined, stored: T | null): T | null {
  return incoming === undefined ? stored : (incoming ?? null);
}

function computeMargin(
  payMin: number | null | undefined,
  payMax: number | null | undefined,
  bill: number | null | undefined,
): { marginCents: number | null; marginPercentage: number | null } {
  const pay = payMax ?? payMin ?? null;
  if (pay === null || bill === null || bill === undefined || bill <= 0) {
    return { marginCents: null, marginPercentage: null };
  }
  const marginCents = bill - pay;
  return { marginCents, marginPercentage: round2((marginCents / bill) * 100) };
}

function dedupeAssignments(
  assignments: AssignRecruitersRequest['assignments'],
): AssignRecruitersRequest['assignments'] {
  const byUser = new Map<string, AssignRecruitersRequest['assignments'][number]>();
  for (const entry of assignments) byUser.set(entry.userId, entry);
  return [...byUser.values()];
}

function buildOrderBy(query: JobQuery): Prisma.JobOrderByWithRelationInput[] {
  const dir = query.sortDir;
  switch (query.sortBy) {
    case 'title':
      return [{ title: dir }];
    case 'status':
      return [{ status: dir }];
    case 'priority':
      return [{ priority: dir }];
    case 'targetFillAt':
      return [{ targetFillAt: dir }];
    case 'openedAt':
      return [{ openedAt: dir }];
    case 'applicantCount':
      return [{ applications: { _count: dir } }];
    case 'updatedAt':
      return [{ updatedAt: dir }];
    default:
      return [{ createdAt: dir }];
  }
}

function toJobListOwner(owner: {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
} | null): JobListOwner | null {
  if (!owner) return null;
  return {
    id: owner.id,
    fullName: `${owner.firstName} ${owner.lastName}`.trim(),
    avatarUrl: owner.avatarUrl,
  };
}

function toJobListSkills(skills: JobWithList['jobSkills']): JobListSkill[] {
  return skills.map((entry) => ({
    id: entry.skill.id,
    name: entry.skill.name,
    required: entry.required,
  }));
}

function toJobListItem(
  job: JobWithList,
  applicantCount: number,
  newApplicantCount: number,
): JobListItem {
  return {
    id: job.id,
    title: job.title,
    referenceCode: job.referenceCode,
    status: job.status,
    priority: job.priority,
    jobType: job.jobType,
    remoteType: job.remoteType,
    client: job.client ? { id: job.client.id, name: job.client.name } : null,
    owner: toJobListOwner(job.owner),
    location: composeLocation(job.locationCity, job.locationState, job.locationCountry),
    openings: job.openings,
    filledCount: job.filledCount,
    currency: job.currency,
    payRateMinCents: job.payRateMinCents,
    payRateMaxCents: job.payRateMaxCents,
    rateType: job.rateType,
    isHot: job.priority === 'HIGH' || job.priority === 'URGENT',
    applicantCount,
    newApplicantCount,
    skills: toJobListSkills(job.jobSkills),
    openedAt: job.openedAt?.toISOString() ?? null,
    targetFillAt: job.targetFillAt?.toISOString() ?? null,
    closedAt: job.closedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

function toJobDetail(
  job: JobWithDetail,
  pipeline: JobPipelineStageSummary[],
  applicantCount: number,
  newApplicantCount: number,
  hasCustomPipeline: boolean,
): JobDetail {
  return {
    ...toJobListItem(job, applicantCount, newApplicantCount),
    contact: job.contact
      ? {
          id: job.contact.id,
          fullName: `${job.contact.firstName} ${job.contact.lastName}`.trim(),
          email: job.contact.email,
        }
      : null,
    teamId: job.teamId,
    description: job.description,
    requirements: job.requirements,
    responsibilities: job.responsibilities,
    locationCity: job.locationCity,
    locationState: job.locationState,
    locationCountry: job.locationCountry,
    payRateMinCents: job.payRateMinCents,
    payRateMaxCents: job.payRateMaxCents,
    billRateCents: job.billRateCents,
    billRateType: job.billRateType,
    marginCents: job.marginCents,
    marginPercentage: job.marginPercentage === null ? null : job.marginPercentage.toNumber(),
    minExperienceYears: job.minExperienceYears,
    maxExperienceYears: job.maxExperienceYears,
    educationLevel: job.educationLevel,
    workAuthorizations: job.workAuthorizations,
    visaSponsorship: job.visaSponsorship,
    source: job.source,
    externalId: job.externalId,
    closedReason: job.closedReason,
    customFields: (job.customFields ?? {}) as Record<string, unknown>,
    assignments: job.assignments.map((assignment) => ({
      userId: assignment.user.id,
      fullName: `${assignment.user.firstName} ${assignment.user.lastName}`.trim(),
      avatarUrl: assignment.user.avatarUrl,
      role: assignment.role,
      isPrimary: assignment.isPrimary,
    })),
    skills: job.jobSkills.map((entry) => ({
      id: entry.skill.id,
      name: entry.skill.name,
      required: entry.required,
      weight: entry.weight,
      minYears: entry.minYears,
    })),
    pipeline,
    hasCustomPipeline,
  };
}

function toStageSummary(stage: PipelineStageItem): JobPipelineStageSummary {
  return {
    id: stage.id,
    key: stage.key,
    name: stage.name,
    type: stage.type,
    category: stage.category,
    color: stage.color,
    order: stage.order,
    isTerminal: stage.isTerminal,
    slaDays: stage.slaDays,
    applicationCount: stage.applicationCount,
  };
}

function composeLocation(
  city: string | null,
  state: string | null,
  country: string | null,
): string | null {
  const parts = [city, state, country].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(', ') : null;
}

function statusLabel(status: JobStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
