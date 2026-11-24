'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, MoreHorizontal, Pencil, ShieldOff, Trash2, UserCog, Users2 } from 'lucide-react';
import { toast } from 'sonner';

import type { TeamListItem } from '@talentflow/types';
import { getInitials } from '@talentflow/ui';

import { PageHeader } from '@/components/shell/page-header';
import { TeamDialog } from '@/components/teams/team-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

export default function TeamsPage() {
  const { has } = useSession();
  const queryClient = useQueryClient();
  const canRead = has('user:read');
  const canManage = has('user:update');

  const teams = useQuery({
    queryKey: queryKeys.teams.list,
    queryFn: () => api.get<TeamListItem[]>('/teams'),
    enabled: canRead,
    staleTime: 60_000,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: true }>(`/teams/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.teams.all });
      toast.success('Team deleted');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not delete this team');
    },
  });

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader title="Teams" description="Group members for reporting and workload distribution." />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to teams"
          description="Ask a workspace administrator for the “View users” permission."
        />
      </div>
    );
  }

  const items = teams.data ?? [];
  const byId = new Map(items.map((team) => [team.id, team]));

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        title="Teams"
        description="Group members for reporting and workload distribution. Teams can nest to mirror your org chart."
        actions={
          canManage ? (
            <TeamDialog
              trigger={
                <Button size="sm">
                  <Users2 className="size-4" aria-hidden="true" />
                  New team
                </Button>
              }
            />
          ) : null
        }
      />

      {teams.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-44 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={UserCog}
          title="No teams yet"
          description="Create a team to group recruiters, engineers or account managers and see their workload in one place."
          action={
            canManage ? (
              <TeamDialog
                trigger={
                  <Button size="sm">
                    <Users2 className="size-4" aria-hidden="true" />
                    New team
                  </Button>
                }
              />
            ) : null
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((team) => (
            <Card key={team.id} className="relative overflow-hidden">
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1"
                style={{ backgroundColor: team.color ?? 'hsl(var(--border))' }}
              />
              <CardContent className="space-y-4 p-5 pl-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-medium">{team.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {team.parentId
                        ? `Part of ${byId.get(team.parentId)?.name ?? 'another team'}`
                        : 'Top-level team'}
                    </p>
                  </div>

                  {canManage ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${team.name}`}>
                          <MoreHorizontal className="size-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <TeamDialog
                          mode="edit"
                          team={team}
                          trigger={
                            <DialogTrigger asChild>
                              <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                                <Pencil className="size-4" aria-hidden="true" />
                                Edit team
                              </DropdownMenuItem>
                            </DialogTrigger>
                          }
                        />
                        <DropdownMenuSeparator />
                        <ConfirmDialog
                          destructive
                          title={`Delete ${team.name}?`}
                          description="Members stay in the workspace and keep their other team memberships. Sub-teams must be moved first."
                          confirmLabel="Delete team"
                          trigger={
                            <DialogTrigger asChild>
                              <DropdownMenuItem
                                destructive
                                onSelect={(event) => event.preventDefault()}
                              >
                                <Trash2 className="size-4" aria-hidden="true" />
                                Delete team
                              </DropdownMenuItem>
                            </DialogTrigger>
                          }
                          onConfirm={() => remove.mutateAsync(team.id).then(() => undefined)}
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>

                {team.description ? (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{team.description}</p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="muted" className="gap-1">
                    <Users2 className="size-3" aria-hidden="true" />
                    {team.memberCount} member{team.memberCount === 1 ? '' : 's'}
                  </Badge>
                  <Badge variant={team.openJobs > 0 ? 'info' : 'muted'} className="gap-1">
                    <Briefcase className="size-3" aria-hidden="true" />
                    {team.openJobs} open
                  </Badge>
                </div>

                <div className="flex items-center gap-2 border-t border-border pt-3">
                  {team.leader ? (
                    <>
                      <Avatar className="size-6">
                        {team.leader.avatarUrl ? (
                          <AvatarImage src={team.leader.avatarUrl} alt="" />
                        ) : null}
                        <AvatarFallback className="text-2xs">
                          {getInitials(team.leader.fullName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs text-muted-foreground">
                        Lead · {team.leader.fullName}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">No team lead assigned</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
