'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BriefcaseBusiness, FileSpreadsheet, Flame, Plus, Search, ShieldOff, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { toast } from 'sonner';

import {
  JOB_SORT_FIELDS,
  JOB_STATUS_LABELS,
  JOB_TYPE_LABELS,
  PRIORITY_LABELS,
  REMOTE_TYPE_LABELS,
  jobTypeSchema,
  prioritySchema,
  remoteTypeSchema,
  type JobListItem,
  type JobStatus,
  type JobType,
  type Paginated,
  type Priority,
  type RemoteType,
  type SavedViewItem,
} from '@talentflow/types';
import { cn, formatDate, getInitials } from '@talentflow/ui';

import { BulkActionBar } from '@/components/bulk-operations/bulk-action-bar';
import { BulkOperationProgress } from '@/components/bulk-operations/bulk-operation-progress';
import { ImportWizardDialog } from '@/components/imports/import-wizard-dialog';
import { SavedViewsBar } from '@/components/saved-views/saved-views-bar';
import { PageHeader } from '@/components/shell/page-header';
import { JobRowActionsMenu } from '@/components/jobs/job-actions-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
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

type JobSortField = (typeof JOB_SORT_FIELDS)[number];

/** The list's preset views — each is a named filter, not a client-side split. */
const VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'My jobs' },
  { value: 'hot', label: 'Hot' },
  { value: 'open', label: 'Open' },
  { value: 'onhold', label: 'On hold' },
  { value: 'closed', label: 'Closed' },
] as const;
type JobView = (typeof VIEWS)[number]['value'];

const STATUS_VARIANT: Record<JobStatus, BadgeProps['variant']> = {
  DRAFT: 'muted',
  OPEN: 'success',
  ON_HOLD: 'warning',
  CLOSED: 'muted',
  FILLED: 'info',
  CANCELLED: 'destructive',
};

const PRIORITY_VARIANT: Record<Priority, BadgeProps['variant']> = {
  LOW: 'muted',
  MEDIUM: 'secondary',
  HIGH: 'warning',
  URGENT: 'destructive',
};

const SORT_FIELD_SET = new Set<string>(JOB_SORT_FIELDS);

