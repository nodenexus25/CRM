import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildPaginationMeta,
  toSkipTake,
  type CreateTaskRequest,
  type EntityType,
  type MyDay,
  type MyDayInterview,
  type Paginated,
  type TaskListItem,
  type TaskQuery,
  type UpdateTaskRequest,
} from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import { ForbiddenError, NotFoundError, ValidationError } from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import { PrismaService } from '@/infra/prisma/prisma.service';

/**
 * The task rows the list mapper renders. `_count.subTasks` is what drives the
 * disclosure affordance, so every read that feeds a `TaskListItem` must ask for
 * it — hence one shared include rather than a per-call select.
 */
const TASK_INCLUDE = {
  _count: { select: { subTasks: true } },
} as const satisfies Prisma.TaskInclude;

type TaskRow = Prisma.TaskGetPayload<{
  include: { _count: { select: { subTasks: true } } };
}>;

/** The lean join My Day needs to label today's interviews. */
const MY_DAY_INTERVIEW_INCLUDE = {
  application: {
    select: {
      id: true,
      job: { select: { title: true } },
      candidate: { select: { firstName: true, lastName: true } },
    },
  },
} as const satisfies Prisma.InterviewInclude;

type MyDayInterviewRow = Prisma.InterviewGetPayload<{
  include: typeof MY_DAY_INTERVIEW_INCLUDE;
}>;

type UserBrief = { id: string; fullName: string; avatarUrl: string | null };

/** The statuses a task is finished with, used to keep "open work" queries honest. */
const CLOSED_STATUSES = ['COMPLETED', 'CANCELLED'] as const;

