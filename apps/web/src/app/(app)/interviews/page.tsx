'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CalendarPlus, Search, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import {
  INTERVIEW_STATUS_LABELS,
  INTERVIEW_TYPE_LABELS,
  interviewTypeSchema,
  type InterviewListItem,
  type InterviewStatus,
  type InterviewType,
  type Paginated,
  type UserListItem,
} from '@talentflow/types';
import { formatDate, getInitials } from '@talentflow/ui';

import { InterviewPanel } from '@/components/interviews/interview-panel';
import { ScheduleInterviewDialog } from '@/components/interviews/schedule-interview-dialog';
import { PageHeader } from '@/components/shell/page-header';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const PAGE_SIZE = 20;

type Tab = 'upcoming' | 'past' | 'all';

const TABS: { value: Tab; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'all', label: 'All' },
];

const STATUS_VARIANT: Record<InterviewStatus, BadgeProps['variant']> = {
  SCHEDULED: 'info',
  CONFIRMED: 'secondary',
  COMPLETED: 'success',
  CANCELLED: 'muted',
  NO_SHOW: 'destructive',
  RESCHEDULED: 'warning',
};

interface DayGroup {
  key: string;
  label: string;
  items: InterviewListItem[];
}

/**
 * Buckets the page's rows into calendar days in the workspace's timezone, so the
 * list reads as an agenda rather than a flat table. Order is preserved from the
 * server (ascending or descending), which keeps "today" first on Upcoming and
 * most-recent first on Past.
 */
function groupByDay(items: InterviewListItem[], timezone?: string): DayGroup[] {
  const groups: DayGroup[] = [];

  for (const item of items) {
    const key = formatDate(item.scheduledStart, 'YYYY-MM-DD', timezone);
    const current = groups.at(-1);
    if (current && current.key === key) {
      current.items.push(item);
    } else {
      groups.push({
        key,
        label: formatDate(item.scheduledStart, 'DD MMM YYYY', timezone),
        items: [item],
      });
    }
  }

  return groups;
}