export default function JobsPage() {
  const { has, tenant } = useSession();
  const queryClient = useQueryClient();

  const [view, setView] = useState<JobView>('all');
  const [term, setTerm] = useState('');
  const [priority, setPriority] = useState('all');
  const [jobType, setJobType] = useState('all');
  const [remoteType, setRemoteType] = useState('all');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<JobSortField>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [progressId, setProgressId] = useState<string | null>(null);
  const [csvImportOpen, setCsvImportOpen] = useState(false);

  const deferredTerm = useDeferredValue(term.trim());

  const canRead = has('job:read_all') || has('job:read_own');
  const canCreate = has('job:create');
  const canDelete = has('job:delete');
  const canImport = has('import:create') && has('job:create');

  const viewFilter =
    view === 'mine'
      ? ({ myJobs: true } as const)
      : view === 'hot'
        ? ({ hot: true } as const)
        : view === 'open'
          ? ({ status: 'OPEN' } as const)
          : view === 'onhold'
            ? ({ status: 'ON_HOLD' } as const)
            : view === 'closed'
              ? ({ status: 'CLOSED' } as const)
              : ({} as const);

  const query = {
    page,
    pageSize: PAGE_SIZE,
    sortBy,
    sortDir,
    ...(deferredTerm ? { q: deferredTerm } : {}),
    ...viewFilter,
    ...(priority === 'all' ? {} : { priority: priority as Priority }),
    ...(jobType === 'all' ? {} : { jobType: jobType as JobType }),
    ...(remoteType === 'all' ? {} : { remoteType: remoteType as RemoteType }),
  };

  const jobs = useQuery({
    queryKey: queryKeys.jobs.list(query),
    queryFn: () => api.get<Paginated<JobListItem>>('/jobs', { query }),
    enabled: canRead,
    staleTime: 30_000,
  });

  /**
   * Status, priority and recruiter assignment run through the server-side
   * `BulkOperation` queue (`POST /bulk-operations`, owned by `BulkActionBar`).
   * The frozen contract has no `JOB_DELETE` type, so requisition deletion stays
   * a client-side fan-out over the explicit selection.
   */
  const deleteJobs = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map((id) => api.delete(`/jobs/${id}`)));
      const failed = results.filter((result) => result.status === 'rejected').length;
      return { total: ids.length, failed };
    },
    onSuccess: ({ total, failed }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      setSelectedIds(new Set());
      if (failed === 0) {
        toast.success(`Deleted ${total} requisition${total === 1 ? '' : 's'}`);
      } else {
        toast.warning(`${total - failed} of ${total} deleted · ${failed} could not be deleted`);
      }
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : 'Could not delete the selected requisitions',
      );
    },
  });

  const savedFilters: Record<string, unknown> = {
    view,
    ...(deferredTerm ? { q: deferredTerm } : {}),
    ...(priority === 'all' ? {} : { priority }),
    ...(jobType === 'all' ? {} : { jobType }),
    ...(remoteType === 'all' ? {} : { remoteType }),
  };

  /**
   * The filter object (sans pagination/sort) the API re-runs to resolve an
   * "all matching this filter" selection, so the two can never drift.
   */
  const bulkFilters: Record<string, unknown> = {
    ...(deferredTerm ? { q: deferredTerm } : {}),
    ...viewFilter,
    ...(priority === 'all' ? {} : { priority }),
    ...(jobType === 'all' ? {} : { jobType }),
    ...(remoteType === 'all' ? {} : { remoteType }),
  };

  function resetSelection() {
    setSelectedIds(new Set());
  }

  function applyView(saved: SavedViewItem) {
    const filters = saved.filters;
    if (typeof filters.view === 'string' && VIEWS.some((entry) => entry.value === filters.view)) {
      setView(filters.view as JobView);
    }
    setTerm(typeof filters.q === 'string' ? filters.q : '');
    setPriority(typeof filters.priority === 'string' ? filters.priority : 'all');
    setJobType(typeof filters.jobType === 'string' ? filters.jobType : 'all');
    setRemoteType(typeof filters.remoteType === 'string' ? filters.remoteType : 'all');
    if (saved.sortBy && SORT_FIELD_SET.has(saved.sortBy)) setSortBy(saved.sortBy as JobSortField);
    if (saved.sortDir) setSortDir(saved.sortDir);
    setActiveViewId(saved.id);
    setPage(1);
    resetSelection();
  }

  function clearView() {
    setView('all');
    setTerm('');
    setPriority('all');
    setJobType('all');
    setRemoteType('all');
    setActiveViewId(null);
    setPage(1);
    resetSelection();
  }

  const items = jobs.data?.items ?? [];
  const meta = jobs.data?.meta;
  const isFiltered =
    deferredTerm.length > 0 ||
    view !== 'all' ||
    priority !== 'all' ||
    jobType !== 'all' ||
    remoteType !== 'all';

  const columns: DataTableColumn<JobListItem>[] = [
    {
      id: 'title',
      header: 'Job',
      sortable: true,
      cell: (job) => (
        <div className="min-w-0 space-y-0.5">
          <Link
            href={`/jobs/${job.id}`}
            className="block truncate text-sm font-medium transition-colors hover:text-primary hover:underline"
          >
            {job.title}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{job.referenceCode}</span>
            {job.client ? <> · {job.client.name}</> : null}
          </p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortable: true,
      cell: (job) => <Badge variant={STATUS_VARIANT[job.status]}>{JOB_STATUS_LABELS[job.status]}</Badge>,
    },
    {
      id: 'priority',
      header: 'Priority',
      sortable: true,
      cell: (job) => (
        <div className="flex items-center gap-1.5">
          <Badge variant={PRIORITY_VARIANT[job.priority]}>{PRIORITY_LABELS[job.priority]}</Badge>
          {job.isHot ? (
            <Flame className="size-3.5 text-destructive" role="img" aria-label="Hot requisition" />
          ) : null}
        </div>
      ),
    },
    {
      id: 'applicantCount',
      header: 'Pipeline',
      sortable: true,
      cell: (job) => (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">{job.applicantCount}</span>
            <span className="text-xs text-muted-foreground">
              candidate{job.applicantCount === 1 ? '' : 's'}
            </span>
            {job.newApplicantCount > 0 ? (
              <Badge variant="info">+{job.newApplicantCount} new</Badge>
            ) : null}
          </div>
          {job.skills.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {job.skills.slice(0, 3).map((skill) => (
                <Badge key={skill.id} variant="muted">
                  {skill.name}
                </Badge>
              ))}
              {job.skills.length > 3 ? (
                <span className="text-2xs text-muted-foreground">+{job.skills.length - 3}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: 'owner',
      header: 'Owner',
      className: 'hidden lg:table-cell',
      headClassName: 'hidden lg:table-cell',
      cell: (job) =>
        job.owner ? (
          <div className="flex items-center gap-2">
            <Avatar className="size-6">
              {job.owner.avatarUrl ? <AvatarImage src={job.owner.avatarUrl} alt="" /> : null}
              <AvatarFallback className="text-[9px]">
                {getInitials(job.owner.fullName)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-xs">{job.owner.fullName}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Unassigned</span>
        ),
    },
    {
      id: 'targetFillAt',
      header: 'Target fill',
      sortable: true,
      className: 'hidden md:table-cell',
      headClassName: 'hidden md:table-cell',
      cell: (job) => {
        if (!job.targetFillAt) return <span className="text-xs text-muted-foreground">—</span>;
        const overdue = new Date(job.targetFillAt).getTime() < Date.now();
        return (
          <span
            className={cn(
              'whitespace-nowrap text-xs',
              overdue ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {formatDate(job.targetFillAt, 'DD MMM YYYY', tenant?.timezone)}
          </span>
        );
      },
    },
    {
      id: 'openings',
      header: 'Openings',
      className: 'hidden xl:table-cell',
      headClassName: 'hidden xl:table-cell',
      cell: (job) => (
        <span className="whitespace-nowrap text-xs">
          <span className="font-medium">{job.filledCount}</span>
          <span className="text-muted-foreground">/{job.openings} filled</span>
        </span>
      ),
    },
    {
      id: 'updatedAt',
      header: 'Updated',
      sortable: true,
      className: 'hidden xl:table-cell',
      headClassName: 'hidden xl:table-cell',
      cell: (job) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDate(job.updatedAt, 'DD MMM YYYY', tenant?.timezone)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (job) => (
        <div className="flex justify-end">
          <JobRowActionsMenu job={job} />
        </div>
      ),
    },
  ];

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader title="Jobs" description="Requisitions, pipelines and applicant intake." />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to jobs"
          description="Ask a workspace administrator for the “View jobs” permission."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        title="Jobs"
        description={`Every open requisition in ${tenant?.name ?? 'this workspace'} — pipeline health, ownership and target fill dates.`}
        actions={
          <>
            {canImport ? (
              <Button variant="outline" size="sm" onClick={() => setCsvImportOpen(true)}>
                <FileSpreadsheet className="size-4" aria-hidden="true" />
                Import CSV
              </Button>
            ) : null}
            {canCreate ? (
              <Button asChild size="sm">
                <Link href="/jobs/new">
                  <Plus className="size-4" aria-hidden="true" />
                  New job
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <Tabs
        value={view}
        onValueChange={(value) => {
          setView(value as JobView);
          setPage(1);
          setActiveViewId(null);
          resetSelection();
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
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setPage(1);
              setActiveViewId(null);
              resetSelection();
            }}
            placeholder="Search by title, code or client…"
            aria-label="Search requisitions"
            className="pl-9"
          />
        </div>

        <Select
          value={priority}
          onValueChange={(value) => {
            setPriority(value);
            setPage(1);
            setActiveViewId(null);
            resetSelection();
          }}
        >
          <SelectTrigger className="lg:w-40" aria-label="Filter by priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {prioritySchema.options.map((option) => (
              <SelectItem key={option} value={option}>
                {PRIORITY_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={jobType}
          onValueChange={(value) => {
            setJobType(value);
            setPage(1);
            setActiveViewId(null);
            resetSelection();
          }}
        >
          <SelectTrigger className="lg:w-44" aria-label="Filter by job type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All job types</SelectItem>
            {jobTypeSchema.options.map((option) => (
              <SelectItem key={option} value={option}>
                {JOB_TYPE_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={remoteType}
          onValueChange={(value) => {
            setRemoteType(value);
            setPage(1);
            setActiveViewId(null);
            resetSelection();
          }}
        >
          <SelectTrigger className="lg:w-40" aria-label="Filter by work model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All work models</SelectItem>
            {remoteTypeSchema.options.map((option) => (
              <SelectItem key={option} value={option}>
                {REMOTE_TYPE_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SavedViewsBar
        entity="JOB"
        filters={savedFilters}
        sortBy={sortBy}
        sortDir={sortDir}
        activeViewId={activeViewId}
        onApply={applyView}
        onClear={clearView}
      />

      {selectedIds.size > 0 ? (
        <BulkActionBar
          scope="job"
          selectedIds={selectedIds}
          pageRowIds={items.map((job) => job.id)}
          total={meta?.total ?? items.length}
          filters={bulkFilters}
          onClear={resetSelection}
          onStarted={(operation) => setProgressId(operation.id)}
          extra={({ allMatching }) =>
            canDelete && !allMatching ? (
              <ConfirmDialog
                destructive
                title={`Delete ${selectedIds.size} requisition${selectedIds.size === 1 ? '' : 's'}?`}
                description="They are removed from every list. Their applications and history are retained."
                confirmLabel="Delete requisitions"
                trigger={
                  <Button variant="outline" size="sm" className="text-destructive">
                    <Trash2 className="size-4" aria-hidden="true" />
                    Delete
                  </Button>
                }
                onConfirm={() =>
                  deleteJobs
                    .mutateAsync([...selectedIds])
                    .then(() => undefined)
                    .catch(() => undefined)
                }
              />
            ) : null
          }
        />
      ) : null}

      <DataTable
        columns={columns}
        rows={items}
        getRowId={(job) => job.id}
        isPending={jobs.isPending}
        isError={jobs.isError}
        error={jobs.error}
        onRetry={() => void jobs.refetch()}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(id, dir) => {
          if (!SORT_FIELD_SET.has(id)) return;
          setSortBy(id as JobSortField);
          setSortDir(dir);
          setPage(1);
        }}
        empty={
          <EmptyState
            icon={BriefcaseBusiness}
            title={isFiltered ? 'No requisitions match those filters' : 'No requisitions yet'}
            description={
              isFiltered
                ? 'Clear the search box or pick a different view.'
                : 'Create your first requisition to start building a pipeline.'
            }
            action={
              isFiltered ? (
                <Button variant="outline" size="sm" onClick={clearView}>
                  Clear filters
                </Button>
              ) : canCreate ? (
                <Button asChild size="sm">
                  <Link href="/jobs/new">
                    <Plus className="size-4" aria-hidden="true" />
                    New job
                  </Link>
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
            {Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total} requisition
            {meta.total === 1 ? '' : 's'}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPage((value) => Math.max(1, value - 1));
                resetSelection();
              }}
              disabled={!meta.hasPrevious || jobs.isFetching}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {meta.page} of {Math.max(1, meta.pageCount)}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPage((value) => value + 1);
                resetSelection();
              }}
              disabled={!meta.hasNext || jobs.isFetching}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <BulkOperationProgress
        open={progressId !== null}
        onOpenChange={(open) => {
          if (!open) setProgressId(null);
        }}
        operationId={progressId}
        onSettled={() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
        }}
      />

      {canImport ? (
        <ImportWizardDialog
          open={csvImportOpen}
          onOpenChange={setCsvImportOpen}
          entity="JOB"
          onCompleted={() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
          }}
        />
      ) : null}
    </div>
  );
}
