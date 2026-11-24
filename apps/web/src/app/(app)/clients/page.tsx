'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Search, ShieldOff, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { toast } from 'sonner';

import {
  CLIENT_STATUS_LABELS,
  clientStatusSchema,
  type ClientListItem,
  type ClientStatus,
  type Paginated,
  type SavedViewItem,
  type UserListItem,
} from '@talentflow/types';
import { formatDate, getInitials } from '@talentflow/ui';

import { SavedViewsBar } from '@/components/saved-views/saved-views-bar';
import { PageHeader } from '@/components/shell/page-header';
import { ClientRowActionsMenu } from '@/components/clients/client-actions-menu';
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

type ClientSortField = 'name' | 'status' | 'createdAt' | 'updatedAt';
const SORT_FIELD_SET = new Set<string>(['name', 'status', 'createdAt', 'updatedAt']);

/** The list's preset views — each is a named filter, not a client-side split. */
const VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'My clients' },
  { value: 'PROSPECT', label: 'Prospects' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'CHURNED', label: 'Churned' },
] as const;
type ClientView = (typeof VIEWS)[number]['value'];

const STATUS_VARIANT: Record<ClientStatus, BadgeProps['variant']> = {
  PROSPECT: 'info',
  ACTIVE: 'success',
  INACTIVE: 'muted',
  CHURNED: 'destructive',
};

/** The `status` filter a preset view implies, if any. */
function viewStatus(view: ClientView): ClientStatus | undefined {
  const parsed = clientStatusSchema.safeParse(view);
  return parsed.success ? parsed.data : undefined;
}