function formatClock(iso: string, timezone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export default function InterviewsPage() {
  const { has, tenant } = useSession();

  const canRead = has('interview:read');
  const canCreate = has('interview:create');

  const [tab, setTab] = useState<Tab>('upcoming');
  const [type, setType] = useState<'all' | InterviewType>('all');
  const [interviewerId, setInterviewerId] = useState('all');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [openInterviewId, setOpenInterviewId] = useState<string | null>(null);

  // Pinned once per mount: a fresh `now` on every render would change the query
  // key and refetch in a loop.
  const now = useMemo(() => new Date(), []);

  const query = {
    page,
    pageSize: PAGE_SIZE,
    sortBy: 'scheduledStart' as const,
    sortDir: tab === 'past' ? ('desc' as const) : ('asc' as const),
    ...(tab === 'upcoming' ? { upcoming: true } : {}),
    // "Past" is expressed as an upper bound on the start rather than
    // `upcoming=false`, because a query-string `false` coerces to truthy.
    ...(tab === 'past' ? { to: now } : {}),
    ...(type === 'all' ? {} : { type }),
    ...(interviewerId === 'all' ? {} : { interviewerId }),
    ...(term.trim() ? { q: term.trim() } : {}),
  };

  const interviews = useQuery({
    queryKey: queryKeys.interviews.list(query),
    queryFn: () => api.get<Paginated<InterviewListItem>>('/interviews', { query }),
    enabled: canRead,
    staleTime: 30_000,
  });

  const users = useQuery({
    queryKey: queryKeys.users.list({ pageSize: 100, status: 'ACTIVE' }),
    queryFn: () =>
      api.get<Paginated<UserListItem>>('/users', { query: { pageSize: 100, status: 'ACTIVE' } }),
    enabled: canRead,
    staleTime: 60_000,
  });

  const items = interviews.data?.items ?? [];
  const meta = interviews.data?.meta;
  const groups = groupByDay(items, tenant?.timezone);
  const isFiltered = type !== 'all' || interviewerId !== 'all' || term.trim().length > 0;

  function resetPage() {
    setPage(1);
  }

  function clearFilters() {
    setType('all');
    setInterviewerId('all');
    setTerm('');
    setPage(1);
  }

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader title="Interviews" description="Scheduling, interviewers and scorecards." />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to interviews"
          description="Ask a workspace administrator for the “View interviews” permission."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        title="Interviews"
        description={`Scheduled conversations for ${tenant?.name ?? 'this workspace'}, grouped by day.`}
        actions={
          canCreate ? (
            <Button onClick={() => setScheduleOpen(true)}>
              <CalendarPlus className="size-4" aria-hidden="true" />
              Schedule interview
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as Tab);
            resetPage();
          }}
        >
          <TabsList>
            {TABS.map((entry) => (
              <TabsTrigger key={entry.value} value={entry.value}>
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative sm:w-56">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={term}
              onChange={(event) => {
                setTerm(event.target.value);
                resetPage();
              }}
              placeholder="Search candidate, job…"
              aria-label="Search interviews"
              className="pl-7"
            />
          </div>

          <Select
            value={type}
            onValueChange={(value) => {
              setType(value as 'all' | InterviewType);
              resetPage();
            }}
          >
            <SelectTrigger className="sm:w-44" aria-label="Filter by interview type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {interviewTypeSchema.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {INTERVIEW_TYPE_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={interviewerId}
            onValueChange={(value) => {
              setInterviewerId(value);
              resetPage();
            }}
          >
            <SelectTrigger className="sm:w-48" aria-label="Filter by interviewer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All interviewers</SelectItem>
              {(users.data?.items ?? []).map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {interviews.isPending ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : interviews.isError ? (
        <EmptyState
          title="Could not load interviews"
          description={interviews.error instanceof Error ? interviews.error.message : 'Please try again.'}
          action={
            <Button variant="outline" size="sm" onClick={() => void interviews.refetch()}>
              Retry
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={
            isFiltered
              ? 'No interviews match those filters'
              : tab === 'past'
                ? 'Nothing in the past'
                : 'Nothing scheduled yet'
          }
          description={
            isFiltered
              ? 'Clear the filters or try another day.'
              : tab === 'upcoming'
                ? 'Schedule an interview to see it on the agenda.'
                : 'Interviews that have already happened will show up here.'
          }
          action={
            isFiltered ? (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key} className="space-y-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h2>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-card">
                {group.items.map((interview) => (
                  <li
                    key={interview.id}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="w-20 shrink-0">
                      <p className="text-sm font-medium tabular-nums">
                        {formatClock(interview.scheduledStart, interview.timezone)}
                      </p>
                      <p className="text-2xs text-muted-foreground">
                        {interview.durationMinutes}m · r{interview.round}
                      </p>
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          href={`/candidates/${interview.application.candidate.id}`}
                          className="truncate text-sm font-medium transition-colors hover:text-primary hover:underline"
                        >
                          {interview.application.candidate.fullName}
                        </Link>
                        <Badge variant={STATUS_VARIANT[interview.status]}>
                          {INTERVIEW_STATUS_LABELS[interview.status]}
                        </Badge>
                        <Badge variant="outline">{INTERVIEW_TYPE_LABELS[interview.type]}</Badge>
                        {interview.hasFeedback ? (
                          <Badge variant="success">Scored {interview.rating}/5</Badge>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        <Link
                          href={`/jobs/${interview.application.job.id}`}
                          className="transition-colors hover:text-foreground hover:underline"
                        >
                          {interview.application.job.title}
                        </Link>
                        {interview.application.client ? ` · ${interview.application.client.name}` : ''}
                        {interview.title ? ` · ${interview.title}` : ''}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      {interview.interviewers.length > 0 ? (
                        <div className="flex -space-x-1.5" aria-label="Panel">
                          {interview.interviewers.slice(0, 4).map((participant) => (
                            <Avatar
                              key={participant.id}
                              className="size-6 ring-2 ring-card"
                              title={`${participant.fullName}${participant.isLead ? ' (lead)' : ''}`}
                            >
                              {participant.avatarUrl ? (
                                <AvatarImage src={participant.avatarUrl} alt="" />
                              ) : null}
                              <AvatarFallback className="text-[9px]">
                                {getInitials(participant.fullName)}
                              </AvatarFallback>
                            </Avatar>
                          ))}
                          {interview.interviewers.length > 4 ? (
                            <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[9px] text-muted-foreground ring-2 ring-card">
                              +{interview.interviewers.length - 4}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-2xs text-muted-foreground">No panel</span>
                      )}

                      <Button variant="outline" size="sm" onClick={() => setOpenInterviewId(interview.id)}>
                        View
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {meta && meta.total > 0 ? (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            Showing {(meta.page - 1) * meta.pageSize + 1}–
            {Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total} interview
            {meta.total === 1 ? '' : 's'}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={!meta.hasPrevious || interviews.isFetching}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {meta.page} of {Math.max(1, meta.pageCount)}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => value + 1)}
              disabled={!meta.hasNext || interviews.isFetching}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <ScheduleInterviewDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        onScheduled={resetPage}
      />

      <InterviewPanel
        interviewId={openInterviewId}
        open={openInterviewId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenInterviewId(null);
        }}
      />
    </div>
  );
}
