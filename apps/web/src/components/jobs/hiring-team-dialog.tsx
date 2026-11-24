'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { type JobDetail, type Paginated, type UserListItem } from '@talentflow/types';
import { cn, getInitials } from '@talentflow/ui';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

const RECRUITER_ROLES = ['OWNER', 'RECRUITER', 'SOURCING', 'COORDINATOR'] as const;
type RecruiterRole = (typeof RECRUITER_ROLES)[number];

const RECRUITER_ROLE_LABELS: Record<RecruiterRole, string> = {
  OWNER: 'Hiring owner',
  RECRUITER: 'Recruiter',
  SOURCING: 'Sourcer',
  COORDINATOR: 'Coordinator',
};

interface AssignmentEntry {
  role: RecruiterRole;
  isPrimary: boolean;
}

function toRole(value: string): RecruiterRole {
  return (RECRUITER_ROLES as readonly string[]).includes(value)
    ? (value as RecruiterRole)
    : 'RECRUITER';
}

interface HiringTeamDialogProps {
  jobId: string;
  job: JobDetail;
  trigger: ReactNode;
}

/** Replace the recruiters assigned to a requisition. */
export function HiringTeamDialog({ jobId, job, trigger }: HiringTeamDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [assignments, setAssignments] = useState<Record<string, AssignmentEntry>>({});

  useEffect(() => {
    if (!open) return;
    const next: Record<string, AssignmentEntry> = {};
    for (const entry of job.assignments) {
      next[entry.userId] = { role: toRole(entry.role), isPrimary: entry.isPrimary };
    }
    setAssignments(next);
    setTerm('');
  }, [open, job.assignments]);

  const users = useQuery({
    queryKey: queryKeys.users.list({ pageSize: 100, status: 'ACTIVE' }),
    queryFn: () =>
      api.get<Paginated<UserListItem>>('/users', { query: { pageSize: 100, status: 'ACTIVE' } }),
    enabled: open,
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: () =>
      api.put<JobDetail>(`/jobs/${jobId}/recruiters`, {
        assignments: Object.entries(assignments).map(([userId, entry]) => ({
          userId,
          role: entry.role,
          isPrimary: entry.isPrimary,
        })),
        notify: true,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      toast.success('Hiring team updated');
      setOpen(false);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not update the hiring team');
    },
  });

  const filtered = useMemo(() => {
    const items = users.data?.items ?? [];
    const needle = term.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (user) =>
        user.fullName.toLowerCase().includes(needle) ||
        user.email.toLowerCase().includes(needle),
    );
  }, [users.data, term]);

  const selectedCount = Object.keys(assignments).length;

  function toggle(userId: string) {
    setAssignments((previous) => {
      const next = { ...previous };
      if (next[userId]) delete next[userId];
      else next[userId] = { role: 'RECRUITER', isPrimary: false };
      return next;
    });
  }

  function setRole(userId: string, role: RecruiterRole) {
    setAssignments((previous) => {
      const entry = previous[userId];
      if (!entry) return previous;
      return { ...previous, [userId]: { ...entry, role } };
    });
  }

  function setPrimary(userId: string) {
    setAssignments((previous) => {
      const next: Record<string, AssignmentEntry> = {};
      for (const [id, entry] of Object.entries(previous)) {
        next[id] = { ...entry, isPrimary: id === userId };
      }
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Hiring team</DialogTitle>
          <DialogDescription>
            Choose the recruiters working this requisition and mark one as the hiring owner. They are
            notified when added.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search people…"
            aria-label="Search people"
            className="pl-9"
          />
        </div>

        <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
          {users.isPending ? (
            Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))
          ) : users.isError ? (
            <EmptyState
              title="Could not load people"
              description="Please try again in a moment."
              action={
                <Button variant="outline" size="sm" onClick={() => void users.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No people match"
              description="Try a different name or email."
            />
          ) : (
            filtered.map((user) => {
              const entry = assignments[user.id];
              const selected = entry !== undefined;
              return (
                <div
                  key={user.id}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-2.5 transition-colors',
                    selected ? 'border-primary/40 bg-primary/5' : 'border-border',
                  )}
                >
                  <Checkbox
                    checked={selected}
                    onCheckedChange={() => toggle(user.id)}
                    aria-label={`Assign ${user.fullName}`}
                  />

                  <Avatar className="size-8">
                    {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
                    <AvatarFallback className="text-[10px]">
                      {getInitials(user.fullName)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{user.fullName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {user.title ?? user.email}
                    </p>
                  </div>

                  {selected ? (
                    <div className="flex items-center gap-2">
                      <Select
                        value={entry.role}
                        onValueChange={(value) => setRole(user.id, value as RecruiterRole)}
                      >
                        <SelectTrigger
                          className="h-8 w-36"
                          aria-label={`Role for ${user.fullName}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RECRUITER_ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {RECRUITER_ROLE_LABELS[role]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Button
                        type="button"
                        variant={entry.isPrimary ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setPrimary(user.id)}
                        aria-pressed={entry.isPrimary}
                      >
                        {entry.isPrimary ? 'Primary' : 'Make primary'}
                      </Button>
                    </div>
                  ) : (
                    <Badge variant="muted">{user.email}</Badge>
                  )}
                </div>
              );
            })
          )}
        </div>

        <DialogFooter>
          <span className="mr-auto self-center text-xs text-muted-foreground">
            {selectedCount} recruiter{selectedCount === 1 ? '' : 's'} selected
          </span>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
