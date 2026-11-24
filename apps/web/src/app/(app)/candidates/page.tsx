'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CopyPlus, FileSpreadsheet, FileUp, Flame, LayoutGrid, MapPin, Plus, Search, ShieldOff, Table2, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useEffect, useState } from 'react';

import {
  CANDIDATE_SORT_FIELDS,
  CANDIDATE_STATUS_LABELS,
  type Availability,
  type CandidateListItem,
  type CandidateListSummary,
  type CandidateSource,
  type CandidateStatus,
  type ExperienceLevel,
  type Paginated,
  type SavedViewItem,
  type WorkAuthorization,
} from '@talentflow/types';
import { formatDate, getInitials } from '@talentflow/ui';

import { BulkActionBar } from '@/components/bulk-operations/bulk-action-bar';
import { BulkOperationProgress } from '@/components/bulk-operations/bulk-operation-progress';
import { BooleanSearchHelp } from '@/components/candidates/boolean-search-help';
import { CandidateCard } from '@/components/candidates/candidate-card';
import {
  CandidateFilters,
  countActiveFilters,
  EMPTY_CANDIDATE_FILTERS,
  type CandidateFilters as CandidateFiltersState,
} from '@/components/candidates/candidate-filters';
import { FindDuplicatesDialog } from '@/components/candidates/find-duplicates-dialog';
import { MergeCandidatesDialog } from '@/components/candidates/merge-candidates-dialog';
import { ImportWizardDialog } from '@/components/imports/import-wizard-dialog';
import { ResumeReviewDialog } from '@/components/resumes/resume-review-dialog';
import { ResumeUploadDialog } from '@/components/resumes/resume-upload-dialog';
import { SavedViewsBar } from '@/components/saved-views/saved-views-bar';
import { PageHeader } from '@/components/shell/page-header';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

const PAGE_SIZE = 24;

/** Layout preference survives reloads, so a recruiter keeps their preferred view. */
const LAYOUT_STORAGE_KEY = 'talentflow:candidates:layout';
type CandidateLayout = 'table' | 'cards';

type CandidateSortField = (typeof CANDIDATE_SORT_FIELDS)[number];

const SORT_LABELS: Record<CandidateSortField, string> = {
  createdAt: 'Newest first',
  updatedAt: 'Recently updated',
  firstName: 'First name',
  lastName: 'Last name',
  currentCompany: 'Company',
  expectedRateCents: 'Expected rate',
  lastContactedAt: 'Last contacted',
  rating: 'Rating',
};

/** Fields whose natural order is ascending; everything else defaults to newest. */
const ASC_SORT_FIELDS = new Set<CandidateSortField>(['firstName', 'lastName', 'currentCompany']);

/** Preset views — each maps to a named filter the API already understands. */
const VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'My candidates' },
  { value: 'hot', label: 'Hot' },
  { value: 'resume', label: 'With résumé' },
  { value: 'archived', label: 'Archived' },
] as const;
type CandidateView = (typeof VIEWS)[number]['value'];

const STATUS_VARIANT: Record<CandidateStatus, BadgeProps['variant']> = {
  ACTIVE: 'success',
  PASSIVE: 'secondary',
  DO_NOT_CONTACT: 'destructive',
  PLACED: 'info',
  ARCHIVED: 'muted',
};

const SORT_FIELD_SET = new Set<string>(CANDIDATE_SORT_FIELDS);

function years(months: number | null): string | null {
  if (months === null) return null;
  const value = months / 12;
  return value < 1 ? `${months} mo` : `${Number.isInteger(value) ? value : value.toFixed(1)} yr`;
}

/** Restores a partial `CandidateFilters` object stored in a saved view. */
function normalizeFilters(value: unknown): CandidateFiltersState {
  if (value === null || typeof value !== 'object') return EMPTY_CANDIDATE_FILTERS;
  const partial = value as Partial<CandidateFiltersState>;
  return { ...EMPTY_CANDIDATE_FILTERS, ...partial };
}

