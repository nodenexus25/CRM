'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  CalendarClock,
  GitBranch,
  Linkedin,
  ListChecks,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Send,
  StickyNote,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  ACTIVITY_TYPE_LABELS,
  createActivitySchema,
  type ActivityItem,
  type ActivityQuery,
  type ActivityType,
  type EntityType,
  type Paginated,
} from '@talentflow/types';
import { cn, formatRelativeTime, getInitials } from '@talentflow/ui';

import { LogActivityDialog } from '@/components/activity/log-activity-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const ACTIVITY_ICONS: Record<ActivityType, LucideIcon> = {
  CALL: Phone,
  EMAIL: Mail,
  MEETING: Users,
  NOTE: StickyNote,
  SMS: MessageSquare,
  LINKEDIN: Linkedin,
  TASK: ListChecks,
  INTERVIEW: CalendarClock,
  SUBMISSION: Send,
  STAGE_CHANGE: GitBranch,
  SYSTEM: Bot,
};

/** Muted, non-interactive entries the ATS writes itself. */
const AUTOMATIC_TYPES: readonly ActivityType[] = ['SYSTEM', 'STAGE_CHANGE'];

/** Only these may be logged by hand. */
const LOGGABLE_TYPES = ['CALL', 'EMAIL', 'MEETING', 'NOTE', 'SMS', 'LINKEDIN'] as const;

/**
 * The form reuses the API schema's field constraints; `occurredAt` is held as a
 * `datetime-local` string here and omitted from the payload when blank because
 * the API schema is `z.coerce.date().optional()` and would reject an empty
 * string.
 */
const logActivityFormSchema = z.object({
  type: createActivitySchema.shape.type,
  subject: createActivitySchema.shape.subject,
  body: createActivitySchema.shape.body,
  occurredAt: z.string().trim().optional(),
});

type LogActivityFormValues = z.infer<typeof logActivityFormSchema>;

interface ActivityTimelineProps {
  entityType: EntityType;
  entityId: string;
  className?: string;
  /** Restrict to one activity type and force it on submit (e.g. `['NOTE']`). */
  typeFilter?: readonly ActivityType[];
}

