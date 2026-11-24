'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  ACTIVITY_TYPE_LABELS,
  createActivitySchema,
  type ActivityItem,
  type ActivityType,
  type EntityType,
} from '@talentflow/types';

import { Badge } from '@/components/ui/badge';
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

/** Only these may be logged by hand; the rest are written by the ATS itself. */
const LOGGABLE_TYPES = ['CALL', 'EMAIL', 'MEETING', 'NOTE', 'SMS', 'LINKEDIN'] as const;

/**
 * The form reuses the API schema's field constraints; `occurredAt` is a
 * `datetime-local` string here and omitted from the payload when blank because
 * the API field is `z.coerce.date().optional()` and would reject an empty
 * string.
 */
const logActivityFormSchema = z.object({
  type: createActivitySchema.shape.type,
  subject: createActivitySchema.shape.subject,
  body: z.string().trim().max(20000).optional(),
  occurredAt: z.string().trim().optional(),
  durationMinutes: z.string().trim().optional(),
  outcome: z.string().trim().max(500).optional(),
});

type LogActivityFormValues = z.infer<typeof logActivityFormSchema>;

interface LogActivityDialogProps {
  entityType: EntityType;
  entityId: string;
  candidateId?: string;
  jobId?: string;
  clientId?: string;
  applicationId?: string;
  contactId?: string;
  /** Renders the dialog open/close trigger (usually a `<Button>`). */
  trigger: ReactNode;
  /** When present the dialog corrects an existing activity instead of logging one. */
  activity?: ActivityItem;
}

function toDuration(value: string | undefined): number | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/** ISO timestamp → the `yyyy-mm-ddThh:mm` a `datetime-local` input expects. */
function toDateTimeInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * Logs a call, email, meeting, note, SMS or LinkedIn touch against any record —
 * or, handed an `activity`, corrects the content of one already logged. The
 * polymorphic link is immutable, so editing never moves a row between records.
 */
export function LogActivityDialog({
  entityType,
  entityId,
  candidateId,
  jobId,
  clientId,
  applicationId,
  contactId,
  trigger,
  activity,
}: LogActivityDialogProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const isEdit = Boolean(activity);

  const form = useForm<LogActivityFormValues>({
    resolver: zodResolver(logActivityFormSchema),
    defaultValues: {
      type: 'CALL',
      subject: '',
      body: '',
      occurredAt: '',
      durationMinutes: '',
      outcome: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    if (activity) {
      form.reset({
        type: activity.type,
        subject: activity.subject,
        body: activity.body ?? '',
        occurredAt: toDateTimeInput(activity.occurredAt),
        durationMinutes: activity.durationMinutes === null ? '' : String(activity.durationMinutes),
        outcome: activity.outcome ?? '',
      });
    } else {
      form.reset({
        type: 'CALL',
        subject: '',
        body: '',
        occurredAt: '',
        durationMinutes: '',
        outcome: '',
      });
    }
  }, [activity, form, open]);

  const save = useMutation({
    mutationFn: (values: LogActivityFormValues) => {
      const body = (values.body ?? '').trim();
      const duration = toDuration(values.durationMinutes);
      const occurredAt = values.occurredAt ? new Date(values.occurredAt).toISOString() : null;

      if (activity) {
        return api.patch<ActivityItem>(`/activities/${activity.id}`, {
          subject: values.subject,
          body: body.length > 0 ? body : null,
          ...(occurredAt ? { occurredAt } : {}),
          durationMinutes: duration,
          outcome: (values.outcome ?? '').trim().length > 0 ? (values.outcome ?? '').trim() : null,
        });
      }

      return api.post<ActivityItem>('/activities', {
        type: values.type,
        subject: values.subject,
        entityType,
        entityId,
        ...(body.length > 0 ? { body } : {}),
        ...(occurredAt ? { occurredAt } : {}),
        ...(duration !== null ? { durationMinutes: duration } : {}),
        ...(candidateId ? { candidateId } : {}),
        ...(clientId ? { clientId } : {}),
        ...(jobId ? { jobId } : {}),
        ...(applicationId ? { applicationId } : {}),
        ...(contactId ? { contactId } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
      toast.success(activity ? 'Activity updated' : 'Activity logged');
      setOpen(false);
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  const rootError = form.formState.errors.root?.message;
  const submitting = save.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit activity' : 'Log activity'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Correcting an entry keeps it on the same record.'
              : 'Record a call, email, meeting, note, SMS or LinkedIn touch on this record.'}
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          className="space-y-4"
        >
          <fieldset disabled={submitting} className="space-y-4">
            {rootError ? <p className="text-xs text-destructive">{rootError}</p> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="log-activity-type">Type</Label>
                {isEdit ? (
                  <div className="flex h-9 items-center">
                    <Badge variant="secondary">
                      {ACTIVITY_TYPE_LABELS[form.watch('type') as ActivityType]}
                    </Badge>
                  </div>
                ) : (
                  <Select
                    value={form.watch('type')}
                    onValueChange={(value) =>
                      form.setValue('type', value as LogActivityFormValues['type'], {
                        shouldDirty: true,
                      })
                    }
                  >
                    <SelectTrigger id="log-activity-type" aria-label="Activity type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LOGGABLE_TYPES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {ACTIVITY_TYPE_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="log-activity-occurred">When (optional)</Label>
                <Input
                  id="log-activity-occurred"
                  type="datetime-local"
                  {...form.register('occurredAt')}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="log-activity-subject">Subject</Label>
              <Input
                id="log-activity-subject"
                placeholder="What happened?"
                {...form.register('subject')}
              />
              {form.formState.errors.subject ? (
                <p className="text-xs text-destructive">{form.formState.errors.subject.message}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="log-activity-body">Details (optional)</Label>
              <Textarea id="log-activity-body" rows={3} {...form.register('body')} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="log-activity-duration">Duration (minutes, optional)</Label>
                <Input
                  id="log-activity-duration"
                  type="number"
                  min={0}
                  max={1440}
                  inputMode="numeric"
                  {...form.register('durationMinutes')}
                />
              </div>

              {isEdit ? (
                <div className="space-y-1.5">
                  <Label htmlFor="log-activity-outcome">Outcome (optional)</Label>
                  <Input id="log-activity-outcome" {...form.register('outcome')} />
                </div>
              ) : null}
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={submitting}
              disabled={form.watch('subject').trim().length === 0}
            >
              {isEdit ? 'Save changes' : 'Log activity'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