export default function CandidatesPage() {
  const { has, tenant } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [view, setView] = useState<CandidateView>('all');
  const [term, setTerm] = useState('');
  const [filters, setFilters] = useState<CandidateFiltersState>(EMPTY_CANDIDATE_FILTERS);
  const [listId, setListId] = useState('all');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<CandidateSortField>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [progressId, setProgressId] = useState<string | null>(null);
  const [layout, setLayout] = useState<CandidateLayout>('table');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importResumeId, setImportResumeId] = useState<string | null>(null);
  const [csvImportOpen, setCsvImportOpen] = useState(false);

  const deferredTerm = useDeferredValue(term.trim());

  const canRead = has('candidate:read_all') || has('candidate:read_own');
  const canCreate = has('candidate:create');
  const canImport = has('candidate:import');
  const canMerge = has('candidate:merge');
  const canReadLists = has('list:read') || has('candidate:read_own');

  useEffect(() => {
    const stored = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (stored === 'cards' || stored === 'table') setLayout(stored);
  }, []);

  const viewFilter =
    view === 'mine'
      ? ({ myCandidates: true } as const)
      : view === 'hot'
        ? ({ isHot: true } as const)
        : view === 'resume'
          ? ({ hasResume: true } as const)
          : view === 'archived'
            ? ({ isArchived: true } as const)
            : ({} as const);

  const query = {
    page,
    pageSize: PAGE_SIZE,
    sortBy,
    sortDir,
    ...(deferredTerm ? { q: deferredTerm } : {}),
    ...viewFilter,
    ...(listId === 'all' ? {} : { listId }),
    ...(filters.status.length > 0 ? { status: filters.status } : {}),
    ...(filters.source.length > 0 ? { source: filters.source as CandidateSource[] } : {}),
    ...(filters.experienceLevel.length > 0
      ? { experienceLevel: filters.experienceLevel as ExperienceLevel[] }
      : {}),
    ...(filters.availability.length > 0
      ? { availability: filters.availability as Availability[] }
      : {}),
    ...(filters.workAuthorization.length > 0
      ? { workAuthorization: filters.workAuthorization as WorkAuthorization[] }
      : {}),
    ...(filters.location.trim() ? { location: filters.location.trim() } : {}),
    ...(filters.minExperienceMonths.trim()
      ? { minExperienceMonths: Number(filters.minExperienceMonths) }
      : {}),
    ...(filters.maxExperienceMonths.trim()
      ? { maxExperienceMonths: Number(filters.maxExperienceMonths) }
      : {}),
  };

  const candidates = useQuery({
    queryKey: queryKeys.candidates.list(query),
    queryFn: () => api.get<Paginated<CandidateListItem>>('/candidates', { query }),
    enabled: canRead,
    staleTime: 30_000,
  });

  const hotlists = useQuery({
    queryKey: queryKeys.candidateLists.list({ pageSize: 100 }),
    queryFn: () => api.get<Paginated<CandidateListSummary>>('/candidate-lists', { query: { pageSize: 100 } }),
    enabled: canRead && canReadLists,
    staleTime: 60_000,
  });

  /**
   * The filter object (sans pagination/sort) the API re-runs to resolve an
   * "all matching this filter" selection, so the two can never drift.
   */
  const bulkFilters: Record<string, unknown> = {
    ...(deferredTerm ? { q: deferredTerm } : {}),
    ...viewFilter,
    ...(listId === 'all' ? {} : { listId }),
    ...(filters.status.length > 0 ? { status: filters.status } : {}),
    ...(filters.source.length > 0 ? { source: filters.source } : {}),
    ...(filters.experienceLevel.length > 0 ? { experienceLevel: filters.experienceLevel } : {}),
    ...(filters.availability.length > 0 ? { availability: filters.availability } : {}),
    ...(filters.workAuthorization.length > 0
      ? { workAuthorization: filters.workAuthorization }
      : {}),
    ...(filters.location.trim() ? { location: filters.location.trim() } : {}),
    ...(filters.minExperienceMonths.trim()
      ? { minExperienceMonths: Number(filters.minExperienceMonths) }
      : {}),
    ...(filters.maxExperienceMonths.trim()
      ? { maxExperienceMonths: Number(filters.maxExperienceMonths) }
      : {}),
  };

  const savedFilters: Record<string, unknown> = {
    view,
    ...(deferredTerm ? { q: deferredTerm } : {}),
    ...(listId === 'all' ? {} : { listId }),
    advanced: filters,
  };

  function resetSelection() {
    setSelectedIds(new Set());
  }

  function updateFilters(next: CandidateFiltersState) {
    setFilters(next);
    setPage(1);
    setActiveViewId(null);
    resetSelection();
  }

  function applyView(saved: SavedViewItem) {
    const stored = saved.filters;
    if (typeof stored.view === 'string' && VIEWS.some((entry) => entry.value === stored.view)) {
      setView(stored.view as CandidateView);
    }
    setTerm(typeof stored.q === 'string' ? stored.q : '');
    setListId(typeof stored.listId === 'string' ? stored.listId : 'all');
    setFilters(normalizeFilters(stored.advanced));
    if (saved.sortBy && SORT_FIELD_SET.has(saved.sortBy)) setSortBy(saved.sortBy as CandidateSortField);
    if (saved.sortDir) setSortDir(saved.sortDir);
    setActiveViewId(saved.id);
    setPage(1);
    resetSelection();
  }

  function clearView() {
    setView('all');
    setTerm('');
    setFilters(EMPTY_CANDIDATE_FILTERS);
    setListId('all');
    setActiveViewId(null);
    setPage(1);
    resetSelection();
  }

  function changeLayout(next: CandidateLayout) {
    setLayout(next);
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, next);
  }

  function changeSort(field: CandidateSortField) {
    setSortBy(field);
    setSortDir(ASC_SORT_FIELDS.has(field) ? 'asc' : 'desc');
    setPage(1);
    setActiveViewId(null);
    resetSelection();
  }

  const items = candidates.data?.items ?? [];
  const meta = candidates.data?.meta;
  const selectedCandidates = items.filter((candidate) => selectedIds.has(candidate.id));
  const activeFilterCount = countActiveFilters(filters);
  const isFiltered =
    deferredTerm.length > 0 ||
    view !== 'all' ||
    listId !== 'all' ||
    activeFilterCount > 0;

  const columns: DataTableColumn<CandidateListItem>[] = [
    {
      id: 'lastName',
      header: 'Candidate',
      sortable: true,
      cell: (candidate) => (
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <Link
              href={`/candidates/${candidate.id}`}
              className="truncate text-sm font-medium transition-colors hover:text-primary hover:underline"
            >
              {candidate.fullName}
            </Link>
            {candidate.isHot ? (
              <Flame className="size-3.5 shrink-0 text-destructive" role="img" aria-label="Hot candidate" />
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {candidate.currentTitle ?? 'No title on file'}
            {candidate.currentCompany ? <> @ {candidate.currentCompany}</> : null}
          </p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (candidate) => (
        <Badge variant={STATUS_VARIANT[candidate.status]}>
          {CANDIDATE_STATUS_LABELS[candidate.status]}
        </Badge>
      ),
    },
    {
      id: 'experience',
      header: 'Experience',
      className: 'hidden md:table-cell',
      headClassName: 'hidden md:table-cell',
      cell: (candidate) => {
        const duration = years(candidate.totalExperienceMonths);
        if (!candidate.experienceLevel && !duration) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        return (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {candidate.experienceLevel ? (
              <span className="capitalize text-foreground">
                {candidate.experienceLevel.toLowerCase()}
              </span>
            ) : null}
            {candidate.experienceLevel && duration ? ' · ' : null}
            {duration}
          </span>
        );
      },
    },
    {
      id: 'skills',
      header: 'Skills',
      className: 'hidden xl:table-cell',
      headClassName: 'hidden xl:table-cell',
      cell: (candidate) =>
        candidate.skills.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {candidate.skills.slice(0, 3).map((skill) => (
              <Badge key={skill.id} variant="muted">
                {skill.name}
              </Badge>
            ))}
            {candidate.skills.length > 3 ? (
              <span className="text-2xs text-muted-foreground">+{candidate.skills.length - 3}</span>
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: 'location',
      header: 'Location',
      className: 'hidden lg:table-cell',
      headClassName: 'hidden lg:table-cell',
      cell: (candidate) =>
        candidate.location ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{candidate.location}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: 'owner',
      header: 'Owner',
      className: 'hidden lg:table-cell',
      headClassName: 'hidden lg:table-cell',
      cell: (candidate) =>
        candidate.owner ? (
          <div className="flex items-center gap-2">
            <Avatar className="size-6">
              {candidate.owner.avatarUrl ? <AvatarImage src={candidate.owner.avatarUrl} alt="" /> : null}
              <AvatarFallback className="text-[9px]">
                {getInitials(candidate.owner.fullName)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-xs">{candidate.owner.fullName}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Unassigned</span>
        ),
    },
    {
      id: 'lastContactedAt',
      header: 'Last contact',
      sortable: true,
      className: 'hidden xl:table-cell',
      headClassName: 'hidden xl:table-cell',
      cell: (candidate) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {candidate.lastContactedAt
            ? formatDate(candidate.lastContactedAt, 'DD MMM YYYY', tenant?.timezone)
            : 'Never'}
        </span>
      ),
    },
    {
      id: 'updatedAt',
      header: 'Updated',
      sortable: true,
      className: 'hidden 2xl:table-cell',
      headClassName: 'hidden 2xl:table-cell',
      cell: (candidate) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDate(candidate.updatedAt, 'DD MMM YYYY', tenant?.timezone)}
        </span>
      ),
    },
  ];

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader title="Candidates" description="The talent pool: profiles, résumés and skills." />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to candidates"
          description="Ask a workspace administrator for the “View candidates” permission."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        title="Candidates"
        description={`The searchable talent pool for ${tenant?.name ?? 'this workspace'} — profiles, skills, availability and ownership.`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setDuplicatesOpen(true)}>
              <CopyPlus className="size-4" aria-hidden="true" />
              Find duplicates
            </Button>
            {canCreate ? (
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <FileUp className="size-4" aria-hidden="true" />
                Import from résumé
              </Button>
            ) : null}
            {canImport ? (
              <Button variant="outline" size="sm" onClick={() => setCsvImportOpen(true)}>
                <FileSpreadsheet className="size-4" aria-hidden="true" />
                Import CSV
              </Button>
            ) : null}
            {canCreate ? (
              <Button asChild size="sm">
                <Link href="/candidates/new">
                  <Plus className="size-4" aria-hidden="true" />
                  New candidate
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <Tabs
        value={view}
        onValueChange={(value) => {
          setView(value as CandidateView);
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
            placeholder="Search names, skills, titles… (boolean syntax supported)"
            aria-label="Search candidates"
            className="pl-9 pr-10"
          />
          <div className="absolute right-1 top-1/2 -translate-y-1/2">
            <BooleanSearchHelp />
          </div>
        </div>

        <CandidateFilters value={filters} onChange={updateFilters} onReset={() => updateFilters(EMPTY_CANDIDATE_FILTERS)} />

        <Select
          value={listId}
          onValueChange={(value) => {
            setListId(value);
            setPage(1);
            setActiveViewId(null);
            resetSelection();
          }}
        >
          <SelectTrigger className="lg:w-48" aria-label="Filter by hotlist">
            <SelectValue placeholder="All hotlists" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All hotlists</SelectItem>
            {(hotlists.data?.items ?? []).map((list) => (
              <SelectItem key={list.id} value={list.id}>
                {list.name} ({list.memberCount})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={(value) => changeSort(value as CandidateSortField)}>
          <SelectTrigger className="lg:w-48" aria-label="Sort candidates">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CANDIDATE_SORT_FIELDS.map((field) => (
              <SelectItem key={field} value={field}>
                {SORT_LABELS[field]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1 rounded-md border border-border p-0.5" role="group" aria-label="Layout">
          <Button
            type="button"
            variant={layout === 'table' ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-pressed={layout === 'table'}
            aria-label="Table layout"
            onClick={() => changeLayout('table')}
          >
            <Table2 className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant={layout === 'cards' ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-pressed={layout === 'cards'}
            aria-label="Card layout"
            onClick={() => changeLayout('cards')}
          >
            <LayoutGrid className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <SavedViewsBar
        entity="CANDIDATE"
        filters={savedFilters}
        sortBy={sortBy}
        sortDir={sortDir}
        activeViewId={activeViewId}
        onApply={applyView}
        onClear={clearView}
      />

      {selectedIds.size > 0 ? (
        <BulkActionBar
          scope="candidate"
          selectedIds={selectedIds}
          pageRowIds={items.map((candidate) => candidate.id)}
          total={meta?.total ?? items.length}
          filters={bulkFilters}
          onClear={resetSelection}
          onStarted={(operation) => setProgressId(operation.id)}
          extra={({ allMatching }) =>
            canMerge && !allMatching ? (
              <Button
                variant="outline"
                size="sm"
                disabled={selectedCandidates.length < 2}
                onClick={() => setMergeOpen(true)}
              >
                Merge
              </Button>
            ) : null
          }
        />
      ) : null}

      {layout === 'cards' ? (
        candidates.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-48 animate-pulse rounded-lg border border-border bg-muted/40" />
            ))}
          </div>
        ) : candidates.isError ? (
          <EmptyState
            title="Could not load candidates"
            description={candidates.error instanceof Error ? candidates.error.message : 'Please try again in a moment.'}
            action={
              <Button variant="outline" size="sm" onClick={() => void candidates.refetch()}>
                Retry
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Users}
            title={isFiltered ? 'No candidates match those filters' : 'No candidates yet'}
            description={
              isFiltered
                ? 'Clear the search box or pick a different view.'
                : 'Add your first candidate to start building the talent pool.'
            }
            action={
              isFiltered ? (
                <Button variant="outline" size="sm" onClick={clearView}>
                  Clear filters
                </Button>
              ) : canCreate ? (
                <Button asChild size="sm">
                  <Link href="/candidates/new">
                    <Plus className="size-4" aria-hidden="true" />
                    New candidate
                  </Link>
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((candidate) => (
              <div key={candidate.id} className="relative">
                <CandidateCard candidate={candidate} />
              </div>
            ))}
          </div>
        )
      ) : (
        <DataTable
          columns={columns}
          rows={items}
          getRowId={(candidate) => candidate.id}
          isPending={candidates.isPending}
          isError={candidates.isError}
          error={candidates.error}
          onRetry={() => void candidates.refetch()}
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={(id, dir) => {
            if (!SORT_FIELD_SET.has(id)) return;
            setSortBy(id as CandidateSortField);
            setSortDir(dir);
            setPage(1);
          }}
          skeletonRows={PAGE_SIZE / 3}
          empty={
            <EmptyState
              icon={Users}
              title={isFiltered ? 'No candidates match those filters' : 'No candidates yet'}
              description={
                isFiltered
                  ? 'Clear the search box or pick a different view.'
                  : 'Add your first candidate to start building the talent pool.'
              }
              action={
                isFiltered ? (
                  <Button variant="outline" size="sm" onClick={clearView}>
                    Clear filters
                  </Button>
                ) : canCreate ? (
                  <Button asChild size="sm">
                    <Link href="/candidates/new">
                      <Plus className="size-4" aria-hidden="true" />
                      New candidate
                    </Link>
                  </Button>
                ) : null
              }
            />
          }
        />
      )}

      {meta && meta.total > 0 ? (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            Showing {(meta.page - 1) * meta.pageSize + 1}–{Math.min(meta.page * meta.pageSize, meta.total)} of{' '}
            {meta.total} candidate{meta.total === 1 ? '' : 's'}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPage((value) => Math.max(1, value - 1));
                resetSelection();
              }}
              disabled={!meta.hasPrevious || candidates.isFetching}
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
              disabled={!meta.hasNext || candidates.isFetching}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <MergeCandidatesDialog
        candidates={selectedCandidates}
        open={mergeOpen}
        onOpenChange={setMergeOpen}
      />

      <FindDuplicatesDialog open={duplicatesOpen} onOpenChange={setDuplicatesOpen} />

      {canImport ? (
        <ImportWizardDialog
          open={csvImportOpen}
          onOpenChange={setCsvImportOpen}
          entity="CANDIDATE"
          onCompleted={() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.candidates.all });
          }}
        />
      ) : null}

      {canCreate ? (
        <ResumeUploadDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onUploaded={(uploaded) => {
            setImportOpen(false);
            setImportResumeId(uploaded.id);
          }}
        />
      ) : null}

      {canCreate && importResumeId ? (
        <ResumeReviewDialog
          open={importResumeId !== null}
          onOpenChange={(open) => {
            if (!open) setImportResumeId(null);
          }}
          resumeId={importResumeId}
          onAccepted={(candidateId, created) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.candidates.all });
            setImportResumeId(null);
            if (created) router.push(`/candidates/${candidateId}`);
          }}
        />
      ) : null}

      <BulkOperationProgress
        open={progressId !== null}
        onOpenChange={(open) => {
          if (!open) setProgressId(null);
        }}
        operationId={progressId}
        onSettled={() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.candidates.all });
        }}
      />
    </div>
  );
}
