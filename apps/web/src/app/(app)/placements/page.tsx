'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Handshake, Pencil, Search, ShieldOff, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { toast } from 'sonner';

import {
  PLACEMENT_STATUS_LABELS,
  RATE_TYPE_LABELS,
  placementStatusSchema,
  rateTypeSchema,
  type ClientListItem,
  type Paginated,
  type PlacementListItem,
  type PlacementStats,
  type PlacementStatus,
  type UserListItem,
} from '@talentflow/types';
import { formatCurrency, formatDate } from '@talentflow/ui';

import { PlacementDialog } from '@/components/placements/placement-dialog';
import { PageHeader } from '@/components/shell/page-header';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DialogTrigger } from '@/components/ui/dialog';
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
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const PAGE_SIZE = 20;

const STATUS_VARIANT: Record<PlacementStatus, BadgeProps['variant']> = {
  PENDING: 'muted',
  ACTIVE: 'success',
  COMPLETED: 'info',
  TERMINATED: 'destructive',
};

type PlacementSortField = 'createdAt' | 'updatedAt' | 'startDate';
const SORT_FIELD_SET = new Set<string>(['createdAt', 'updatedAt', 'startDate']);

function money(cents: number | null, currency: string): string | null {
  return cents === null
    ? null
    : formatCurrency({ amount: cents / 100, currency, maximumFractionDigits: 2 });
}

function rate(cents: number | null, currency: string, period: string): string | null {
  const amount = money(cents, currency);
  if (amount === null) return null;
  const parsed = rateTypeSchema.safeParse(period);
  return parsed.success ? `${amount} ${RATE_TYPE_LABELS[parsed.data]}` : amount;
}

/**
 * Every placement in the workspace: who was placed, with which client, on what
 * terms. The margin column is only rendered — and only sent — for callers who
 * hold `placement:view_margin`.
 */
