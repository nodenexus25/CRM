'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { type InterviewDetail } from '@talentflow/types';
import { cn } from '@talentflow/ui';

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
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';

const feedbackFormSchema = z.object({
  rating: z.coerce.number().int().min(1, 'Rate the interview from 1 to 5').max(5),
  feedback: z.string().trim().min(1, 'Add the interviewer’s feedback').max(4000),
  strengths: z.string().trim().max(2000),
  concerns: z.string().trim().max(2000),
});
type FeedbackFormValues = z.infer<typeof feedbackFormSchema>;

const EMPTY_VALUES: FeedbackFormValues = { rating: 0, feedback: '', strengths: '', concerns: '' };

interface InterviewFeedbackDialogProps {
  /** The interview being scored; `null` closes the dialog. */
  interviewId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown in the description so the recruiter knows whose scorecard this is. */
  candidateName?: string | null;
}

const RATINGS = [1, 2, 3, 4, 5] as const;

/**
 * An interviewer's scorecard: an overall rating plus what went well and what did
 * not. Recording one closes the interview server-side, so the list status stays
 * truthful without a second action.
 */
export function InterviewFeedbackDialog({
  interviewId,
  open,
  onOpenChange,
  candidateName,
}: InterviewFeedbackDialogProps) {
  const queryClient = useQueryClient();

  const form = useForm<FeedbackFormValues>({
    resolver: zodResolver(feedbackFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (!open) form.reset(EMPTY_VALUES);
  }, [open, interviewId, form]);

  const save = useMutation({
    mutationFn: (values: FeedbackFormValues) =>
      api.post<InterviewDetail>(`/interviews/${interviewId}/feedback`, {
        rating: values.rating,
        feedback: values.feedback,
        strengths: values.strengths || null,
        concerns: values.concerns || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.interviews.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all });
      toast.success('Interview feedback recorded');
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  const rating = form.watch('rating');
  const rootError = form.formState.errors.root?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record interview feedback</DialogTitle>
          <DialogDescription>
            {candidateName
              ? `The scorecard for ${candidateName}. Saving it marks the interview completed.`
              : 'The scorecard for this interview. Saving it marks the interview completed.'}
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          className="space-y-4"
        >
          <fieldset disabled={save.isPending} className="space-y-4">
            {rootError ? <p className="text-xs text-destructive">{rootError}</p> : null}

            <div className="space-y-1.5">
              <Label id="feedback-rating-label">Overall rating</Label>
              <div
                role="radiogroup"
                aria-labelledby="feedback-rating-label"
                className="flex items-center gap-1"
              >
                {RATINGS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={rating === value}
                    aria-label={`${value} out of 5`}
                    onClick={() => form.setValue('rating', value, { shouldValidate: true, shouldDirty: true })}
                    className="rounded-sm p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <Star
                      className={cn(
                        'size-6 transition-colors',
                        value <= rating ? 'fill-warning text-warning' : 'text-muted-foreground',
                      )}
                      aria-hidden="true"
                    />
                  </button>
                ))}
                {rating > 0 ? (
                  <span className="ml-2 text-xs text-muted-foreground">{rating} / 5</span>
                ) : null}
              </div>
              {form.formState.errors.rating ? (
                <p className="text-xs text-destructive">{form.formState.errors.rating.message}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="feedback-body">Feedback</Label>
              <Textarea
                id="feedback-body"
                rows={4}
                placeholder="How did the conversation go?"
                {...form.register('feedback')}
              />
              {form.formState.errors.feedback ? (
                <p className="text-xs text-destructive">{form.formState.errors.feedback.message}</p>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="feedback-strengths">Strengths (optional)</Label>
                <Textarea id="feedback-strengths" rows={3} {...form.register('strengths')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="feedback-concerns">Concerns (optional)</Label>
                <Textarea id="feedback-concerns" rows={3} {...form.register('concerns')} />
              </div>
            </div>
          </fieldset>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending} disabled={rating < 1}>
              Save scorecard
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
