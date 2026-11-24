'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  createRejectionReasonSchema,
  type RejectionReasonItem,
} from '@talentflow/types';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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

import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';

const reasonFormSchema = z.object({
  key: createRejectionReasonSchema.shape.key,
  label: createRejectionReasonSchema.shape.label,
});

type ReasonFormValues = z.infer<typeof reasonFormSchema>;

const EMPTY: ReasonFormValues = { key: '', label: '' };

interface RejectionReasonDialogProps {
  mode?: 'create' | 'edit';
  reason?: RejectionReasonItem;
  trigger: ReactNode;
}

/** Adds a rejection reason, or renames an existing one (the key never changes). */
export function RejectionReasonDialog({ mode = 'create', reason, trigger }: RejectionReasonDialogProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const form = useForm<ReasonFormValues>({
    resolver: zodResolver(reasonFormSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(mode === 'edit' && reason ? { key: reason.key, label: reason.label } : EMPTY);
  }, [form, mode, open, reason]);

  const save = useMutation({
    mutationFn: (values: ReasonFormValues) =>
      mode === 'edit' && reason
        ? api.patch<RejectionReasonItem>(`/pipeline/rejection-reasons/${reason.id}`, {
            label: values.label,
          })
        : api.post<RejectionReasonItem>('/pipeline/rejection-reasons', {
            key: values.key,
            label: values.label,
          }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pipeline.all });
      toast.success(mode === 'edit' ? `${saved.label} updated` : `${saved.label} added`);
      setOpen(false);
    },
    onError: (error) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  const rootError = form.formState.errors.root?.message;
  const submitting = save.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? `Rename ${reason?.label}` : 'New rejection reason'}</DialogTitle>
          <DialogDescription>
            Recruiters pick from this list when they reject a candidate, which keeps rejection
            reporting consistent across the workspace.
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
              <Label htmlFor="reason-label">Label</Label>
              <Input
                id="reason-label"
                placeholder="Lacks required experience"
                {...form.register('label')}
              />
              {form.formState.errors.label ? (
                <p className="text-xs text-destructive">{form.formState.errors.label.message}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="reason-key">Key</Label>
                <span className="text-2xs text-muted-foreground">
                  {mode === 'edit' ? 'Fixed' : 'Stable identifier'}
                </span>
              </div>
              <Input
                id="reason-key"
                className="font-mono"
                placeholder="lacks-experience"
                disabled={mode === 'edit'}
                {...form.register('key')}
              />
              {form.formState.errors.key ? (
                <p className="text-xs text-destructive">{form.formState.errors.key.message}</p>
              ) : (
                <p className="text-2xs text-muted-foreground">
                  Used by imports and reporting. It cannot be changed later.
                </p>
              )}
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={form.watch('label').trim().length === 0}>
              {mode === 'edit' ? 'Save changes' : 'Add reason'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
