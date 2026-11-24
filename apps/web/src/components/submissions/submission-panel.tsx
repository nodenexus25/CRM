'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, MessageSquare, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  SUBMISSION_STATUS_LABELS,
  submissionTransitionStatusSchema,
  type SubmissionDetail,
  type SubmissionEventItem,
  type SubmissionStatus,
  type SubmissionTransitionStatus,
} from '@talentflow/types';
import { formatDateTime, formatRelativeTime, getInitials } from '@talentflow/ui';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const STATUS_VARIANT: Record<SubmissionStatus, BadgeProps['variant']> = {
  DRAFT: 'muted',
  SUBMITTED: 'info',
  CLIENT_VIEWED: 'info',
  SHORTLISTED: 'success',
  INTERVIEWING: 'secondary',
  OFFERED: 'success',
  REJECTED: 'destructive',
  WITHDRAWN: 'muted',
};

const EVENT_ICON: Record<SubmissionEventItem['kind'], typeof Send> = {
  SUBMITTED: Send,
  STATUS: Clock,
  FEEDBACK: MessageSquare,
};

interface SubmissionPanelProps {
  /** The application whose submission is shown; `null` closes the panel. */
  applicationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The slide-over that holds everything about one submission: where it stands with
 * the client, who it went to and what they said. Status moves and feedback are
 * recorded in place, so a recruiter never leaves the list to work a submission.
 */
export function SubmissionPanel({ applicationId, open, onOpenChange }: SubmissionPanelProps) {
  const { has, tenant } = useSession();
  const queryClient = useQueryClient();

  const canUpdate = has('application:update');

  const [nextStatus, setNextStatus] = useState<SubmissionTransitionStatus | ''>('');
  const [statusNote, setStatusNote] = useState('');
  const [feedback, setFeedback] = useState('');

  const detail = useQuery({
    queryKey: queryKeys.submissions.detail(applicationId ?? ''),
    queryFn: () => api.get<SubmissionDetail>(`/applications/${applicationId}/submission`),
    enabled: open && applicationId !== null,
  });

  const record = detail.data;

  useEffect(() => {
    if (open) {
      setNextStatus('');
      setStatusNote('');
      setFeedback('');
    }
  }, [open, applicationId]);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.submissions.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
  }

  const changeStatus = useMutation({
    mutationFn: (status: SubmissionTransitionStatus) =>
      api.patch<SubmissionDetail>(`/applications/${applicationId}/submission`, {
        status,
        ...(statusNote.trim() ? { note: statusNote.trim() } : {}),
      }),
    onSuccess: () => {
      invalidate();
      toast.success('Client status updated');
      setNextStatus('');
      setStatusNote('');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not update the client status');
    },
  });

