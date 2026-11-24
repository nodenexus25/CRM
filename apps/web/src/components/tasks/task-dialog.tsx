'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  PRIORITY_LABELS,
  createTaskSchema,
  prioritySchema,
  type EntityType,
  type Paginated,
  type TaskListItem,
  type UserListItem,
} from '@talentflow/types';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

/** Radix `Select` needs a concrete value for "leave it to the server". */
const UNASSIGNED = '__unassigned__';

/**
 * The form reuses the write schema's field constraints, but the `status` and
 * `priority` defaults are stripped because the form seeds them from
 * `defaultValues`, and the two dates are held as `datetime-local` strings here
 * (the API's `z.coerce.date()` rejects an empty string, so a blank date is
 * dropped from — or nulled in — the payload).
 */
const taskFormSchema = z.object({
  title: createTaskSchema.shape.title,
  description: z.string().trim().max(5000).optional(),
  priority: createTaskSchema.shape.priority.removeDefault(),
  dueAt: z.string().trim().optional(),
  reminderAt: z.string().trim().optional(),
  assigneeId: z.string().trim().optional(),
});

type TaskFormValues = z.infer<typeof taskFormSchema>;

const EMPTY_VALUES: TaskFormValues = {
  title: '',
  description: '',
  priority: 'MEDIUM',
  dueAt: '',
  reminderAt: '',
  assigneeId: UNASSIGNED,
};

/** ISO timestamp → the `yyyy-mm-ddThh:mm` a `datetime-local` input expects. */
function toDateTimeInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** A `datetime-local` string → ISO, or `null` so an emptied field is cleared. */
function toIsoOrNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided the dialog edits this task; otherwise it creates one. */
  task?: TaskListItem | null;
  /** The record a newly created task hangs off, if any. */
  entityType?: EntityType | null;
  entityId?: string | null;
  candidateId?: string | null;
  jobId?: string | null;
}

/**
 * Creates a task, or edits one already on the board. The assignee picker only
 * appears for callers who hold `task:assign`, so a recruiter can reschedule
 * their own work without being able to hand it to somebody else.
 */
export function TaskDialog({
  open,
  onOpenChange,
  task,
  entityType,
  entityId,
  candidateId,
  jobId,
}: TaskDialogProps) {
  const queryClient = useQueryClient();
  const { has } = useSession();
  const canAssign = has('task:assign');
  const isEdit = Boolean(task);

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  const users = useQuery({
    queryKey: queryKeys.users.list({ pageSize: 100, status: 'ACTIVE' }),
    queryFn: () =>
      api.get<Paginated<UserListItem>>('/users', { query: { pageSize: 100, status: 'ACTIVE' } }),
    enabled: open && canAssign,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) return;
    if (task) {
      form.reset({
        title: task.title,
        description: task.description ?? '',
        priority: task.priority,
        dueAt: toDateTimeInput(task.dueAt),
        reminderAt: toDateTimeInput(task.reminderAt),
        assigneeId: task.assignee?.id ?? UNASSIGNED,
      });
    } else {
      form.reset(EMPTY_VALUES);
    }
  }, [form, open, task]);

  const save = useMutation({
    mutationFn: (values: TaskFormValues) => {
      const description = (values.description ?? '').trim();
      const dueAt = toIsoOrNull(values.dueAt);
      const reminderAt = toIsoOrNull(values.reminderAt);
      const assigneeId =
        canAssign && values.assigneeId && values.assigneeId !== UNASSIGNED ? values.assigneeId : null;

      if (task) {
        return api.patch<TaskListItem>(`/tasks/${task.id}`, {
          title: values.title,
          description: description.length > 0 ? description : null,
          priority: values.priority,
          dueAt,
          reminderAt,
          ...(canAssign ? { assigneeId } : {}),
        });
      }

      return api.post<TaskListItem>('/tasks', {
        title: values.title,
        priority: values.priority,
        ...(description.length > 0 ? { description } : {}),
        ...(dueAt ? { dueAt } : {}),
        ...(reminderAt ? { reminderAt } : {}),
        ...(canAssign && assigneeId ? { assigneeId } : {}),
        ...(entityType && entityId ? { entityType, entityId } : {}),
        ...(candidateId ? { candidateId } : {}),
        ...(jobId ? { jobId } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.myDay });
      toast.success(task ? 'Task updated' : 'Task created');
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  const rootError = form.formState.errors.root?.message;
  const submitting = save.isPending;
  const selectedAssignee = form.watch('assigneeId') ?? UNASSIGNED;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit task' : 'New task'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the details, priority or due date.'
              : 'Add a to-do. Leave the assignee blank to keep it on your own list.'}
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          className="space-y-4"
        >
          <fieldset disabled={submitting} className="space-y-4">
            {rootError ? <p className="text-xs text-destructive">{rootError}</p> : null}

            <div className="space-y-1.5">
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                placeholder="Follow up with the hiring manager"
                {...form.register('title')}
              />
              {form.formState.errors.title ? (
                <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-description">Description (optional)</Label>
              <Textarea id="task-description" rows={3} {...form.register('description')} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="task-priority">Priority</Label>
                <Select
                  value={form.watch('priority')}
                  onValueChange={(value) =>
                    form.setValue('priority', value as TaskFormValues['priority'], {
                      shouldDirty: true,
                    })
                  }
                >
                  <SelectTrigger id="task-priority" aria-label="Priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {prioritySchema.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {PRIORITY_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {canAssign ? (
                <div className="space-y-1.5">
                  <Label htmlFor="task-assignee">Assignee</Label>
                  <Select
                    value={selectedAssignee}
                    onValueChange={(value) =>
                      form.setValue('assigneeId', value, { shouldDirty: true })
                    }
                  >
                    <SelectTrigger id="task-assignee" aria-label="Assignee">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>
                        {isEdit ? 'Unassigned' : 'Me (default)'}
                      </SelectItem>
                      {(users.data?.items ?? []).map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.fullName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="task-due">Due date (optional)</Label>
                <Input id="task-due" type="datetime-local" {...form.register('dueAt')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-reminder">Reminder (optional)</Label>
                <Input
                  id="task-reminder"
                  type="datetime-local"
                  {...form.register('reminderAt')}
                />
              </div>
            </div>
          </fieldset>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={submitting}
              disabled={form.watch('title').trim().length === 0}
            >
              {isEdit ? 'Save changes' : 'Create task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