export default function PlacementsPage() {
  const { has, tenant } = useSession();
  const queryClient = useQueryClient();

  const canRead = has('placement:read_all') || has('placement:read_own');
  const canUpdate = has('placement:update');
  const canDelete = has('placement:delete');
  const canViewMargin = has('placement:view_margin');

  const [view, setView] = useState<'all' | PlacementStatus>('all');
  const [clientId, setClientId] = useState('all');
  const [recruiterId, setRecruiterId] = useState('all');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<PlacementSortField>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [editing, setEditing] = useState<PlacementListItem | null>(null);

  const deferredTerm = useDeferredValue(term.trim());

  const filters = {
    ...(view === 'all' ? {} : { status: view }),
    ...(clientId === 'all' ? {} : { clientId }),
    ...(recruiterId === 'all' ? {} : { recruiterId }),
    ...(deferredTerm ? { q: deferredTerm } : {}),
  };

  // The tiles are a status breakdown, so they deliberately ignore the status
  // filter — otherwise picking "Active" would zero every other count.
  const statsFilters = {
    ...(clientId === 'all' ? {} : { clientId }),
    ...(recruiterId === 'all' ? {} : { recruiterId }),
    ...(deferredTerm ? { q: deferredTerm } : {}),
  };

  const query = { page, pageSize: PAGE_SIZE, sortBy, sortDir, ...filters };

  const placements = useQuery({
    queryKey: queryKeys.placements.list(query),
    queryFn: () => api.get<Paginated<PlacementListItem>>('/placements', { query }),
    enabled: canRead,
    staleTime: 20_000,
  });

  const stats = useQuery({
    queryKey: queryKeys.placements.stats(statsFilters),
    queryFn: () => api.get<PlacementStats>('/placements/stats', { query: statsFilters }),
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

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: true }>(`/placements/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.placements.all });
      toast.success('Placement deleted');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not delete the placement');
    },
  });

  const items = placements.data?.items ?? [];
  const meta = placements.data?.meta;
  const isFiltered =
    view !== 'all' || clientId !== 'all' || recruiterId !== 'all' || deferredTerm.length > 0;

  function clearFilters() {
    setView('all');
    setClientId('all');
    setRecruiterId('all');
    setTerm('');
    setPage(1);
  }

  const columns: DataTableColumn<PlacementListItem>[] = [
    {
      id: 'candidate',
      header: 'Candidate',
      cell: (placement) => (
        <div className="min-w-0 space-y-0.5">
          <Link
            href={`/applications/${placement.applicationId}`}
            className="block truncate text-sm font-medium transition-colors hover:text-primary hover:underline"
          >
            {placement.candidate.fullName}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {placement.job ? placement.job.title : 'No requisition'}
          </p>
        </div>
      ),
    },
    {
      id: 'client',
      header: 'Client',
      className: 'hidden lg:table-cell',
      headClassName: 'hidden lg:table-cell',
      cell: (placement) =>
        placement.client ? (
          <Link
            href={`/clients/${placement.client.id}`}
            className="truncate text-sm transition-colors hover:text-primary hover:underline"
          >
            {placement.client.name}
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">Not linked</span>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (placement) => (
        <Badge variant={STATUS_VARIANT[placement.status]}>
          {PLACEMENT_STATUS_LABELS[placement.status]}
        </Badge>
      ),
    },
    {
      id: 'startDate',
      header: 'Start',
      sortable: true,
      cell: (placement) => (
        <span className="whitespace-nowrap text-xs">
          {placement.startDate ? (
            formatDate(placement.startDate, 'DD MMM YYYY', tenant?.timezone)
          ) : (
            <span className="text-muted-foreground">Not started</span>
          )}
          {placement.endDate ? (
            <span className="block text-2xs text-muted-foreground">
              to {formatDate(placement.endDate, 'DD MMM YYYY', tenant?.timezone)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'rates',
      header: 'Rates',
      className: 'hidden xl:table-cell',
      headClassName: 'hidden xl:table-cell',
      cell: (placement) => {
        const pay = rate(placement.payRateCents, placement.currency, placement.ratePeriod);
        const bill = rate(placement.billRateCents, placement.currency, placement.ratePeriod);
        if (!pay && !bill) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <span className="whitespace-nowrap text-xs">
            {pay ?? '—'}
            <span className="block text-2xs text-muted-foreground">bill {bill ?? '—'}</span>
          </span>
        );
      },
    },
    ...(canViewMargin
      ? [
          {
            id: 'margin',
            header: 'Margin',
            cell: (placement: PlacementListItem) => (
              <span className="whitespace-nowrap text-xs">
                {money(placement.margin?.marginCents ?? null, placement.currency) ?? '—'}
                {placement.margin?.marginPercentage != null ? (
                  <span className="block text-2xs text-muted-foreground">
                    {placement.margin.marginPercentage}%
                  </span>
                ) : null}
              </span>
            ),
          },
        ]
      : []),
    {
      id: 'recruiter',
      header: 'Recruiter',
      className: 'hidden xl:table-cell',
      headClassName: 'hidden xl:table-cell',
      cell: (placement) =>
        placement.recruiter ? (
          <span className="truncate text-xs">{placement.recruiter.fullName}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Unassigned</span>
        ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (placement) => (
        <div className="flex items-center justify-end gap-1">
          {canUpdate ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit ${placement.candidate.fullName}`}
              onClick={() => setEditing(placement)}
            >
              <Pencil className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
          {canDelete ? (
            <ConfirmDialog
              destructive
              title="Delete this placement?"
              description="It is removed from every list. The application and its offer are retained."
              confirmLabel="Delete placement"
              trigger={
                <DialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${placement.candidate.fullName}`}
                    disabled={remove.isPending}
                  >
                    <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                  </Button>
                </DialogTrigger>
              }
              onConfirm={() => remove.mutateAsync(placement.id).then(() => undefined)}
            />
          ) : null}
        </div>
      ),
    },
  ];

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader
          title="Placements"
          description="Candidates who have been placed, and on what terms."
        />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to placements"
          description="Ask a workspace administrator for the “View placements” permission."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        title="Placements"
        description={`Candidates ${tenant?.name ?? 'this workspace'} has placed with clients.`}
      />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Total" value={stats.data?.total} />
        <StatTile label="Pending" value={stats.data?.pending} />
        <StatTile label="Active" value={stats.data?.active} />
        <StatTile label="Completed" value={stats.data?.completed} />
        <StatTile label="Terminated" value={stats.data?.terminated} />
      </div>

      {stats.data?.margin ? (
        <Card>
          <CardContent className="grid gap-3 py-5 sm:grid-cols-3">
            <div className="space-y-0.5">
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">Total margin</p>
              <p className="text-lg font-semibold">
                {money(stats.data.margin.totalMarginCents, stats.data.margin.currency ?? 'USD') ??
                  '—'}
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">Total fees</p>
              <p className="text-lg font-semibold">
                {money(stats.data.margin.totalFeeCents, stats.data.margin.currency ?? 'USD') ?? '—'}
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">
                Average margin
              </p>
              <p className="text-lg font-semibold">
                {stats.data.margin.averageMarginPercentage !== null
                  ? `${stats.data.margin.averageMarginPercentage}%`
                  : '—'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setPage(1);
            }}
            placeholder="Search invoice ref, candidate or job"
            aria-label="Search placements"
            className="pl-9"
          />
        </div>

        <Select
          value={view}
          onValueChange={(value) => {
            setView(value as 'all' | PlacementStatus);
            setPage(1);
          }}
        >
          <SelectTrigger className="lg:w-44" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {placementStatusSchema.options.map((status) => (
              <SelectItem key={status} value={status}>
                {PLACEMENT_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={clientId}
          onValueChange={(value) => {
            setClientId(value);
            setPage(1);
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

      <DataTable
        columns={columns}
        rows={items}
        getRowId={(placement) => placement.id}
        isPending={placements.isPending}
        isError={placements.isError}
        error={placements.error}
        onRetry={() => void placements.refetch()}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(id, dir) => {
          if (!SORT_FIELD_SET.has(id)) return;
          setSortBy(id as PlacementSortField);
          setSortDir(dir);
          setPage(1);
        }}
        empty={
          <EmptyState
            icon={Handshake}
            title={isFiltered ? 'No placements match those filters' : 'No placements yet'}
            description={
              isFiltered
                ? 'Clear the filters or pick a different status.'
                : 'Accept an offer on an application to raise the first placement.'
            }
            action={
              isFiltered ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
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
            {Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total} placement
            {meta.total === 1 ? '' : 's'}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={!meta.hasPrevious || placements.isFetching}
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
              disabled={!meta.hasNext || placements.isFetching}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <PlacementDialog
        placement={editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number | undefined }) {
  return (
    <Card>
      <CardContent className="space-y-0.5 py-5">
        <p className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</p>
        {value === undefined ? (
          <Skeleton className="h-6 w-10" />
        ) : (
          <p className="text-lg font-semibold">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}
