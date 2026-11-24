'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailPlus, MoreHorizontal, Search, ShieldOff, Trash2, UserRound } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { toast } from 'sonner';

import {
  USER_STATUS_LABELS,
  type Paginated,
  type UserListItem,
  type UserQuery,
} from '@talentflow/types';
import { formatDate, formatRelativeTime, getInitials } from '@talentflow/ui';

import { PageHeader } from '@/components/shell/page-header';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DialogTrigger } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { InviteUserDialog } from '@/components/users/invite-user-dialog';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const PAGE_SIZE = 20;

const STATUS_VARIANT: Record<UserListItem['status'], BadgeProps['variant']> = {
  ACTIVE: 'success',
  INVITED: 'info',
  SUSPENDED: 'warning',
  DISABLED: 'muted',
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'ACTIVE', label: USER_STATUS_LABELS.ACTIVE },
  { value: 'INVITED', label: USER_STATUS_LABELS.INVITED },
  { value: 'SUSPENDED', label: USER_STATUS_LABELS.SUSPENDED },
  { value: 'DISABLED', label: USER_STATUS_LABELS.DISABLED },
] as const;

export default function UsersPage() {
  const { has, user: currentUser, tenant } = useSession();
  const queryClient = useQueryClient();

  const [term, setTerm] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [page, setPage] = useState(1);
  const deferredTerm = useDeferredValue(term.trim());

  const canRead = has('user:read');

  const query: Partial<UserQuery> = {
    page,
    pageSize: PAGE_SIZE,
    sortBy: 'createdAt',
    sortDir: 'desc',
    ...(deferredTerm ? { q: deferredTerm } : {}),
    ...(status === 'all' ? {} : { status: status as UserListItem['status'] }),
  };

  const users = useQuery({
    queryKey: queryKeys.users.list(query),
    queryFn: () => api.get<Paginated<UserListItem>>('/users', { query }),
    enabled: canRead,
    staleTime: 30_000,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: true }>(`/users/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      toast.success('Member removed from the workspace');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not remove this member');
    },
  });

  const resend = useMutation({
    mutationFn: (id: string) => api.post<{ sent: true }>(`/users/${id}/resend-invite`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      toast.success('Invitation re-sent');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not re-send the invitation');
    },
  });

  const items = users.data?.items ?? [];
  const meta = users.data?.meta;
  const isFiltered = deferredTerm.length > 0 || status !== 'all';

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader title="Users" description="Manage who can access this workspace." />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to user management"
          description="Ask a workspace administrator for the “View users” permission."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        title="Users"
        description={`Everyone with access to ${tenant?.name ?? 'this workspace'}, their roles and their team memberships.`}
        actions={has('user:invite') ? <InviteUserDialog /> : null}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
            }}
            placeholder="Search by name or email…"
            aria-label="Search users"
            className="pl-9"
          />
        </div>

        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-48" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
        {users.isPending ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : users.isError ? (
          <div className="p-5">
            <EmptyState
              title="Could not load users"
              description={
                users.error instanceof Error ? users.error.message : 'Please try again in a moment.'
              }
              action={
                <Button variant="outline" size="sm" onClick={() => void users.refetch()}>
                  Retry
                </Button>
              }
            />
          </div>
        ) : items.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={UserRound}
              title={isFiltered ? 'No members match those filters' : 'No members yet'}
              description={
                isFiltered
                  ? 'Clear the search box or pick a different status.'
                  : 'Invite your first teammate to start assigning jobs and clients.'
              }
              action={
                isFiltered ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTerm('');
                      setStatus('all');
                      setPage(1);
                    }}
                  >
                    Clear filters
                  </Button>
                ) : has('user:invite') ? (
                  <InviteUserDialog />
                ) : null
              }
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead className="hidden md:table-cell">Roles</TableHead>
                <TableHead className="hidden lg:table-cell">Teams</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden xl:table-cell">Last sign-in</TableHead>
                <TableHead className="hidden xl:table-cell">Joined</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt="" /> : null}
                        <AvatarFallback className="text-2xs">
                          {getInitials(member.fullName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {member.fullName}
                          {member.id === currentUser?.id ? (
                            <span className="ml-2 text-2xs text-muted-foreground">You</span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {member.roles.length > 0 ? (
                        member.roles.map((role) => (
                          <Badge key={role.id} variant="muted">
                            {role.name}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">No role</span>
                      )}
                    </div>
                  </TableCell>

                  <TableCell className="hidden lg:table-cell">
                    {member.teams.length > 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {member.teams.map((team) => team.name).join(', ')}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge variant={STATUS_VARIANT[member.status]}>
                        {USER_STATUS_LABELS[member.status]}
                      </Badge>
                      {!member.emailVerified && member.status !== 'INVITED' ? (
                        <span className="text-2xs text-warning">Email unverified</span>
                      ) : null}
                    </div>
                  </TableCell>

                  <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground xl:table-cell">
                    {member.lastLoginAt ? formatRelativeTime(member.lastLoginAt) : 'Never'}
                  </TableCell>

                  <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground xl:table-cell">
                    {formatDate(member.createdAt, 'DD MMM YYYY', tenant?.timezone)}
                  </TableCell>

                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${member.fullName}`}
                        >
                          <MoreHorizontal className="size-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuLabel>{member.fullName}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => {
                            void navigator.clipboard
                              .writeText(member.email)
                              .then(() => toast.success('Email copied'))
                              .catch(() => toast.error('Could not copy the email address'));
                          }}
                        >
                          Copy email
                        </DropdownMenuItem>
                        {has('user:invite') && member.status === 'INVITED' ? (
                          <DropdownMenuItem
                            disabled={resend.isPending}
                            onSelect={() => resend.mutate(member.id)}
                          >
                            <MailPlus className="size-4" aria-hidden="true" />
                            Re-send invitation
                          </DropdownMenuItem>
                        ) : null}
                        {has('user:delete') && member.id !== currentUser?.id ? (
                          <>
                            <DropdownMenuSeparator />
                            <ConfirmDialog
                              destructive
                              title={`Remove ${member.fullName}?`}
                              description="They immediately lose access to this workspace. Their history stays in the audit log and they can be restored later."
                              confirmLabel="Remove member"
                              trigger={
                                <DialogTrigger asChild>
                                  <DropdownMenuItem
                                    destructive
                                    onSelect={(event) => event.preventDefault()}
                                  >
                                    <Trash2 className="size-4" aria-hidden="true" />
                                    Remove from workspace
                                  </DropdownMenuItem>
                                </DialogTrigger>
                              }
                              onConfirm={() => remove.mutateAsync(member.id).then(() => undefined)}
                            />
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {meta && meta.total > 0 ? (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            Showing {(meta.page - 1) * meta.pageSize + 1}–{Math.min(meta.page * meta.pageSize, meta.total)} of{' '}
            {meta.total} member{meta.total === 1 ? '' : 's'}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={!meta.hasPrevious || users.isFetching}
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
              disabled={!meta.hasNext || users.isFetching}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