/**
 * Tasks — the daily to-do surface.
 *
 * A task optionally hangs off a record (`entityType` + `entityId`) and always
 * optionally has an assignee, a due date and a reminder. `My Day` is a read
 * model assembled from tasks, today's interviews and the overdue backlog rather
 * than its own table.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async list(query: TaskQuery): Promise<Paginated<TaskListItem>> {
    const where = buildWhere(query);
    const now = Date.now();

    const [rows, total] = await Promise.all([
      this.prisma.client.task.findMany({
        where,
        include: TASK_INCLUDE,
        orderBy: buildOrderBy(query),
        ...toSkipTake(query),
      }),
      this.prisma.client.task.count({ where }),
    ]);

    const users = await this.loadUsers([
      ...rows.map((row) => row.assigneeId),
      ...rows.map((row) => row.createdById),
    ]);

    return {
      items: rows.map((row) => toTaskItem(row, users, now)),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  /**
   * One round-trip for the dashboard panel: what is late, what is due today and
   * who the caller is interviewing.
   */
  async myDay(): Promise<MyDay> {
    const caller = requestContext.userId;
    if (!caller) throw new ForbiddenError('My Day is only available to a signed-in user.');

    // The window is a UTC day; `end` is exclusive so midnight is counted once.
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const unfinished = { notIn: [...CLOSED_STATUSES] } satisfies Prisma.EnumTaskStatusFilter;

    const [tasks, overdueTasks, interviewRows, open, inProgress, dueToday, overdue, completedToday] =
      await Promise.all([
        this.prisma.client.task.findMany({
          where: {
            deletedAt: null,
            assigneeId: caller,
            status: unfinished,
            dueAt: { gte: start, lt: end },
          },
          include: TASK_INCLUDE,
          orderBy: { dueAt: 'asc' },
        }),
        this.prisma.client.task.findMany({
          where: {
            deletedAt: null,
            assigneeId: caller,
            status: unfinished,
            dueAt: { lt: start },
          },
          include: TASK_INCLUDE,
          orderBy: { dueAt: 'asc' },
          take: 20,
        }),
        this.prisma.client.interview.findMany({
          where: {
            deletedAt: null,
            status: { not: 'CANCELLED' },
            scheduledStart: { gte: start, lt: end },
            interviewers: { some: { userId: caller } },
          },
          include: MY_DAY_INTERVIEW_INCLUDE,
          orderBy: { scheduledStart: 'asc' },
        }),
        this.prisma.client.task.count({
          where: { deletedAt: null, assigneeId: caller, status: 'OPEN' },
        }),
        this.prisma.client.task.count({
          where: { deletedAt: null, assigneeId: caller, status: 'IN_PROGRESS' },
        }),
        this.prisma.client.task.count({
          where: {
            deletedAt: null,
            assigneeId: caller,
            status: unfinished,
            dueAt: { gte: start, lt: end },
          },
        }),
        this.prisma.client.task.count({
          where: { deletedAt: null, assigneeId: caller, status: unfinished, dueAt: { lt: start } },
        }),
        this.prisma.client.task.count({
          where: {
            deletedAt: null,
            assigneeId: caller,
            status: 'COMPLETED',
            completedAt: { gte: start, lt: end },
          },
        }),
      ]);

    const users = await this.loadUsers([
      ...tasks.map((row) => row.assigneeId),
      ...tasks.map((row) => row.createdById),
      ...overdueTasks.map((row) => row.assigneeId),
      ...overdueTasks.map((row) => row.createdById),
    ]);
    const now = Date.now();

    return {
      date: start.toISOString(),
      tasks: tasks.map((row) => toTaskItem(row, users, now)),
      overdueTasks: overdueTasks.map((row) => toTaskItem(row, users, now)),
      interviews: interviewRows.map(toMyDayInterview),
      stats: { open, inProgress, dueToday, overdue, completedToday },
    };
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  async create(input: CreateTaskRequest): Promise<TaskListItem> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;

    await this.assertReferencesExist(input);

    const created = await this.prisma.client.task.create({
      data: {
        tenantId,
        title: input.title,
        description: input.description ?? null,
        status: input.status,
        priority: input.priority,
        dueAt: input.dueAt ?? null,
        reminderAt: input.reminderAt ?? null,
        // An explicit `null` is a deliberate "nobody" — only an omitted value
        // falls back to the caller.
        assigneeId: input.assigneeId === undefined ? userId : input.assigneeId,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        candidateId: input.candidateId ?? null,
        jobId: input.jobId ?? null,
        parentTaskId: input.parentTaskId ?? null,
        createdById: userId,
        updatedById: userId,
      },
      include: TASK_INCLUDE,
    });

    await this.audit.record({
      action: 'CREATE',
      entity: 'Task',
      entityId: created.id,
      description: 'Created a task',
    });

    const users = await this.loadUsers([created.assigneeId, created.createdById]);
    return toTaskItem(created, users);
  }

  async update(taskId: string, input: UpdateTaskRequest): Promise<TaskListItem> {
    const existing = await this.prisma.client.task.findFirst({
      where: { id: taskId, deletedAt: null },
      select: { id: true, assigneeId: true },
    });
    if (!existing) throw new NotFoundError('Task', taskId);

    if (input.assigneeId !== undefined && input.assigneeId !== existing.assigneeId) {
      assertCanAssign();
    }

    await this.assertReferencesExist(input);

    const updated = await this.prisma.client.task.update({
      where: { id: taskId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
        ...(input.reminderAt !== undefined ? { reminderAt: input.reminderAt } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.entityType !== undefined ? { entityType: input.entityType } : {}),
        ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
        ...(input.candidateId !== undefined ? { candidateId: input.candidateId } : {}),
        ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
        ...(input.parentTaskId !== undefined ? { parentTaskId: input.parentTaskId } : {}),
        updatedById: requestContext.userId ?? null,
      },
      include: TASK_INCLUDE,
    });

    await this.audit.record({
      action: 'UPDATE',
      entity: 'Task',
      entityId: taskId,
      description: 'Updated a task',
    });

    const users = await this.loadUsers([updated.assigneeId, updated.createdById]);
    return toTaskItem(updated, users);
  }

  /** Ticking a task off is idempotent — completing a completed task is a no-op. */
  async complete(taskId: string): Promise<TaskListItem> {
    const existing = await this.prisma.client.task.findFirst({
      where: { id: taskId, deletedAt: null },
      include: TASK_INCLUDE,
    });
    if (!existing) throw new NotFoundError('Task', taskId);

    const completed: TaskRow =
      existing.status === 'COMPLETED'
        ? existing
        : await this.prisma.client.task.update({
            where: { id: taskId },
            data: {
              status: 'COMPLETED',
              completedAt: new Date(),
              updatedById: requestContext.userId ?? null,
            },
            include: TASK_INCLUDE,
          });

    await this.audit.record({
      action: 'STATUS_CHANGE',
      entity: 'Task',
      entityId: taskId,
      description: 'Completed a task',
    });

    const users = await this.loadUsers([completed.assigneeId, completed.createdById]);
    return toTaskItem(completed, users);
  }

  async remove(taskId: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.client.task.findFirst({
      where: { id: taskId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError('Task', taskId);

    await this.prisma.client.task.update({
      where: { id: taskId },
      data: { deletedAt: new Date(), updatedById: requestContext.userId ?? null },
    });

    await this.audit.record({
      action: 'DELETE',
      entity: 'Task',
      entityId: taskId,
      description: 'Deleted a task',
    });

    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Every task reference except `assigneeId` is a bare, unenforced id (there is
   * no foreign key on `jobId` at all), so a stale value would otherwise be
   * stored silently. Validate them and surface a 422 instead.
   */
  private async assertReferencesExist(input: TaskReferenceInput): Promise<void> {
    if (input.entityType && !input.entityId) {
      throw new ValidationError('Provide the record id alongside the entity type.', {
        entityType: input.entityType,
      });
    }
    if (input.entityId && !input.entityType) {
      throw new ValidationError('Provide the entity type alongside the record id.', {
        entityId: input.entityId,
      });
    }

    if (input.assigneeId) {
      const user = await this.prisma.client.user.findFirst({
        where: { id: input.assigneeId, deletedAt: null },
        select: { id: true },
      });
      if (!user) throw new ValidationError('That assignee does not exist.', { assigneeId: input.assigneeId });
    }

    if (input.candidateId) {
      const candidate = await this.prisma.client.candidate.findFirst({
        where: { id: input.candidateId, deletedAt: null },
        select: { id: true },
      });
      if (!candidate) throw new ValidationError('That candidate does not exist.', { candidateId: input.candidateId });
    }

    if (input.jobId) {
      const job = await this.prisma.client.job.findFirst({
        where: { id: input.jobId, deletedAt: null },
        select: { id: true },
      });
      if (!job) throw new ValidationError('That job does not exist.', { jobId: input.jobId });
    }

    if (input.parentTaskId) {
      const parent = await this.prisma.client.task.findFirst({
        where: { id: input.parentTaskId, deletedAt: null },
        select: { id: true },
      });
      if (!parent) throw new ValidationError('That parent task does not exist.', { parentTaskId: input.parentTaskId });
    }
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

/** The reference fields both the create and update payloads carry. */
type TaskReferenceInput = {
  assigneeId?: string | null;
  candidateId?: string | null;
  jobId?: string | null;
  parentTaskId?: string | null;
  entityType?: EntityType | null;
  entityId?: string | null;
};

function buildWhere(query: TaskQuery): Prisma.TaskWhereInput {
  const and: Prisma.TaskWhereInput[] = [];

  const statuses = toArray(query.status);
  if (statuses.length > 0) and.push({ status: { in: statuses } });

  const priorities = toArray(query.priority);
  if (priorities.length > 0) and.push({ priority: { in: priorities } });

  // `assigneeId=me` reads the caller off the context rather than trusting a
  // query param, and falls back to a value no row can hold so an anonymous
  // caller matches nothing instead of everything.
  if (query.assigneeId) {
    const assigneeId =
      query.assigneeId === 'me'
        ? requestContext.userId ?? '__unauthenticated__'
        : query.assigneeId;
    and.push({ assigneeId });
  }

  // `dueAfter`/`dueBefore` are exclusive bounds; `overdue` is the "unfinished
  // and already late" shortcut the dashboard uses.
  if (query.dueAfter) and.push({ dueAt: { gt: query.dueAfter } });
  if (query.dueBefore) and.push({ dueAt: { lt: query.dueBefore } });
  if (query.overdue) {
    and.push({ dueAt: { lt: new Date() } });
    and.push({ status: { notIn: [...CLOSED_STATUSES] } });
  }

  if (query.entityType) and.push({ entityType: query.entityType });
  if (query.entityId) and.push({ entityId: query.entityId });
  if (query.candidateId) and.push({ candidateId: query.candidateId });
  if (query.jobId) and.push({ jobId: query.jobId });
  if (query.parentTaskId) and.push({ parentTaskId: query.parentTaskId });
  if (query.rootOnly) and.push({ parentTaskId: null });

  return and.length > 0 ? { deletedAt: null, AND: and } : { deletedAt: null };
}

function buildOrderBy(query: TaskQuery): Prisma.TaskOrderByWithRelationInput[] {
  switch (query.sortBy) {
    case 'createdAt':
      return [{ createdAt: query.sortDir }];
    case 'updatedAt':
      return [{ updatedAt: query.sortDir }, { createdAt: 'desc' }];
    default:
      // Undated work is not "due", so it sorts to the end rather than the top.
      return [{ dueAt: { sort: query.sortDir, nulls: 'last' } }, { createdAt: 'desc' }];
  }
}

function toTaskItem(row: TaskRow, users: Map<string, UserBrief>, now = Date.now()): TaskListItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    reminderAt: row.reminderAt ? row.reminderAt.toISOString() : null,
    isOverdue: isOverdue(row, now),
    assignee: resolveUser(row.assigneeId, users),
    entityType: row.entityType,
    entityId: row.entityId,
    candidateId: row.candidateId,
    jobId: row.jobId,
    parentTaskId: row.parentTaskId,
    subTaskCount: row._count.subTasks,
    createdBy: resolveUser(row.createdById, users),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMyDayInterview(row: MyDayInterviewRow): MyDayInterview {
  const jobTitle = row.application.job.title;
  return {
    id: row.id,
    title: row.title ?? jobTitle,
    type: row.type,
    status: row.status,
    scheduledStart: row.scheduledStart.toISOString(),
    scheduledEnd: row.scheduledEnd.toISOString(),
    timezone: row.timezone,
    durationMinutes: row.durationMinutes,
    meetingUrl: row.meetingUrl,
    location: row.location,
    applicationId: row.application.id,
    candidateName: composeName(
      row.application.candidate.firstName,
      row.application.candidate.lastName,
    ),
    jobTitle,
  };
}

/** Late only counts while the task is still outstanding. */
function isOverdue(row: TaskRow, now: number): boolean {
  if (!row.dueAt) return false;
  if (row.status === 'COMPLETED' || row.status === 'CANCELLED') return false;
  return row.dueAt.getTime() < now;
}

function resolveUser(id: string | null, users: Map<string, UserBrief>): UserBrief | null {
  if (!id) return null;
  return users.get(id) ?? null;
}

function assertCanAssign(): void {
  const permissions = requestContext.get()?.permissions ?? [];
  if (!permissions.includes('task:assign')) {
    throw new ForbiddenError('You need the “assign tasks” permission to reassign a task.');
  }
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