  const saveFeedback = useMutation({
    mutationFn: () =>
      api.post<SubmissionDetail>(`/applications/${applicationId}/submission/feedback`, {
        feedback: feedback.trim(),
      }),
    onSuccess: () => {
      invalidate();
      toast.success('Client feedback recorded');
      setFeedback('');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not record the feedback');
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full max-w-lg flex-col gap-6 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Submission</SheetTitle>
          <SheetDescription>
            {record
              ? `${record.candidate.fullName} · ${record.job.title}`
              : 'Candidate-to-client submission detail.'}
          </SheetDescription>
        </SheetHeader>

        {detail.isPending ? (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : detail.isError || !record ? (
          <EmptyState
            title="Could not load this submission"
            description={detail.error instanceof Error ? detail.error.message : 'Please try again.'}
            action={
              <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>
                Retry
              </Button>
            }
          />
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANT[record.submissionStatus]}>
                {SUBMISSION_STATUS_LABELS[record.submissionStatus]}
              </Badge>
              <Badge variant="muted">
                {record.ageDays === 0 ? 'Sent today' : `${record.ageDays}d with client`}
              </Badge>
              {record.clientFeedback ? <Badge variant="outline">Feedback logged</Badge> : null}
            </div>

            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-0.5">
                <dt className="text-2xs uppercase tracking-wide text-muted-foreground">Client</dt>
                <dd className="text-sm">{record.client?.name ?? 'Not linked to a client'}</dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-2xs uppercase tracking-wide text-muted-foreground">Contact</dt>
                <dd className="text-sm">
                  {record.contact ? (
                    <>
                      {record.contact.fullName}
                      {record.contact.email ? (
                        <span className="block text-xs text-muted-foreground">
                          {record.contact.email}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">No contact recorded</span>
                  )}
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-2xs uppercase tracking-wide text-muted-foreground">Résumé</dt>
                <dd className="truncate text-sm">
                  {record.resume?.fileName ?? (
                    <span className="text-muted-foreground">No résumé attached</span>
                  )}
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-2xs uppercase tracking-wide text-muted-foreground">Sent</dt>
                <dd className="text-sm">
                  {record.submittedAt ? (
                    formatDateTime(record.submittedAt, tenant?.timezone)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                  {record.submittedBy ? (
                    <span className="block text-xs text-muted-foreground">
                      by {record.submittedBy.fullName}
                    </span>
                  ) : null}
                </dd>
              </div>
            </dl>

            <Separator />

            {canUpdate ? (
              <section className="space-y-3">
                <h3 className="text-sm font-medium">Move the client status</h3>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="submission-status">New status</Label>
                    <Select
                      value={nextStatus || undefined}
                      onValueChange={(value) => setNextStatus(value as SubmissionTransitionStatus)}
                    >
                      <SelectTrigger id="submission-status">
                        <SelectValue placeholder="Pick a status" />
                      </SelectTrigger>
                      <SelectContent>
                        {submissionTransitionStatusSchema.options.map((option) => (
                          <SelectItem key={option} value={option}>
                            {SUBMISSION_STATUS_LABELS[option]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    loading={changeStatus.isPending}
                    disabled={!nextStatus}
                    onClick={() => nextStatus && changeStatus.mutate(nextStatus)}
                  >
                    Update
                  </Button>
                </div>
                <Textarea
                  rows={2}
                  value={statusNote}
                  onChange={(event) => setStatusNote(event.target.value)}
                  placeholder="Why the status changed (optional)"
                  maxLength={2000}
                />
              </section>
            ) : null}

            <section className="space-y-3">
              <h3 className="text-sm font-medium">Client feedback</h3>
              {record.clientFeedback ? (
                <div className="rounded-md border border-border bg-muted/40 p-3">
                  <p className="text-sm">{record.clientFeedback}</p>
                  {record.clientFeedbackAt ? (
                    <p className="mt-1 text-2xs text-muted-foreground">
                      {formatRelativeTime(record.clientFeedbackAt)}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Nothing from the client yet.
                </p>
              )}

              {canUpdate ? (
                <div className="space-y-2">
                  <Textarea
                    rows={3}
                    value={feedback}
                    onChange={(event) => setFeedback(event.target.value)}
                    placeholder="What did the client say?"
                    maxLength={4000}
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      loading={saveFeedback.isPending}
                      disabled={feedback.trim().length === 0}
                      onClick={() => saveFeedback.mutate()}
                    >
                      Save feedback
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>

            <Separator />

            <section className="space-y-3">
              <h3 className="text-sm font-medium">Timeline</h3>
              {record.events.length === 0 ? (
                <p className="text-xs text-muted-foreground">No activity recorded yet.</p>
              ) : (
                <ol className="space-y-4">
                  {record.events.map((event) => {
                    const Icon = EVENT_ICON[event.kind];
                    return (
                      <li key={event.id} className="flex gap-3">
                        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-card">
                          <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="text-sm font-medium">{event.subject}</p>
                          {event.body ? (
                            <p className="whitespace-pre-line text-xs text-muted-foreground">
                              {event.body}
                            </p>
                          ) : null}
                          <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                            {event.author ? (
                              <>
                                <Avatar className="size-4">
                                  {event.author.avatarUrl ? (
                                    <AvatarImage src={event.author.avatarUrl} alt="" />
                                  ) : null}
                                  <AvatarFallback className="text-[8px]">
                                    {getInitials(event.author.fullName)}
                                  </AvatarFallback>
                                </Avatar>
                                {event.author.fullName}
                                <span aria-hidden="true">·</span>
                              </>
                            ) : null}
                            {formatDateTime(event.createdAt, tenant?.timezone)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