export function ActivityTimeline({ entityType, entityId, className, typeFilter }: ActivityTimelineProps) {
  const queryClient = useQueryClient();
  const { has } = useSession();

  const forcedType = typeFilter?.[0];
  const canCreate = has('activity:create');
  const canUpdate = has('activity:update');
  const canDelete = has('activity:delete');

  const listQuery: Partial<ActivityQuery> = {
    entityType,
    entityId,
    ...(forcedType ? { type: forcedType } : {}),
  };

  const activities = useQuery({
    queryKey: queryKeys.activities.list(listQuery),
    queryFn: () =>
      api.get<Paginated<ActivityItem>>('/activities', {
        query: { entityType, entityId, pageSize: 50, includeSystem: true, ...(forcedType ? { type: forcedType } : {}) },
      }),
    enabled: has('activity:read'),
    staleTime: 15_000,
  });

  const form = useForm<LogActivityFormValues>({
    resolver: zodResolver(logActivityFormSchema),
    defaultValues: { type: forcedType ?? 'NOTE', subject: '', body: '', occurredAt: '' },
  });

  const log = useMutation({
    mutationFn: (values: LogActivityFormValues) => {
      const body = (values.body ?? '').trim();
      return api.post<ActivityItem>('/activities', {
        type: forcedType ?? values.type,
        subject: values.subject,
        entityType,
        entityId,
        ...(body ? { body } : {}),
        ...(values.occurredAt ? { occurredAt: values.occurredAt } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
      toast.success('Activity logged');
      form.reset({ type: forcedType ?? 'NOTE', subject: '', body: '', occurredAt: '' });
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: true }>(`/activities/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
      toast.success('Activity deleted');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not delete this activity');
    },
  });

  const items = activities.data?.items ?? [];
  const rootError = form.formState.errors.root?.message;

  return (
    <div className={cn('space-y-6', className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">
          {forcedType === 'NOTE' ? 'Notes' : forcedType === 'TASK' ? 'Tasks' : 'Activity'}
        </h2>
        {canCreate ? (
          <LogActivityDialog
            entityType={entityType}
            entityId={entityId}
            trigger={
              <Button size="sm">
                <Plus className="size-4" aria-hidden="true" />
                {forcedType === 'NOTE' ? 'Add note' : 'Log activity'}
              </Button>
            }
          />
        ) : null}
      </div>

      {canCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>{forcedType === 'NOTE' ? 'Add a note' : 'Log activity'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              noValidate
              onSubmit={form.handleSubmit((values) => log.mutate(values))}
              className="space-y-4"
            >
              {rootError ? <p className="text-xs text-destructive">{rootError}</p> : null}

              <div className="grid gap-4 sm:grid-cols-2">
                {!forcedType ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="activity-type">Type</Label>
                    <Select
                      value={form.watch('type')}
                      onValueChange={(value) =>
                        form.setValue('type', value as LogActivityFormValues['type'], {
                          shouldDirty: true,
                        })
                      }
                    >
                      <SelectTrigger id="activity-type" aria-label="Activity type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LOGGABLE_TYPES.map((option) => (
                          <SelectItem key={option} value={option}>
                            {ACTIVITY_TYPE_LABELS[option]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                <div className="space-y-1.5">
                  <Label htmlFor="activity-occurred">When (optional)</Label>
                  <Input id="activity-occurred" type="datetime-local" {...form.register('occurredAt')} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="activity-subject">Subject</Label>
                <Input
                  id="activity-subject"
                  placeholder={forcedType === 'NOTE' ? 'Follow-up recap' : 'What happened?'}
                  {...form.register('subject')}
                />
                {form.formState.errors.subject ? (
                  <p className="text-xs text-destructive">{form.formState.errors.subject.message}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="activity-body">Details (optional)</Label>
                <Textarea id="activity-body" rows={3} {...form.register('body')} />
              </div>

              <div className="flex justify-end">
                <Button type="submit" size="sm" loading={log.isPending}>
                  {forcedType === 'NOTE' ? 'Add note' : 'Log activity'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {activities.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : activities.isError ? (
        <EmptyState
          title="Could not load the timeline"
          description={
            activities.error instanceof Error ? activities.error.message : 'Please try again in a moment.'
          }
          action={
            <Button variant="outline" size="sm" onClick={() => void activities.refetch()}>
              Retry
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={forcedType === 'NOTE' ? 'No notes yet' : 'No activity yet'}
          description="Calls, emails, meetings and notes will appear here as they are logged."
        />
      ) : (
        <ol className="space-y-4">
          {items.map((activity) => {
            const Icon = ACTIVITY_ICONS[activity.type];
            const automatic = AUTOMATIC_TYPES.includes(activity.type);
            return (
              <li key={activity.id} className={cn('flex gap-3', automatic && 'opacity-80')}>
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full',
                    automatic ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </span>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={cn(
                        'text-sm font-medium',
                        automatic ? 'text-muted-foreground' : 'text-foreground',
                      )}
                    >
                      {activity.subject}
                    </p>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatRelativeTime(activity.occurredAt)}
                      </span>
                      {canUpdate && !automatic ? (
                        <LogActivityDialog
                          entityType={entityType}
                          entityId={entityId}
                          candidateId={activity.candidateId ?? undefined}
                          jobId={activity.jobId ?? undefined}
                          clientId={activity.clientId ?? undefined}
                          applicationId={activity.applicationId ?? undefined}
                          activity={activity}
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Edit ${activity.subject}`}
                            >
                              <Pencil className="size-3.5" aria-hidden="true" />
                            </Button>
                          }
                        />
                      ) : null}
                      {canDelete && !automatic ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${activity.subject}`}
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(activity.id)}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {activity.body ? (
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{activity.body}</p>
                  ) : null}

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Avatar className="size-5">
                      {activity.createdBy?.avatarUrl ? (
                        <AvatarImage src={activity.createdBy.avatarUrl} alt="" />
                      ) : null}
                      <AvatarFallback className="text-[9px]">
                        {activity.createdBy ? getInitials(activity.createdBy.fullName) : 'TF'}
                      </AvatarFallback>
                    </Avatar>
                    <span>{activity.createdBy?.fullName ?? 'TalentFlow'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{ACTIVITY_TYPE_LABELS[activity.type]}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