export default function ClientsPage() {
  const { has, tenant } = useSession();
  const queryClient = useQueryClient();

  const [view, setView] = useState<ClientView>('all');
  const [term, setTerm] = useState('');
  const [ownerId, setOwnerId] = useState('all');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<ClientSortField>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  const deferredTerm = useDeferredValue(term.trim());

  const canRead = has('client:read_all') || has('client:read_own');
  const canCreate = has('client:create');
  const canDelete = has('client:delete');

  const viewFilter =
    view === 'mine'
      ? ({ mine: true } as const)
      : viewStatus(view)
        ? ({ status: viewStatus(view) } as const)
        : ({} as const);

  const query = {
    page,
    pageSize: PAGE_SIZE,
    sortBy,
    sortDir,
    ...(deferredTerm ? { q: deferredTerm } : {}),
    ...viewFilter,
    ...(ownerId === 'all' ? {} : { ownerId }),
  };

  const clients = useQuery({
    queryKey: queryKeys.clients.list(query),
    queryFn: () => api.get<Paginated<ClientListItem>>('/clients', { query }),
    enabled: canRead,
    staleTime: 30_000,
  });

  const owners = useQuery({
    queryKey: queryKeys.users.list({ pageSize: 100, status: 'ACTIVE' }),
    queryFn: () =>
      api.get<Paginated<UserListItem>>('/users', { query: { pageSize: 100, status: 'ACTIVE' } }),
    enabled: canRead,
    staleTime: 60_000,
  });

  const deleteClients = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map((id) => api.delete(`/clients/${id}`)));
      const failed = results.filter((result) => result.status === 'rejected').length;
      return { total: ids.length, failed };
    },
    onSuccess: ({ total, failed }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients.all });
      setSelectedIds(new Set());
      if (failed === 0) {
        toast.success(`Deleted ${total} client${total === 1 ? '' : 's'}`);
      } else {
        toast.warning(`${total - failed} of ${total} deleted · ${failed} could not be deleted`);
      }
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not delete the selected clients');
    },
  });

  const savedFilters: Record<string, unknown> = {
    view,
    ...(deferredTerm ? { q: deferredTerm } : {}),
    ...(ownerId === 'all' ? {} : { ownerId }),
  };

  function resetSelection() {
    setSelectedIds(new Set());
  }

  function applyView(saved: SavedViewItem) {
    const filters = saved.filters;
    if (typeof filters.view === 'string' && VIEWS.some((entry) => entry.value === filters.view)) {
      setView(filters.view as ClientView);
    }
    setTerm(typeof filters.q === 'string' ? filters.q : '');
    setOwnerId(typeof filters.ownerId === 'string' ? filters.ownerId : 'all');
    if (saved.sortBy && SORT_FIELD_SET.has(saved.sortBy)) setSortBy(saved.sortBy as ClientSortField);
    if (saved.sortDir) setSortDir(saved.sortDir);
    setActiveViewId(saved.id);
    setPage(1);
    resetSelection();
  }

  function clearView() {
    setView('all');
    setTerm('');
    setOwnerId('all');
    setActiveViewId(null);
    setPage(1);
    resetSelection();
  }

  const items = clients.data?.items ?? [];
  const meta = clients.data?.meta;
  const isFiltered = deferredTerm.length > 0 || view !== 'all' || ownerId !== 'all';

  const columns: DataTableColumn<ClientListItem>[] = [
    {
      id: 'name',
      header: 'Client',
      sortable: true,
      cell: (client) => (
        <div className="min-w-0 space-y-0.5">
          <Link
            href={`/clients/${client.id}`}
            className="block truncate text-sm font-medium transition-colors hover:text-primary hover:underline"
          >
            {client.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {[client.industry, client.city, client.country].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortable: true,
      cell: (client) => (
        <Badge variant={STATUS_VARIANT[client.status]}>{CLIENT_STATUS_LABELS[client.status]}</Badge>
      ),
    },
    {
      id: 'contacts',
      header: 'Contacts',
      cell: (client) => (
        <span className="whitespace-nowrap text-xs">
          <span className="font-medium">{client.contactCount}</span>
          <span className="text-muted-foreground"> contact{client.contactCount === 1 ? '' : 's'}</span>
        </span>
      ),
    },
    {
      id: 'jobs',
      header: 'Open jobs',
      cell: (client) => (
        <span className="whitespace-nowrap text-xs">
          <span className="font-medium">{client.openJobs}</span>
          <span className="text-muted-foreground"> open · {client.totalJobs} total</span>
        </span>
      ),
    },
    {
      id: 'owner',
      header: 'Owner',
      className: 'hidden lg:table-cell',
      headClassName: 'hidden lg:table-cell',
      cell: (client) =>
        client.owner ? (
          <div className="flex items-center gap-2">
            <Avatar className="size-6">
              {client.owner.avatarUrl ? <AvatarImage src={client.owner.avatarUrl} alt="" /> : null}
              <AvatarFallback className="text-[9px]">
                {getInitials(client.owner.fullName)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-xs">{client.owner.fullName}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Unassigned</span>
        ),
    },
    {
      id: 'updatedAt',
      header: 'Updated',
      sortable: true,
      className: 'hidden xl:table-cell',
      headClassName: 'hidden xl:table-cell',
      cell: (client) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDate(client.updatedAt, 'DD MMM YYYY', tenant?.timezone)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (client) => (
        <div className="flex justify-end">
          <ClientRowActionsMenu client={client} />
        </div>
      ),
    },
  ];

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader title="Clients" description="Client companies, contacts and open requisitions." />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to clients"
          description="Ask a workspace administrator for the “View clients” permission."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        title="Clients"
        description={`The companies ${tenant?.name ?? 'this workspace'} recruits for — contacts, open requisitions and account ownership.`}
        actions={
          canCreate ? (
            <Button asChild size="sm">
              <Link href="/clients/new">
                <Plus className="size-4" aria-hidden="true" />
                New client
              </Link>
            </Button>
          ) : null
        }
      />

      <Tabs
        value={view}
        onValueChange={(value) => {
          setView(value as ClientView);
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
            placeholder="Search by name, industry or city…"
            aria-label="Search clients"
            className="pl-9"
          />
        </div>

        <Select
          value={ownerId}
          onValueChange={(value) => {
            setOwnerId(value);
            setPage(1);
            setActiveViewId(null);
            resetSelection();
          }}
        >
          <SelectTrigger className="lg:w-48" aria-label="Filter by owner">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All owners</SelectItem>
            {(owners.data?.items ?? []).map((owner) => (
              <SelectItem key={owner.id} value={owner.id}>
                {owner.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SavedViewsBar
        entity="CLIENT"
        filters={savedFilters}
        sortBy={sortBy}
        sortDir={sortDir}
        activeViewId={activeViewId}
        onApply={applyView}
        onClear={clearView}
      />

      {selectedIds.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-card">
          <span className="text-xs text-muted-foreground">
            {selectedIds.size} client{selectedIds.size === 1 ? '' : 's'} selected
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={resetSelection}>
              Clear
            </Button>
            {canDelete ? (
              <ConfirmDialog
                destructive
                title={`Delete ${selectedIds.size} client${selectedIds.size === 1 ? '' : 's'}?`}
                description="They are removed from every list. Their jobs, contacts and placements are retained."
                confirmLabel="Delete clients"
                trigger={
                  <Button variant="outline" size="sm" className="text-destructive">
                    <Trash2 className="size-4" aria-hidden="true" />
                    Delete
                  </Button>
                }
                onConfirm={() =>
                  deleteClients
                    .mutateAsync([...selectedIds])
                    .then(() => undefined)
                    .catch(() => undefined)
                }
              />
            ) : null}
          </div>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={items}
        getRowId={(client) => client.id}
        isPending={clients.isPending}
        isError={clients.isError}
        error={clients.error}
        onRetry={() => void clients.refetch()}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(id, dir) => {
          if (!SORT_FIELD_SET.has(id)) return;
          setSortBy(id as ClientSortField);
          setSortDir(dir);
          setPage(1);
        }}
        empty={
          <EmptyState
            icon={Building2}
            title={isFiltered ? 'No clients match those filters' : 'No clients yet'}
            description={
              isFiltered
                ? 'Clear the search box or pick a different view.'
                : 'Add the companies you recruit for to start tracking contacts and requisitions.'
            }
            action={
              isFiltered ? (
                <Button variant="outline" size="sm" onClick={clearView}>
                  Clear filters
                </Button>
              ) : canCreate ? (
                <Button asChild size="sm">
                  <Link href="/clients/new">
                    <Plus className="size-4" aria-hidden="true" />
                    New client
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
            {Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total} client
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
              disabled={!meta.hasPrevious || clients.isFetching}
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
              disabled={!meta.hasNext || clients.isFetching}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
