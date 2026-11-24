'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Pencil, Plus, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { ROLE_KEY_LABELS, type Paginated, type RoleListItem, type RoleQuery } from '@talentflow/types';
import { formatRelativeTime } from '@talentflow/ui';

import { PageHeader } from '@/components/shell/page-header';
import { RoleDialog } from '@/components/roles/role-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DialogTrigger } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const PAGE_SIZE = 25;

export default function RolesPage() {
  const { has } = useSession();
  const queryClient = useQueryClient();
  const canRead = has('role:read');
  const canManage = has('role:manage');

  const [page, setPage] = useState(1);

  const query: Partial<RoleQuery> = { page, pageSize: PAGE_SIZE, includeSystem: true };

  const roles = useQuery({
    queryKey: queryKeys.roles.list(query),
    queryFn: () => api.get<Paginated<RoleListItem>>('/roles', { query }),
    enabled: canRead,
    staleTime: 60_000,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: true }>(`/roles/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      toast.success('Role deleted');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not delete this role');
    },
  });

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader title="Roles & permissions" description="Control what each member can do." />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to roles"
          description="Ask a workspace administrator for the “View roles” permission."
        />
      </div>
    );
  }

  const items = roles.data?.items ?? [];
  const meta = roles.data?.meta;

  const newRoleButton = (
    <Button size="sm">
      <Plus className="size-4" aria-hidden="true" />
      New role
    </Button>
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        title="Roles & permissions"
        description="Every workspace starts with five built-in roles. Clone one, then adjust the permissions to fit how your team actually works."
        actions={canManage ? <RoleDialog trigger={newRoleButton} /> : null}
      />

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
        {roles.isPending ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={ShieldCheck}
              title="No roles in this workspace"
              description="Create a role to start granting access to jobs, candidates and clients."
              action={canManage ? <RoleDialog trigger={newRoleButton} /> : null}
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Permissions</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="hidden lg:table-cell">Updated</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((role) => (
                <TableRow key={role.id}>
                  <TableCell>
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">{role.name}</p>
                      <p className="max-w-md truncate text-xs text-muted-foreground">
                        {role.description ?? (role.key ? ROLE_KEY_LABELS[role.key] : 'Custom role')}
                      </p>
                    </div>
                  </TableCell>

                  <TableCell>
                    {role.isSystem ? (
                      <Badge variant="default">Built-in</Badge>
                    ) : (
                      <Badge variant="outline">Custom</Badge>
                    )}
                  </TableCell>

                  <TableCell className="text-right text-sm tabular-nums">{role.permissionCount}</TableCell>

                  <TableCell className="text-right text-sm tabular-nums">{role.userCount}</TableCell>

                  <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground lg:table-cell">
                    {formatRelativeTime(role.updatedAt)}
                  </TableCell>

                  <TableCell>
                    {canManage ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${role.name}`}>
                            <MoreHorizontal className="size-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <RoleDialog
                            mode="edit"
                            role={role}
                            trigger={
                              <DialogTrigger asChild>
                                <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                                  <Pencil className="size-4" aria-hidden="true" />
                                  Edit permissions
                                </DropdownMenuItem>
                              </DialogTrigger>
                            }
                          />

                          {!role.isSystem ? (
                            <>
                              <DropdownMenuSeparator />
                              <ConfirmDialog
                                destructive
                                title={`Delete ${role.name}?`}
                                description={
                                  role.userCount > 0
                                    ? `${role.userCount} member${role.userCount === 1 ? '' : 's'} hold this role and will lose the permissions it grants.`
                                    : 'This role is not held by anyone and can be safely removed.'
                                }
                                confirmLabel="Delete role"
                                trigger={
                                  <DialogTrigger asChild>
                                    <DropdownMenuItem
                                      destructive
                                      onSelect={(event) => event.preventDefault()}
                                    >
                                      <Trash2 className="size-4" aria-hidden="true" />
                                      Delete role
                                    </DropdownMenuItem>
                                  </DialogTrigger>
                                }
                                onConfirm={() => remove.mutateAsync(role.id).then(() => undefined)}
                              />
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <RoleDialog
                        role={role}
                        trigger={
                          <Button variant="ghost" size="icon-sm" aria-label={`View ${role.name}`}>
                            <ShieldCheck className="size-4" aria-hidden="true" />
                          </Button>
                        }
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {meta && meta.pageCount > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={!meta.hasPrevious || roles.isFetching}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {meta.page} of {meta.pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((value) => value + 1)}
            disabled={!meta.hasNext || roles.isFetching}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
