'use client';

import { CalendarClock, Link2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  ENTITY_TYPE_LABELS,
  PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type Priority,
  type TaskListItem,
  type TaskStatus,
} from '@talentflow/types';
import { cn, formatRelativeTime, getInitials } from '@talentflow/ui';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DialogTrigger } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const PRIORITY_VARIANT: Record<Priority, BadgeProps['variant']> = {
  LOW: 'muted',
  MEDIUM: 'secondary',
  HIGH: 'warning',
  URGENT: 'destructive',
};

const STATUS_VARIANT: Record<TaskStatus, BadgeProps['variant']> = {
  OPEN: 'info',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'muted',
};

/** Where a task's polymorphic link should navigate, when there is a page for it. */
export function taskEntityHref(task: TaskListItem): string | null {
  if (!task.entityType || !task.entityId) return null;
  switch (task.entityType) {
    case 'CANDIDATE':
      return `/candidates/${task.entityId}`;
    case 'JOB':
      return `/jobs/${task.entityId}`;
    case 'APPLICATION':
      return `/applications/${task.entityId}`;
    case 'CLIENT':
      return `/clients/${task.entityId}`;
    default:
      return null;
  }
}

export function TaskPriorityBadge({ priority }: { priority: Priority }) {
  return <Badge variant={PRIORITY_VARIANT[priority]}>{PRIORITY_LABELS[priority]}</Badge>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{TASK_STATUS_LABELS[status]}</Badge>;
}

/** Relative due date, red once the API has flagged the task as overdue. */
export function TaskDueDate({ task }: { task: TaskListItem }) {
  if (!task.dueAt) {
    return <span className="text-xs text-muted-foreground">No due date</span>;
  }
  return (
    <span
      className={cn(
        'whitespace-nowrap text-xs',
        task.isOverdue ? 'font-medium text-destructive' : 'text-muted-foreground',
      )}
    >
      {task.isOverdue ? 'Overdue · ' : ''}
      {formatRelativeTime(task.dueAt)}
    </span>
  );
}

export function TaskAssignee({
  assignee,
}: {
  assignee: TaskListItem['assignee'];
}) {
  if (!assignee) {
    return <span className="text-xs text-muted-foreground">Unassigned</span>;
  }
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <Avatar className="size-5">
        {assignee.avatarUrl ? <AvatarImage src={assignee.avatarUrl} alt="" /> : null}
        <AvatarFallback className="text-[9px]">{getInitials(assignee.fullName)}</AvatarFallback>
      </Avatar>
      <span className="truncate">{assignee.fullName}</span>
    </span>
  );
}

/** The record a task hangs off, with a deep link when one exists. */
export function TaskEntityLink({ task }: { task: TaskListItem }) {
  if (!task.entityType) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const label = ENTITY_TYPE_LABELS[task.entityType];
  const href = taskEntityHref(task);
  if (!href) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Link2 className="size-3" aria-hidden="true" />
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary hover:underline"
    >
      <Link2 className="size-3" aria-hidden="true" />
      {label}
    </Link>
  );
}

interface TaskCompleteCheckboxProps {
  task: TaskListItem;
  disabled?: boolean;
  onComplete: (task: TaskListItem) => void;
}

/** Ticking the box completes the task; completed rows cannot be unticked. */
export function TaskCompleteCheckbox({ task, disabled, onComplete }: TaskCompleteCheckboxProps) {
  const completed = task.status === 'COMPLETED' || task.status === 'CANCELLED';
  return (
    <Checkbox
      checked={completed}
      disabled={disabled || completed}
      aria-label={completed ? `${task.title} is complete` : `Complete ${task.title}`}
      onCheckedChange={(checked) => {
        if (checked === true && !completed) onComplete(task);
      }}
    />
  );
}

interface TaskRowActionsProps {
  task: TaskListItem;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: (task: TaskListItem) => void;
  onDelete: (task: TaskListItem) => void;
  deleting?: boolean;
}

/** The "⋯" menu: edit and delete, each gated by its own permission. */
export function TaskRowActions({
  task,
  canUpdate,
  canDelete,
  onEdit,
  onDelete,
  deleting,
}: TaskRowActionsProps) {
  if (!canUpdate && !canDelete) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${task.title}`}>
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {canUpdate ? (
          <DropdownMenuItem onSelect={() => onEdit(task)}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit
          </DropdownMenuItem>
        ) : null}
        {canDelete ? (
          <>
            <DropdownMenuSeparator />
            <ConfirmDialog
              destructive
              title="Delete this task?"
              description="It is removed from every list, including the My Day panel. This cannot be undone."
              confirmLabel="Delete task"
              trigger={
                <DialogTrigger asChild>
                  <DropdownMenuItem
                    destructive
                    disabled={deleting}
                    onSelect={(event) => event.preventDefault()}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    Delete
                  </DropdownMenuItem>
                </DialogTrigger>
              }
              onConfirm={() => {
                onDelete(task);
              }}
            />
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface TaskListProps {
  tasks: readonly TaskListItem[];
  canComplete?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;
  onComplete?: (task: TaskListItem) => void;
  onEdit?: (task: TaskListItem) => void;
  onDelete?: (task: TaskListItem) => void;
  deletingId?: string | null;
  empty?: ReactNode;
  className?: string;
}

/**
 * The compact task list shared by the My Day panel and any surface that wants a
 * lighter-weight rendering than the page's `DataTable`.
 */
export function TaskList({
  tasks,
  canComplete = false,
  canUpdate = false,
  canDelete = false,
  onComplete,
  onEdit,
  onDelete,
  deletingId,
  empty,
  className,
}: TaskListProps) {
  if (tasks.length === 0) return <>{empty ?? null}</>;

  return (
    <ul className={cn('divide-y divide-border', className)}>
      {tasks.map((task) => (
        <li key={task.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
          {canComplete && onComplete ? (
            <TaskCompleteCheckbox
              task={task}
              disabled={deletingId === task.id}
              onComplete={onComplete}
            />
          ) : null}

          <div className="min-w-0 flex-1 space-y-0.5">
            <p
              className={cn(
                'truncate text-sm font-medium',
                task.status === 'COMPLETED' && 'text-muted-foreground line-through',
              )}
            >
              {task.title}
            </p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <TaskDueDate task={task} />
              <TaskEntityLink task={task} />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <TaskPriorityBadge priority={task.priority} />
            <TaskStatusBadge status={task.status} />
            {canUpdate || canDelete ? (
              <TaskRowActions
                task={task}
                canUpdate={canUpdate}
                canDelete={canDelete}
                onEdit={onEdit ?? (() => undefined)}
                onDelete={onDelete ?? (() => undefined)}
                deleting={deletingId === task.id}
              />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Shared empty placeholder for a task list. */
export function TaskListEmpty({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
      <CalendarClock className="size-4" aria-hidden="true" />
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <p className="text-xs">{description}</p> : null}
      </div>
    </div>
  );
}
