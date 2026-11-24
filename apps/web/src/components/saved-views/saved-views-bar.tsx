'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Star, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  createSavedViewSchema,
  visibilitySchema,
  type SavedViewEntity,
  type SavedViewItem,
  type Visibility,
} from '@talentflow/types';
import { cn } from '@talentflow/ui';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const VISIBILITY_LABELS: Record<Visibility, string> = {
  PRIVATE: 'Private',
  TEAM: 'Team',
  TENANT: 'Workspace',
};

const saveViewFormSchema = z.object({
  name: createSavedViewSchema.shape.name,
  visibility: visibilitySchema,
  isDefault: z.boolean(),
});

type SaveViewFormValues = z.infer<typeof saveViewFormSchema>;

interface SavedViewsBarProps {
  entity: SavedViewEntity;
  /** Current list query state to persist with "Save current view". */
  filters: Record<string, unknown>;
  sortBy?: string | null;
  sortDir?: 'asc' | 'desc' | null;
  activeViewId?: string | null;
  /** Apply a stored view; the parent replays its filters/sort. */
  onApply: (view: SavedViewItem) => void;
  onClear: () => void;
  className?: string;
}

/** Reusable selectable list configurations: "My hot jobs", "Stale submissions". */
export function SavedViewsBar({
  entity,
  filters,
  sortBy,
  sortDir,
  activeViewId,
  onApply,
  onClear,
  className,
}: SavedViewsBarProps) {
  const queryClient = useQueryClient();
  const { has } = useSession();
  const canManage = has('saved_search:manage');

  const [saveOpen, setSaveOpen] = useState(false);

  const views = useQuery({
    queryKey: queryKeys.savedViews.list({ entity }),
    queryFn: () => api.get<SavedViewItem[]>('/saved-views', { query: { entity } }),
    staleTime: 60_000,
  });

  const form = useForm<SaveViewFormValues>({
    resolver: zodResolver(saveViewFormSchema),
    defaultValues: { name: '', visibility: 'PRIVATE', isDefault: false },
  });

  const create = useMutation({
    mutationFn: (values: SaveViewFormValues) =>
      api.post<SavedViewItem>('/saved-views', {
        entity,
        name: values.name,
        filters,
        sortBy: sortBy ?? null,
        sortDir: sortDir ?? null,
        visibility: values.visibility,
        isDefault: values.isDefault,
      }),
    onSuccess: (view) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.savedViews.all });
      toast.success(`${view.name} saved`);
      form.reset({ name: '', visibility: 'PRIVATE', isDefault: false });
      setSaveOpen(false);
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: true }>(`/saved-views/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.savedViews.all });
      toast.success('View deleted');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not delete this view');
    },
  });

  const rootError = form.formState.errors.root?.message;
  const items = views.data ?? [];

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <button
        type="button"
        onClick={onClear}
        aria-pressed={activeViewId == null}
        className={cn(
          'inline-flex h-7 items-center rounded-full border px-3 text-2xs font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          activeViewId == null
            ? 'border-primary/40 bg-secondary text-secondary-foreground ring-1 ring-primary/30'
            : 'border-border bg-card text-muted-foreground hover:text-foreground',
        )}
      >
        All
      </button>

      {views.isPending ? (
        <>
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="h-7 w-20 rounded-full" />
        </>
      ) : (
        items.map((view) => {
          const active = view.id === activeViewId;
          return (
            <div
              key={view.id}
              className={cn(
                'inline-flex h-7 items-center overflow-hidden rounded-full border',
                active
                  ? 'border-primary/40 bg-secondary text-secondary-foreground ring-1 ring-primary/30'
                  : 'border-border bg-card text-muted-foreground',
              )}
            >
              <button
                type="button"
                aria-pressed={active}
                onClick={() => (active ? onClear() : onApply(view))}
                className={cn(
                  'inline-flex h-full items-center gap-1.5 px-3 text-2xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  active ? 'text-secondary-foreground' : 'hover:text-foreground',
                )}
              >
                {view.isDefault ? (
                  <Star className="size-3 fill-current text-warning" aria-hidden="true" />
                ) : null}
                {view.name}
                {!view.isOwn ? (
                  <Badge variant="muted">{VISIBILITY_LABELS[view.visibility]}</Badge>
                ) : null}
              </button>

              {view.isOwn && canManage ? (
                <ConfirmDialog
                  destructive
                  title={`Delete “${view.name}”?`}
                  description="The saved filters are removed for you. This cannot be undone."
                  confirmLabel="Delete view"
                  trigger={
                    <DialogTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Delete view ${view.name}`}
                        className={cn(
                          'inline-flex h-full items-center pr-2 pl-1 text-muted-foreground transition-colors hover:text-destructive',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                        )}
                      >
                        <X className="size-3" aria-hidden="true" />
                      </button>
                    </DialogTrigger>
                  }
                  onConfirm={() => remove.mutateAsync(view.id).then(() => undefined)}
                />
              ) : null}
            </div>
          );
        })
      )}

      {canManage ? (
        <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1 px-2.5 text-2xs">
              <Plus className="size-3" aria-hidden="true" />
              Save view
            </Button>
          </DialogTrigger>

          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Save this view</DialogTitle>
              <DialogDescription>
                The current filters and sort order are stored so you can return to them in one click.
              </DialogDescription>
            </DialogHeader>

            <form
              noValidate
              onSubmit={form.handleSubmit((values) => create.mutate(values))}
              className="space-y-4"
            >
              <fieldset disabled={create.isPending} className="space-y-4">
                {rootError ? <p className="text-xs text-destructive">{rootError}</p> : null}

                <div className="space-y-1.5">
                  <Label htmlFor="saved-view-name">Name</Label>
                  <Input id="saved-view-name" placeholder="My hot jobs" {...form.register('name')} />
                  {form.formState.errors.name ? (
                    <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="saved-view-visibility">Visibility</Label>
                  <Select
                    value={form.watch('visibility')}
                    onValueChange={(value) =>
                      form.setValue('visibility', value as Visibility, { shouldDirty: true })
                    }
                  >
                    <SelectTrigger id="saved-view-visibility">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {visibilitySchema.options.map((option) => (
                        <SelectItem key={option} value={option}>
                          {VISIBILITY_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3">
                  <Checkbox
                    checked={form.watch('isDefault')}
                    onCheckedChange={(checked) =>
                      form.setValue('isDefault', checked === true, { shouldDirty: true })
                    }
                    aria-label="Set as default"
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">Set as default</span>
                    <span className="block text-xs text-muted-foreground">
                      Applies automatically when you open this list.
                    </span>
                  </span>
                </label>
              </fieldset>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSaveOpen(false)}
                  disabled={create.isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={create.isPending} disabled={form.watch('name').trim().length === 0}>
                  Save view
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
