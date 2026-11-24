'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  inviteUserSchema,
  type Paginated,
  type RoleListItem,
  type TeamListItem,
  type UserDetail,
} from '@talentflow/types';

import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

/**
 * The two optional collections carry Zod defaults, so the form holds them as
 * always-present values while the schema still treats them as optional input.
 */
type InviteUserFormValues = {
  email: string;
  firstName: string;
  lastName: string;
  title: string;
  phone: string;
  roleIds: string[];
  teamIds: string[];
  sendInvite: boolean;
};

const EMPTY_VALUES: InviteUserFormValues = {
  email: '',
  firstName: '',
  lastName: '',
  title: '',
  phone: '',
  roleIds: [],
  teamIds: [],
  sendInvite: true,
};

export function InviteUserDialog({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { has } = useSession();
  const canReadRoles = has('role:read');
  const canReadTeams = has('user:read');

  const form = useForm<InviteUserFormValues>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: EMPTY_VALUES,
  });

  const roles = useQuery({
    queryKey: queryKeys.roles.list({ page: 1, pageSize: 100 }),
    queryFn: () => api.get<Paginated<RoleListItem>>('/roles', { query: { page: 1, pageSize: 100 } }),
    enabled: open && canReadRoles,
    staleTime: 300_000,
  });

  const teams = useQuery({
    queryKey: queryKeys.teams.list,
    queryFn: () => api.get<TeamListItem[]>('/teams'),
    enabled: open && canReadTeams,
    staleTime: 300_000,
  });

  const selectedRoles = form.watch('roleIds');
  const selectedTeams = form.watch('teamIds');
  const sendInvite = form.watch('sendInvite');

  const invite = useMutation({
    mutationFn: (values: InviteUserFormValues) =>
      api.post<UserDetail>('/users/invite', {
        ...values,
        title: values.title || undefined,
        phone: values.phone || undefined,
      }),
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
      toast.success(
        sendInvite
          ? `Invitation sent to ${user.email}`
          : `${user.fullName} was added to the workspace`,
      );
      form.reset(EMPTY_VALUES);
      setOpen(false);
    },
    onError: (error) => {
      const message = applyApiError(error, form.setError);
      form.setError('root', { type: 'server', message });
    },
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      form.reset(EMPTY_VALUES);
      invite.reset();
    }
  }

  function toggle(key: 'roleIds' | 'teamIds', id: string) {
    const current = form.getValues(key);
    form.setValue(
      key,
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
      { shouldDirty: true, shouldValidate: true },
    );
  }

  const rootError = form.formState.errors.root?.message;
  const submitting = invite.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <UserPlus className="size-4" aria-hidden="true" />
            Invite member
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>
            They join this workspace only. Roles decide what they can see and do.
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={form.handleSubmit((values) => invite.mutate(values))}
          className="space-y-4"
        >
          <fieldset disabled={submitting} className="space-y-4">
            {rootError ? (
              <Alert variant="destructive">
                <AlertDescription>{rootError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" htmlFor="invite-firstName" error={form.formState.errors.firstName?.message}>
                <Input id="invite-firstName" autoComplete="given-name" {...form.register('firstName')} />
              </Field>
              <Field label="Last name" htmlFor="invite-lastName" error={form.formState.errors.lastName?.message}>
                <Input id="invite-lastName" autoComplete="family-name" {...form.register('lastName')} />
              </Field>
            </div>

            <Field label="Work email" htmlFor="invite-email" error={form.formState.errors.email?.message}>
              <Input id="invite-email" type="email" autoComplete="email" {...form.register('email')} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Job title" htmlFor="invite-title" optional>
                <Input id="invite-title" placeholder="Senior Recruiter" {...form.register('title')} />
              </Field>
              <Field label="Phone" htmlFor="invite-phone" optional error={form.formState.errors.phone?.message}>
                <Input id="invite-phone" placeholder="+1 415 555 0134" {...form.register('phone')} />
              </Field>
            </div>

            <div className="space-y-2">
              <Label asChild>
                <span>Roles</span>
              </Label>
              {roles.isPending ? (
                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <Spinner /> Loading roles…
                </div>
              ) : !canReadRoles ? (
                <p className="text-xs text-muted-foreground">
                  You do not have permission to view roles, so a workspace administrator must assign
                  them after the invite is accepted.
                </p>
              ) : (
                <ScrollArea className="max-h-44 rounded-md border border-border p-3">
                  <div className="space-y-2">
                    {roles.data?.items.map((role) => (
                      <label
                        key={role.id}
                        className="flex cursor-pointer items-start gap-3 rounded-sm p-1 hover:bg-accent/50"
                      >
                        <Checkbox
                          checked={selectedRoles.includes(role.id)}
                          onCheckedChange={() => toggle('roleIds', role.id)}
                          aria-label={role.name}
                        />
                        <span className="min-w-0 space-y-0.5">
                          <span className="block text-sm font-medium">{role.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {role.permissionCount} permissions
                            {role.isSystem ? ' · built-in' : ' · custom'}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              )}
              {form.formState.errors.roleIds ? (
                <p className="text-xs text-destructive">{form.formState.errors.roleIds.message}</p>
              ) : null}
            </div>

            {canReadTeams && (teams.data?.length ?? 0) > 0 ? (
              <div className="space-y-2">
                <Label asChild>
                  <span>Teams</span>
                </Label>
                <div className="flex flex-wrap gap-2">
                  {teams.data?.map((team) => (
                    <label
                      key={team.id}
                      className="flex cursor-pointer items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm hover:bg-accent/50"
                    >
                      <Checkbox
                        checked={selectedTeams.includes(team.id)}
                        onCheckedChange={() => toggle('teamIds', team.id)}
                        aria-label={team.name}
                      />
                      {team.name}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="invite-send" className="cursor-pointer">
                  Send the invitation email now
                </Label>
                <p className="text-xs text-muted-foreground">
                  Turn this off to create the account silently and share the link yourself.
                </p>
              </div>
              <Switch
                id="invite-send"
                checked={sendInvite}
                onCheckedChange={(checked) =>
                  form.setValue('sendInvite', checked, { shouldDirty: true })
                }
              />
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              {sendInvite ? 'Send invitation' : 'Create member'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
}

function Field({ label, htmlFor, error, optional, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {optional ? <span className="text-2xs text-muted-foreground">Optional</span> : null}
      </div>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
