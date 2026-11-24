'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import {
  SUBMISSION_STATUS_LABELS,
  submissionStatusSchema,
  type ClientListItem,
  type Paginated,
  type SavedViewItem,
  type SubmissionListItem,
  type SubmissionStatus,
  type UserListItem,
} from '@talentflow/types';
import { formatDate, getInitials } from '@talentflow/ui';

import { SavedViewsBar } from '@/components/saved-views/saved-views-bar';
import { PageHeader } from '@/components/shell/page-header';
import { SubmissionPanel } from '@/components/submissions/submission-panel';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const PAGE_SIZE = 20;

type SubmissionSortField = 'submittedAt' | 'updatedAt' | 'appliedAt';
const SORT_FIELD_SET = new Set<string>(['submittedAt', 'updatedAt', 'appliedAt']);

/** Preset views — each is a submission-status filter, not a client-side split. */
const VIEWS: { value: 'all' | SubmissionStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  ...submissionStatusSchema.options
    .filter((status) => status !== 'DRAFT')
    .map((status) => ({ value: status, label: SUBMISSION_STATUS_LABELS[status] })),
];
type SubmissionView = (typeof VIEWS)[number]['value'];

const STATUS_VARIANT: Record<SubmissionStatus, BadgeProps['variant']> = {
  DRAFT: 'muted',
  SUBMITTED: 'info',
  CLIENT_VIEWED: 'info',
  SHORTLISTED: 'success',
  INTERVIEWING: 'secondary',
  OFFERED: 'success',
  REJECTED: 'destructive',
  WITHDRAWN: 'muted',
};

