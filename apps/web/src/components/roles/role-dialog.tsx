'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  createRoleSchema,
  ROLE_KEY_LABELS,
  ROLE_PERMISSION_TEMPLATES,
  TENANT_ROLE_KEYS,
  type PermissionGroup,
  type PermissionKey,
  type RoleDetail,
  type RoleListItem,
} from '@talentflow/types';
import { cn } from '@talentflow/ui';

import { Alert, AlertDescription } from '@/components/ui/alert';
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

const TEMPLATE_NONE = '__none__';

const roleFormSchema = z.object({
  name: createRoleSchema.shape.name,
  description: z.string().trim().max(400),
  /**
   * Held as plain strings because the checkbox list is rendered from the live
   * catalogue; the API re-validates every key against `PERMISSIONS`.
   */
  permissions: z.array(z.string().trim().min(1).max(64)).max(200),
});

type RoleFormValues = z.infer<typeof roleFormSchema>;

const EMPTY: RoleFormValues = { name: '', description: '', permissions: [] };

interface RoleDialogProps {
  mode?: 'create' | 'edit';
  role?: RoleListItem;
  trigger: React.ReactNode;
}

/**
 * Creates and edits a role against the live permission catalogue.
 *
 * In edit mode every change is a full replacement of the permission set, which
 * is what `PATCH /roles/:id` expects — the dialog is the only place that
 * difference is visible.
 */
export function RoleDialog({ mode = 'create', role, trigger }: RoleDialogProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { has } = useSession();
  const canManage = has('role:manage');

  const form = useForm<RoleFormValues>({
    resolver: zodResolver(roleFormSchema),
    defaultValues: EMPTY,
  });

  const catalogue = useQuery({
    queryKey: queryKeys.roles.catalogue,
    queryFn: () => api.get<PermissionGroup[]>('/roles/catalogue'),
    enabled: open,
    staleTime: 600_000,
  });

  const selected = form.watch('permissions');
  const selectedSet = new Set(selected);

  const save = useMutation({
    mutationFn: (values: RoleFormValues) => {
      const body = {
        name: values.name,
        description: values.description || undefined,
        permissions: values.permissions,
      };
      if (mode === 'edit' && role) return api.patch<RoleDetail>(`/roles/${role.id}`, body);
      return api.post<RoleDetail>('/roles', body);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all });
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
        mode === 'edit' && role
          ? {
              name: role.name,
              description: role.description ?? '',
              permissions: [...role.permissions],
            }
          : EMPTY,
      );
      save.reset();
    }
  }

  function setPermissions(next: string[]) {
    form.setValue('permissions', next, { shouldDirty: true, shouldValidate: true });
  }

  function togglePermission(key: string) {
    setPermissions(
      selectedSet.has(key) ? selected.filter((value) => value !== key) : [...selected, key],
    );
  }

  function toggleGroup(group: PermissionGroup) {
    const keys = group.permissions.map((permission) => permission.key);
    const allSelected = keys.every((key) => selectedSet.has(key));
    setPermissions(
      allSelected
        ? selected.filter((value) => !keys.includes(value as PermissionKey))
        : [...new Set([...selected, ...keys])],
    );
  }

  function applyTemplate(key: string) {
    if (key === TEMPLATE_NONE) return;
    const template = ROLE_PERMISSION_TEMPLATES[key as keyof typeof ROLE_PERMISSION_TEMPLATES];
    setPermissions(template.filter((permission) => !permission.startsWith('platform:')));
  }

  const rootError = form.formState.errors.root?.message;
  const submitting = save.isPending;
  const groups = catalogue.data ?? [];
  const catalogueSize = groups.reduce((total, group) => total + group.permissions.length, 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? `Edit ${role?.name}` : 'New role'}</DialogTitle>
          <DialogDescription>
            {mode === 'edit' && role?.isSystem
              ? 'This is a built-in role. Changes apply to every member who holds it.'
              : 'Permissions are additive — a member keeps everything their other roles grant.'}
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

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="role-name">Role name</Label>
                <Input id="role-name" placeholder="Senior Recruiter" {...form.register('name')} />
                {form.formState.errors.name ? (
                  <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                ) : null}
              </div>

              {mode === 'create' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="role-template">Start from</Label>
                  <Select defaultValue={TEMPLATE_NONE} onValueChange={applyTemplate}>
                    <SelectTrigger id="role-template">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TEMPLATE_NONE}>Empty role</SelectItem>
                      {TENANT_ROLE_KEYS.map((key) => (
                        <SelectItem key={key} value={key}>
                          Copy {ROLE_KEY_LABELS[key]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-2xs text-muted-foreground">
                    Copies the built-in permission set once — later edits here are independent.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="role-description" className="flex items-center justify-between">
                <span>Description</span>
                <span className="text-2xs font-normal text-muted-foreground">Optional</span>
              </Label>
              <Textarea
                id="role-description"
                rows={2}
                placeholder="What this role is for and who should hold it."
                {...form.register('description')}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label asChild>
                  <span>Permissions</span>
                </Label>
                <Badge variant="muted">
                  {selected.length}
                  {catalogueSize > 0 ? ` of ${catalogueSize}` : ''} selected
                </Badge>
              </div>

              {catalogue.isPending ? (
                <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                  <Spinner /> Loading the permission catalogue…
                </div>
              ) : (
                <ScrollArea className="h-72 rounded-md border border-border">
                  <div className="divide-y divide-border">
                    {groups.map((group) => {
                      const keys = group.permissions.map((permission) => permission.key);
                      const count = keys.filter((key) => selectedSet.has(key)).length;
                      const allSelected = count === keys.length;

                      return (
                        <div key={group.group} className="p-3">
                          <label className="flex cursor-pointer items-center gap-3">
                            <Checkbox
                              checked={count === 0 ? false : allSelected ? true : 'indeterminate'}
                              onCheckedChange={() => toggleGroup(group)}
                              aria-label={`Toggle all ${group.group} permissions`}
                            />
                            <span className="text-sm font-medium">{group.group}</span>
                            <span className="ml-auto text-2xs text-muted-foreground">
                              {count}/{keys.length}
                            </span>
                          </label>

                          <div className="mt-2 grid gap-2 pl-7 sm:grid-cols-2">
                            {group.permissions.map((permission) => (
                              <label
                                key={permission.key}
                                className={cn(
                                  'flex cursor-pointer items-start gap-2 rounded-sm p-1 hover:bg-accent/50',
                                  !canManage && 'cursor-not-allowed opacity-70',
                                )}
                              >
                                <Checkbox
                                  className="mt-0.5"
                                  checked={selectedSet.has(permission.key)}
                                  disabled={!canManage}
                                  onCheckedChange={() => togglePermission(permission.key)}
                                  aria-label={permission.label}
                                />
                                <span className="min-w-0 space-y-0.5">
                                  <span className="block text-xs font-medium">{permission.label}</span>
                                  <span className="block text-2xs text-muted-foreground">
                                    {permission.description}
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}

              <p className="text-2xs text-muted-foreground">
                Keys use a <code className="font-mono">resource:action</code> shape; <code className="font-mono">_all</code>{' '}
                and <code className="font-mono">_own</code> scope a read to the whole workspace or just the
                records the member owns.
              </p>
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={submitting}
              disabled={!canManage || form.watch('name').trim().length < 2}
            >
              {mode === 'edit' ? 'Save changes' : 'Create role'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
