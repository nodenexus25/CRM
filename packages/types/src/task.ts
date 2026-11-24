import { z } from 'zod';

import { entityTypeSchema, type EntityType } from './activity';
import { idSchema, paginationQuerySchema, sortDirSchema } from './common';
import {
  prioritySchema,
  taskStatusSchema,
  type InterviewStatus,
  type InterviewType,
  type Priority,
  type TaskStatus,
} from './enums';

/**
 * Tasks — the daily to-do surface.
 *
 * A task optionally hangs off a record (`entityType` + `entityId`) and always
 * optionally has an assignee, a due date and a reminder. `My Day` is a read
 * model over tasks, interviews and overdue work rather than its own table.
 */

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Give the task a title').max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  status: taskStatusSchema.default('OPEN'),
  priority: prioritySchema.default('MEDIUM'),
  dueAt: z.coerce.date().nullable().optional(),
  reminderAt: z.coerce.date().nullable().optional(),
  /** Defaults to the caller when omitted. */
  assigneeId: idSchema.nullable().optional(),
  entityType: entityTypeSchema.nullable().optional(),
  entityId: idSchema.nullable().optional(),
  candidateId: idSchema.nullable().optional(),
  jobId: idSchema.nullable().optional(),
  parentTaskId: idSchema.nullable().optional(),
});
export type CreateTaskRequest = z.infer<typeof createTaskSchema>;

/**
 * Editing a task. Changing `assigneeId` needs `task:assign` (enforced in the
 * service), so a recruiter can tick their own work off without being able to
 * hand it to somebody else.
 */
export const updateTaskSchema = z.object({
  title: z.string().trim().min(1, 'Give the task a title').max(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  status: taskStatusSchema.optional(),
  priority: prioritySchema.optional(),
  dueAt: z.coerce.date().nullable().optional(),
  reminderAt: z.coerce.date().nullable().optional(),
  assigneeId: idSchema.nullable().optional(),
  entityType: entityTypeSchema.nullable().optional(),
  entityId: idSchema.nullable().optional(),
  candidateId: idSchema.nullable().optional(),
  jobId: idSchema.nullable().optional(),
  parentTaskId: idSchema.nullable().optional(),
});
export type UpdateTaskRequest = z.infer<typeof updateTaskSchema>;

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** `assigneeId=me` resolves to the caller, so the UI never has to know its id. */
export const taskAssigneeFilterSchema = z.union([z.literal('me'), idSchema]);
export type TaskAssigneeFilter = z.infer<typeof taskAssigneeFilterSchema>;

export const taskQuerySchema = paginationQuerySchema.extend({
  status: z.union([taskStatusSchema, z.array(taskStatusSchema)]).optional(),
  priority: z.union([prioritySchema, z.array(prioritySchema)]).optional(),
  assigneeId: taskAssigneeFilterSchema.optional(),
  /** Exclusive lower/upper bounds on `dueAt`, used by the list's date filter. */
  dueAfter: z.coerce.date().optional(),
  dueBefore: z.coerce.date().optional(),
  /** `true` keeps only unfinished work whose due date has already passed. */
  overdue: z.coerce.boolean().default(false),
  entityType: entityTypeSchema.optional(),
  entityId: idSchema.optional(),
  candidateId: idSchema.optional(),
  jobId: idSchema.optional(),
  parentTaskId: idSchema.optional(),
  /** Drop the subtasks a parent row already nests. */
  rootOnly: z.coerce.boolean().default(false),
  sortBy: z.enum(['dueAt', 'createdAt', 'updatedAt']).default('dueAt'),
  sortDir: sortDirSchema.default('asc'),
});
export type TaskQuery = z.infer<typeof taskQuerySchema>;

export interface TaskUserRef {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface TaskListItem {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueAt: string | null;
  completedAt: string | null;
  reminderAt: string | null;
  /** Derived server-side from `dueAt` so every surface agrees on "late". */
  isOverdue: boolean;
  assignee: TaskUserRef | null;
  entityType: EntityType | null;
  entityId: string | null;
  candidateId: string | null;
  jobId: string | null;
  parentTaskId: string | null;
  /** How many subtasks hang off this task, for the disclosure affordance. */
  subTaskCount: number;
  createdBy: TaskUserRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskStats {
  open: number;
  inProgress: number;
  dueToday: number;
  overdue: number;
  completedToday: number;
}

/** The lean shape the My Day panel needs for today's interviews. */
export interface MyDayInterview {
  id: string;
  title: string;
  type: InterviewType;
  status: InterviewStatus;
  scheduledStart: string;
  scheduledEnd: string;
  timezone: string;
  durationMinutes: number;
  meetingUrl: string | null;
  location: string | null;
  applicationId: string;
  candidateName: string;
  jobTitle: string;
}

/**
 * `GET /tasks/my-day` — one round-trip for the dashboard panel: what is late,
 * what is due today and who the user is interviewing today.
 */
export interface MyDay {
  /** Midnight UTC of the day the payload was built for. */
  date: string;
  tasks: TaskListItem[];
  overdueTasks: TaskListItem[];
  interviews: MyDayInterview[];
  stats: TaskStats;
}
