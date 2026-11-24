'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CircleCheckBig, Sunrise, TriangleAlert, Users, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { toast } from 'sonner';

import { INTERVIEW_TYPE_LABELS, type MyDay, type MyDayInterview } from '@talentflow/types';
import { cn, formatDateTime } from '@talentflow/ui';

import { TaskList, TaskListEmpty } from '@/components/tasks/task-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

/**
 * The dashboard's My Day panel: what is late, what is due today and who the
 * signed-in user is interviewing today — assembled by one `/tasks/my-day`
 * round-trip so the panel never fans out into a dozen requests.
 */
export function MyDayPanel() {
  const { has, tenant } = useSession();
  const queryClient = useQueryClient();
  const canRead = has('task:read');
  const canComplete = has('task:update');

  const myDay = useQuery({
    queryKey: queryKeys.tasks.myDay,
    queryFn: () => api.get<MyDay>('/tasks/my-day'),
    enabled: canRead,
    staleTime: 30_000,
  });

  const complete = useMutation({
    mutationFn: (id: string) => api.post(`/tasks/${id}/complete`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.myDay });
      toast.success('Task completed');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not complete the task');
    },
  });

  if (!canRead) return null;

  const overdue = myDay.data?.overdueTasks ?? [];
  const dueToday = myDay.data?.tasks ?? [];
  const interviews = myDay.data?.interviews ?? [];
  const stats = myDay.data?.stats;
  const everythingEmpty =
    overdue.length === 0 && dueToday.length === 0 && interviews.length === 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Sunrise className="size-4 text-primary" aria-hidden="true" />
          My Day
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link href="/tasks">View all tasks</Link>
        </Button>
      </CardHeader>

      <CardContent className="space-y-6">
        {myDay.isError ? (
          <EmptyState
            title="Could not load your day"
            description={
              myDay.error instanceof Error ? myDay.error.message : 'Please try again in a moment.'
            }
            action={
              <Button variant="outline" size="sm" onClick={() => void myDay.refetch()}>
                Retry
              </Button>
            }
          />
        ) : myDay.isPending ? (
          <div className="space-y-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Open" value={stats?.open} />
              <StatTile label="Due today" value={stats?.dueToday} />
              <StatTile label="Overdue" value={stats?.overdue} tone="destructive" />
              <StatTile label="Completed today" value={stats?.completedToday} />
            </div>

            {everythingEmpty ? (
              <EmptyState
                icon={CircleCheckBig}
                title="You are all caught up"
                description="No overdue tasks, nothing due today and no interviews scheduled."
              />
            ) : (
              <div className="grid gap-6 lg:grid-cols-3">
                <Block
                  icon={TriangleAlert}
                  title="Overdue"
                  count={overdue.length}
                  tone="destructive"
                >
                  <TaskList
                    tasks={overdue}
                    canComplete={canComplete}
                    onComplete={(task) => complete.mutate(task.id)}
                    empty={
                      <TaskListEmpty title="Nothing overdue" description="Great work staying on top of it." />
                    }
                  />
                </Block>

                <Block icon={CalendarClock} title="Due today" count={dueToday.length}>
                  <TaskList
                    tasks={dueToday}
                    canComplete={canComplete}
                    onComplete={(task) => complete.mutate(task.id)}
                    empty={<TaskListEmpty title="Nothing due today" />}
                  />
                </Block>

                <Block icon={Users} title="Today's interviews" count={interviews.length}>
                  {interviews.length === 0 ? (
                    <TaskListEmpty title="No interviews today" />
                  ) : (
                    <ul className="divide-y divide-border">
                      {interviews.map((interview) => (
                        <InterviewRow key={interview.id} interview={interview} timezone={tenant?.timezone} />
                      ))}
                    </ul>
                  )}
                </Block>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Block({
  icon: Icon,
  title,
  count,
  tone,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count: number;
  tone?: 'destructive';
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon
          className={cn('size-4', tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground')}
          aria-hidden="true"
        />
        <h3
          className={cn(
            'text-sm font-medium',
            tone === 'destructive' && count > 0 && 'text-destructive',
          )}
        >
          {title}
        </h3>
        <Badge variant={tone === 'destructive' && count > 0 ? 'destructive' : 'muted'}>{count}</Badge>
      </div>
      {children}
    </section>
  );
}

function InterviewRow({ interview, timezone }: { interview: MyDayInterview; timezone?: string }) {
  return (
    <li className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 space-y-0.5">
        <Link
          href={`/applications/${interview.applicationId}`}
          className="block truncate text-sm font-medium transition-colors hover:text-primary hover:underline"
        >
          {interview.candidateName}
        </Link>
        <p className="truncate text-xs text-muted-foreground">{interview.jobTitle}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {formatDateTime(interview.scheduledStart, timezone, undefined, 'DD MMM YYYY')}
          </span>
          <Badge variant="secondary">{INTERVIEW_TYPE_LABELS[interview.type]}</Badge>
        </div>
      </div>
    </li>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | undefined;
  tone?: 'destructive';
}) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</p>
      {value === undefined ? (
        <Skeleton className="mt-1 h-6 w-8" />
      ) : (
        <p
          className={cn(
            'text-lg font-semibold tabular-nums',
            tone === 'destructive' && value > 0 && 'text-destructive',
          )}
        >
          {value}
        </p>
      )}
    </div>
  );
}