export default function SubmissionsPage() {
  const { has, tenant } = useSession();

  const [view, setView] = useState<SubmissionView>('all');
  const [clientId, setClientId] = useState('all');
  const [recruiterId, setRecruiterId] = useState('all');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SubmissionSortField>('submittedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [openApplicationId, setOpenApplicationId] = useState<string | null>(null);

  const canRead = has('application:read_all') || has('application:read_own');

  const query = {
    page,
    pageSize: PAGE_SIZE,
    sortBy,
    sortDir,
    ...(view === 'all' ? {} : { status: view }),
    ...(clientId === 'all' ? {} : { clientId }),
    ...(recruiterId === 'all' ? {} : { recruiterId }),
  };

  const submissions = useQuery({
    queryKey: queryKeys.submissions.list(query),
    queryFn: () => api.get<Paginated<SubmissionListItem>>('/submissions', { query }),
    enabled: canRead,
    staleTime: 30_000,
  });

  const clients = useQuery({
    queryKey: queryKeys.clients.list({ pageSize: 100, sortBy: 'name', sortDir: 'asc' }),
    queryFn: () =>
      api.get<Paginated<ClientListItem>>('/clients', {
        query: { pageSize: 100, sortBy: 'name', sortDir: 'asc' },
      }),
    enabled: canRead,
    staleTime: 60_000,
  });

  const recruiters = useQuery({
    queryKey: queryKeys.users.list({ pageSize: 100, status: 'ACTIVE' }),
    queryFn: () =>
      api.get<Paginated<UserListItem>>('/users', { query: { pageSize: 100, status: 'ACTIVE' } }),
    enabled: canRead,
    staleTime: 60_000,
  });

  const savedFilters: Record<string, unknown> = {
    view,
    ...(clientId === 'all' ? {} : { clientId }),
    ...(recruiterId === 'all' ? {} : { recruiterId }),
  };

  function applyView(saved: SavedViewItem) {
    const filters = saved.filters;
    if (typeof filters.view === 'string' && VIEWS.some((entry) => entry.value === filters.view)) {
      setView(filters.view as SubmissionView);
    }
    setClientId(typeof filters.clientId === 'string' ? filters.clientId : 'all');
    setRecruiterId(typeof filters.recruiterId === 'string' ? filters.recruiterId : 'all');
    if (saved.sortBy && SORT_FIELD_SET.has(saved.sortBy)) setSortBy(saved.sortBy as SubmissionSortField);
    if (saved.sortDir) setSortDir(saved.sortDir);
    setActiveViewId(saved.id);
    setPage(1);
  }

  function clearView() {
    setView('all');
    setClientId('all');
    setRecruiterId('all');
    setActiveViewId(null);
    setPage(1);
  }

  const items = submissions.data?.items ?? [];
  const meta = submissions.data?.meta;
  const isFiltered = view !== 'all' || clientId !== 'all' || recruiterId !== 'all';

  const columns: DataTableColumn<SubmissionListItem>[] = [
    {
      id: 'candidate',
      header: 'Candidate',
      cell: (submission) => (
        <div className="flex min-w-0 items-center gap-2">
          <Avatar className="size-8">
            {submission.candidate.avatarUrl ? (
              <AvatarImage src={submission.candidate.avatarUrl} alt="" />
            ) : null}
            <AvatarFallback className="text-[10px]">
              {getInitials(submission.candidate.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <Link
              href={`/candidates/${submission.candidate.id}`}
              className="block truncate text-sm font-medium transition-colors hover:text-primary hover:underline"
            >
              {submission.candidate.fullName}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {submission.submittedBy ? `by ${submission.submittedBy.fullName}` : '—'}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: 'job',
      header: 'Requisition',
      cell: (submission) => (
        <div className="min-w-0 space-y-0.5">
          <Link
            href={`/jobs/${submission.job.id}`}
            className="block truncate text-sm font-medium transition-colors hover:text-primary hover:underline"
          >
            {submission.job.title}
          </Link>
          <p className="truncate font-mono text-2xs text-muted-foreground">
            {submission.job.referenceCode}
          </p>
        </div>
      ),
    },
    {
      id: 'client',
      header: 'Client',
      className: 'hidden lg:table-cell',
      headClassName: 'hidden lg:table-cell',
      cell: (submission) =>
        submission.client ? (
          <Link
            href={`/clients/${submission.client.id}`}
            className="truncate text-sm transition-colors hover:text-primary hover:underline"
          >
            {submission.client.name}
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">Not linked</span>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (submission) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={STATUS_VARIANT[submission.submissionStatus]}>
            {SUBMISSION_STATUS_LABELS[submission.submissionStatus]}
          </Badge>
          {submission.hasFeedback ? <Badge variant="outline">Feedback</Badge> : null}
        </div>
      ),
    },
    {
      id: 'submittedAt',
      header: 'Age',
      sortable: true,
      cell: (submission) => (
        <span className="whitespace-nowrap text-xs">
          <span className="font-medium">{submission.ageDays}d</span>
          {submission.submittedAt ? (
            <span className="block text-2xs text-muted-foreground">
              {formatDate(submission.submittedAt, 'DD MMM YYYY', tenant?.timezone)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'owner',
      header: 'Recruiter',
      className: 'hidden xl:table-cell',
      headClassName: 'hidden xl:table-cell',
      cell: (submission) =>
        submission.owner ? (
          <span className="truncate text-xs">{submission.owner.fullName}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Unassigned</span>
        ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (submission) => (
        <div className="flex items-center justify-end gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/applications/${submission.id}`}>Open</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOpenApplicationId(submission.id)}>
            View
          </Button>
        </div>
      ),
    },
  ];

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader
          title="Submissions"
          description="Candidate-to-client submissions and the client’s response."
        />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to submissions"
          description="Ask a workspace administrator for the “View applications” permission."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        title="Submissions"
        description={`Candidates ${tenant?.name ?? 'this workspace'} has sent to clients, and where each one stands.`}
      />

      <Tabs
        value={view}
        onValueChange={(value) => {
          setView(value as SubmissionView);
          setPage(1);
          setActiveViewId(null);
        }}
      >
        <TabsList className="h-auto flex-wrap">
          {VIEWS.map((entry) => (
            <TabsTrigger key={entry.value} value={entry.value}>
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Select
          value={clientId}
          onValueChange={(value) => {
            setClientId(value);
            setPage(1);
            setActiveViewId(null);
          }}
        >
          <SelectTrigger className="lg:w-56" aria-label="Filter by client">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {(clients.data?.items ?? []).map((client) => (
              <SelectItem key={client.id} value={client.id}>
                {client.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={recruiterId}
          onValueChange={(value) => {
            setRecruiterId(value);
            setPage(1);
            setActiveViewId(null);
          }}
        >
          <SelectTrigger className="lg:w-52" aria-label="Filter by recruiter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All recruiters</SelectItem>
            {(recruiters.data?.items ?? []).map((recruiter) => (
              <SelectItem key={recruiter.id} value={recruiter.id}>
                {recruiter.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SavedViewsBar
        entity="APPLICATION"
        filters={savedFilters}
        sortBy={sortBy}
        sortDir={sortDir}
        activeViewId={activeViewId}
        onApply={applyView}
        onClear={clearView}
      />

      <DataTable
        columns={columns}
        rows={items}
        getRowId={(submission) => submission.id}
        isPending={submissions.isPending}
        isError={submissions.isError}
        error={submissions.error}
        onRetry={() => void submissions.refetch()}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(id, dir) => {
          if (!SORT_FIELD_SET.has(id)) return;
          setSortBy(id as SubmissionSortField);
          setSortDir(dir);
          setPage(1);
        }}
        empty={
          <EmptyState
            icon={Building2}
            title={isFiltered ? 'No submissions match those filters' : 'Nothing sent to a client yet'}
            description={
              isFiltered
                ? 'Clear the filters or pick a different status.'
                : 'Submit a candidate to a client from their application to see it tracked here.'
            }
            action={
              isFiltered ? (
                <Button variant="outline" size="sm" onClick={clearView}>
                  Clear filters
                </Button>
              ) : null
            }
          />
        }
      />

      {meta && meta.total > 0 ? (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            Showing {(meta.page - 1) * meta.pageSize + 1}–
            {Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total} submission
            {meta.total === 1 ? '' : 's'}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={!meta.hasPrevious || submissions.isFetching}
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
              disabled={!meta.hasNext || submissions.isFetching}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <SubmissionPanel
        applicationId={openApplicationId}
        open={openApplicationId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenApplicationId(null);
        }}
      />
    </div>
  );
}
