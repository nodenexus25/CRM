'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  createTeamSchema,
  type Paginated,
  type TeamListItem,
  type UserListItem,
} from '@talentflow/types';
import { cn, getInitials } from '@talentflow/ui';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';

import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

/** Palette offered instead of a free-text hex field so the value is always valid. */
export const TEAM_COLORS = [
  '#4F46E5',
  '#0EA5E9',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#64748B',
] as const;

const NO_SELECTION = '__none__';

/**
 * The dialog collects the same constraints the API enforces; `''` stands in for
 * "not set" because a Radix `Select` cannot hold `undefined`.
 */
const teamFormSchema = z.object({
  name: createTeamSchema.shape.name,
  description: z.string().trim().max(400),
  color: z.union([z.literal(''), createTeamSchema.shape.color]),
  parentId: z.string(),
  leaderId: z.string(),
  memberIds: z.array(z.string()),
});

type TeamFormValues = z.infer<typeof teamFormSchema>;

const EMPTY: TeamFormValues = {
  name: '',
  description: '',
  color: '',
  parentId: '',
  leaderId: '',
  memberIds: [],
};

interface TeamDialogProps {
  mode?: 'create' | 'edit';
  team?: TeamListItem;
  trigger: React.ReactNode;
}

export function TeamDialog({ mode = 'create', team, trigger }: TeamDialogProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { has } = useSession();
  const canReadUsers = has('user:read');

  const form = useForm<TeamFormValues>({
    resolver: zodResolver(teamFormSchema),
    defaultValues: EMPTY,
  });

  const users = useQuery({
    queryKey: queryKeys.users.list({ page: 1, pageSize: 100, sortBy: 'firstName', sortDir: 'asc' }),
    queryFn: () =>
      api.get<Paginated<UserListItem>>('/users', {
        query: { page: 1, pageSize: 100, sortBy: 'firstName', sortDir: 'asc' },
      }),
    enabled: open && canReadUsers,
    staleTime: 300_000,
  });

  const parents = useQuery({
    queryKey: queryKeys.teams.list,
    queryFn: () => api.get<TeamListItem[]>('/teams'),
    enabled: open && mode === 'create',
    staleTime: 60_000,
  });

  const name = form.watch('name');
  const color = form.watch('color');
  const leaderId = form.watch('leaderId');
  const memberIds = form.watch('memberIds');

  const save = useMutation({
    mutationFn: async (values: TeamFormValues) => {
      const shared = {
        name: values.name,
        description: values.description || undefined,
        color: values.color || undefined,
        parentId: values.parentId ? values.parentId : null,
        leaderId: values.leaderId ? values.leaderId : null,
      };

      if (mode === 'edit' && team) {
        // Omitting `memberIds` leaves existing membership untouched.
        return api.patch<TeamListItem>(`/teams/${team.id}`, shared);
      }

      return api.post<TeamListItem>('/teams', { ...shared, memberIds: values.memberIds });
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.teams.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      toast.success(mode === 'edit' ? `${saved.name} updated` : `${saved.name} created`);
      setOpen(false);
      form.reset(EMPTY);
    },
    onError: (error) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      form.reset(
        mode === 'edit' && team
          ? {
              name: team.name,
              description: team.description ?? '',
              color: team.color ?? '',
              parentId: team.parentId ?? '',
              leaderId: team.leader?.id ?? '',
              memberIds: [],
            }
          : EMPTY,
      );
      save.reset();
    }
  }

  function toggleMember(id: string) {
    const current = form.getValues('memberIds');
    form.setValue(
      'memberIds',
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
      { shouldDirty: true },
    );
  }

  const rootError = form.formState.errors.root?.message;
  const submitting = save.isPending;
  const availableParents = (parents.data ?? []).filter((candidate) => candidate.id !== team?.id);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? `Edit ${team?.name}` : 'New team'}</DialogTitle>
          <DialogDescription>
            Teams group members for reporting and workload distribution, and can nest to mirror your
            org chart.
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          className="space-y-4"
        >
          <fieldset disabled={submitting} className="space-y-4">
            {rootError ? (
              <Alert variant="destructive">
                <AlertDescription>{rootError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="team-name">Team name</Label>
              <Input id="team-name" placeholder="Engineering — West" {...form.register('name')} />
              {form.formState.errors.name ? (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="team-description">Description</Label>
              <Textarea
                id="team-description"
                rows={2}
                placeholder="What this team owns and who it reports to."
                {...form.register('description')}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="team-parent">Parent team</Label>
                <Select
                  value={form.watch('parentId') || NO_SELECTION}
                  onValueChange={(value) =>
                    form.setValue('parentId', value === NO_SELECTION ? '' : value, {
                      shouldDirty: true,
                    })
                  }
                >
                  <SelectTrigger id="team-parent">
                    <SelectValue placeholder="No parent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SELECTION}>No parent</SelectItem>
                    {availableParents.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="team-leader">Team lead</Label>
                <Select
                  value={leaderId || NO_SELECTION}
                  onValueChange={(value) =>
                    form.setValue('leaderId', value === NO_SELECTION ? '' : value, {
                      shouldDirty: true,
                    })
                  }
                >
                  <SelectTrigger id="team-leader">
                    <SelectValue placeholder="No lead" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SELECTION}>No lead</SelectItem>
                    {users.isPending ? (
                      <SelectItem value="__loading" disabled>
                        Loading…
                      </SelectItem>
                    ) : (
                      (users.data?.items ?? []).map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.fullName}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <p className="text-2xs text-muted-foreground">
                  The lead is always added as a member.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label asChild>
                <span>Colour</span>
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => form.setValue('color', '', { shouldDirty: true })}
                  aria-pressed={color === ''}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full border text-2xs text-muted-foreground',
                    color === '' ? 'border-primary ring-2 ring-primary/30' : 'border-border',
                  )}
                >
                  —
                </button>
                {TEAM_COLORS.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => form.setValue('color', swatch, { shouldDirty: true })}
                    aria-label={`Use ${swatch}`}
                    aria-pressed={color === swatch}
                    style={{ backgroundColor: swatch }}
                    className={cn(
                      'size-7 rounded-full border border-black/10 transition-transform',
                      color === swatch ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:scale-105',
                    )}
                  />
                ))}
              </div>
            </div>

            {mode === 'create' ? (
              <div className="space-y-2">
                <Label asChild>
                  <span>Members</span>
                </Label>
                {!canReadUsers ? (
                  <p className="text-xs text-muted-foreground">
                    You cannot view members, so the team starts empty and can be populated later.
                  </p>
                ) : users.isPending ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                    <Spinner /> Loading members…
                  </div>
                ) : (
                  <ScrollArea className="max-h-44 rounded-md border border-border p-3">
                    <div className="space-y-2">
                      {(users.data?.items ?? []).map((member) => (
                        <label
                          key={member.id}
                          className="flex cursor-pointer items-center gap-3 rounded-sm p-1 hover:bg-accent/50"
                        >
                          <Checkbox
                            checked={memberIds.includes(member.id)}
                            onCheckedChange={() => toggleMember(member.id)}
                            aria-label={member.fullName}
                          />
                          <Avatar className="size-6">
                            {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt="" /> : null}
                            <AvatarFallback className="text-2xs">
                              {getInitials(member.fullName)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="min-w-0 flex-1 truncate text-sm">{member.fullName}</span>
                          <span className="truncate text-xs text-muted-foreground">{member.title}</span>
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                Membership is managed from the Users screen, where you can add people to several teams
                at once.
              </p>
            )}
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={name.trim().length < 2}>
              {mode === 'edit' ? 'Save changes' : 'Create team'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
