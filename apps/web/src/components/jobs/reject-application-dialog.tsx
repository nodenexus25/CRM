'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  rejectApplicationSchema,
  withdrawApplicationSchema,
  type ApplicationDetail,
  type RejectionReasonItem,
} from '@talentflow/types';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';

const rejectFormSchema = z.object({
  rejectionReasonId: rejectApplicationSchema.shape.rejectionReasonId,
  note: z.string().trim().max(1000).optional(),
});
type RejectFormValues = z.infer<typeof rejectFormSchema>;

interface ControlledDialogProps {
  applicationId: string;
  /** Controlled open state; omit to use the internal state driven by `trigger`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  onSubmitted?: () => void;
}

/**
 * Reject a candidate. The API records the reason and moves the application to
 * the workspace's rejected stage, so the board never shows a rejection without
 * a justification.
 */
export function RejectApplicationDialog({
  applicationId,
  open,
  onOpenChange,
  trigger,
  onSubmitted,
}: ControlledDialogProps) {
  const queryClient = useQueryClient();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const actualOpen = isControlled ? open : internalOpen;

  const form = useForm<RejectFormValues>({
    resolver: zodResolver(rejectFormSchema),
    defaultValues: { rejectionReasonId: '', note: '' },
  });

  const reasons = useQuery({
    queryKey: queryKeys.pipeline.rejectionReasons({}),
    queryFn: () => api.get<RejectionReasonItem[]>('/pipeline/rejection-reasons'),
    enabled: actualOpen,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!actualOpen) form.reset({ rejectionReasonId: '', note: '' });
  }, [actualOpen, form]);

  function handleOpenChange(next: boolean) {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  const reject = useMutation({
    mutationFn: (values: RejectFormValues) =>
      api.post<ApplicationDetail>(`/applications/${applicationId}/reject`, {
        rejectionReasonId: values.rejectionReasonId,
        ...(values.note ? { note: values.note } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      toast.success('Candidate rejected');
      handleOpenChange(false);
      onSubmitted?.();
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  const rootError = form.formState.errors.root?.message;
  const activeReasons = (reasons.data ?? []).filter((reason) => reason.isActive);
  const selectedReason = form.watch('rejectionReasonId');

  return (
    <Dialog open={actualOpen} onOpenChange={handleOpenChange}>
      {trigger}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reject this candidate</DialogTitle>
          <DialogDescription>
            The candidate is moved to the rejected stage and the reason is recorded on their history.
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={form.handleSubmit((values) => reject.mutate(values))}
          className="space-y-4"
        >
          <fieldset disabled={reject.isPending} className="space-y-4">
            {rootError ? <p className="text-xs text-destructive">{rootError}</p> : null}

            <div className="space-y-1.5">
              <Label htmlFor="reject-reason">Reason</Label>
              <Select
                value={selectedReason || undefined}
                onValueChange={(value) =>
                  form.setValue('rejectionReasonId', value, { shouldDirty: true })
                }
              >
                <SelectTrigger id="reject-reason" aria-label="Rejection reason">
                  <SelectValue placeholder="Pick a reason" />
                </SelectTrigger>
                <SelectContent>
                  {activeReasons.map((reason) => (
                    <SelectItem key={reason.id} value={reason.id}>
                      {reason.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.rejectionReasonId ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.rejectionReasonId.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reject-note">Note (optional)</Label>
              <Textarea id="reject-note" rows={3} {...form.register('note')} />
            </div>
          </fieldset>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={reject.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" loading={reject.isPending} disabled={!selectedReason}>
              Reject candidate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const withdrawFormSchema = z.object({
  note: withdrawApplicationSchema.shape.note,
});
type WithdrawFormValues = z.infer<typeof withdrawFormSchema>;

/** Withdraw a candidate who has removed themselves from consideration. */
export function WithdrawApplicationDialog({
  applicationId,
  open,
  onOpenChange,
  trigger,
  onSubmitted,
}: ControlledDialogProps) {
  const queryClient = useQueryClient();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const actualOpen = isControlled ? open : internalOpen;

  const form = useForm<WithdrawFormValues>({
    resolver: zodResolver(withdrawFormSchema),
    defaultValues: { note: '' },
  });

  useEffect(() => {
    if (!actualOpen) form.reset({ note: '' });
  }, [actualOpen, form]);

  function handleOpenChange(next: boolean) {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  const withdraw = useMutation({
    mutationFn: (values: WithdrawFormValues) =>
      api.post<ApplicationDetail>(`/applications/${applicationId}/withdraw`, {
        ...(values.note ? { note: values.note } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      toast.success('Application withdrawn');
      handleOpenChange(false);
      onSubmitted?.();
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  const rootError = form.formState.errors.root?.message;

  return (
    <Dialog open={actualOpen} onOpenChange={handleOpenChange}>
      {trigger}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Withdraw this application</DialogTitle>
          <DialogDescription>
            The candidate is moved to the withdrawn stage. Their record is retained for reporting.
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={form.handleSubmit((values) => withdraw.mutate(values))}
          className="space-y-4"
        >
          <fieldset disabled={withdraw.isPending} className="space-y-4">
            {rootError ? <p className="text-xs text-destructive">{rootError}</p> : null}

            <div className="space-y-1.5">
              <Label htmlFor="withdraw-note">Note (optional)</Label>
              <Textarea id="withdraw-note" rows={3} {...form.register('note')} />
            </div>
          </fieldset>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={withdraw.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" loading={withdraw.isPending}>
              Withdraw application
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
