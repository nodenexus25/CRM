'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ExternalLink, MapPin, Star, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  INTERVIEW_STATUS_LABELS,
  INTERVIEW_TYPE_LABELS,
  type InterviewDetail,
  type InterviewStatus,
} from '@talentflow/types';
import { cn, formatDateTime, formatRelativeTime, getInitials } from '@talentflow/ui';

import { InterviewFeedbackDialog } from '@/components/interviews/interview-feedback-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const STATUS_VARIANT: Record<InterviewStatus, BadgeProps['variant']> = {
  SCHEDULED: 'info',
  CONFIRMED: 'secondary',
  COMPLETED: 'success',
  CANCELLED: 'muted',
  NO_SHOW: 'destructive',
  RESCHEDULED: 'warning',
};

/** Statuses a person moves an interview to by hand; the other two are system-set. */
const MANUAL_STATUSES: InterviewStatus[] = ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'];

interface InterviewPanelProps {
  /** The interview shown; `null` closes the panel. */
  interviewId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Everything about one interview: when it is, who is on the panel, and what the
 * interviewer said. Status moves and cancellations happen in place so a
 * recruiter never leaves the agenda to work an interview.
 */
export function InterviewPanel({ interviewId, open, onOpenChange }: InterviewPanelProps) {
  const { has, tenant } = useSession();
  const queryClient = useQueryClient();

  const canUpdate = has('interview:update');
  const canDelete = has('interview:delete');
  const canScore = has('interview:feedback');

  const [nextStatus, setNextStatus] = useState<InterviewStatus | ''>('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const detail = useQuery({
    queryKey: queryKeys.interviews.detail(interviewId ?? ''),
    queryFn: () => api.get<InterviewDetail>(`/interviews/${interviewId}`),
    enabled: open && interviewId !== null,
  });

  const record = detail.data;

  useEffect(() => {
    if (open) setNextStatus('');
  }, [open, interviewId]);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.interviews.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all });
  }

  const changeStatus = useMutation({
    mutationFn: (status: InterviewStatus) =>
      api.patch<InterviewDetail>(`/interviews/${interviewId}`, { status }),
    onSuccess: () => {
      invalidate();
      toast.success('Interview updated');
      setNextStatus('');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not update the interview');
    },
  });

  const cancelInterview = useMutation({
    mutationFn: () => api.delete<{ deleted: true }>(`/interviews/${interviewId}`),
    onSuccess: () => {
      invalidate();
      toast.success('Interview cancelled');
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not cancel the interview');
    },
  });

  const timezone = record?.timezone ?? tenant?.timezone;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex w-full max-w-lg flex-col gap-6 overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Interview</SheetTitle>
            <SheetDescription>
              {record
                ? `${record.application.candidate.fullName} · ${record.application.job.title}`
                : 'Interview detail.'}
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
              title="Could not load this interview"
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
                <Badge variant={STATUS_VARIANT[record.status]}>
                  {INTERVIEW_STATUS_LABELS[record.status]}
                </Badge>
                <Badge variant="outline">
                  {INTERVIEW_TYPE_LABELS[record.type]} · round {record.round}
                </Badge>
                <Badge variant="muted">
                  {record.ageDays === 0 ? 'Scheduled today' : `Scheduled ${record.ageDays}d ago`}
                </Badge>
              </div>

              {record.title ? <p className="text-sm font-medium">{record.title}</p> : null}

              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-0.5">
                  <dt className="text-2xs uppercase tracking-wide text-muted-foreground">Starts</dt>
                  <dd className="text-sm">{formatDateTime(record.scheduledStart, timezone)}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-2xs uppercase tracking-wide text-muted-foreground">Duration</dt>
                  <dd className="text-sm">
                    {record.durationMinutes} minutes
                    <span className="block text-xs text-muted-foreground">{record.timezone}</span>
                  </dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-2xs uppercase tracking-wide text-muted-foreground">Candidate</dt>
                  <dd className="text-sm">
                    <Link
                      href={`/candidates/${record.application.candidate.id}`}
                      className="transition-colors hover:text-primary hover:underline"
                    >
                      {record.application.candidate.fullName}
                    </Link>
                  </dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-2xs uppercase tracking-wide text-muted-foreground">Requisition</dt>
                  <dd className="text-sm">
                    <Link
                      href={`/jobs/${record.application.job.id}`}
                      className="transition-colors hover:text-primary hover:underline"
                    >
                      {record.application.job.title}
                    </Link>
                    <span className="block font-mono text-2xs text-muted-foreground">
                      {record.application.job.referenceCode}
                    </span>
                  </dd>
                </div>
                {record.application.client ? (
                  <div className="space-y-0.5">
                    <dt className="text-2xs uppercase tracking-wide text-muted-foreground">Client</dt>
                    <dd className="text-sm">
                      <Link
                        href={`/clients/${record.application.client.id}`}
                        className="transition-colors hover:text-primary hover:underline"
                      >
                        {record.application.client.name}
                      </Link>
                    </dd>
                  </div>
                ) : null}
                {record.externalInterviewer ? (
                  <div className="space-y-0.5">
                    <dt className="text-2xs uppercase tracking-wide text-muted-foreground">
                      External interviewer
                    </dt>
                    <dd className="text-sm">{record.externalInterviewer}</dd>
                  </div>
                ) : null}
              </dl>

              {record.location || record.meetingUrl ? (
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {record.location ? (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <MapPin className="size-3.5" aria-hidden="true" />
                      {record.location}
                    </span>
                  ) : null}
                  {record.meetingUrl ? (
                    <a
                      href={record.meetingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    >
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                      Join link
                    </a>
                  ) : null}
                </div>
              ) : null}

              <section className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-sm font-medium">
                  <Users className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  Panel
                </h3>
                {record.interviewers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No interviewers assigned.</p>
                ) : (
                  <ul className="space-y-2">
                    {record.interviewers.map((participant) => (
                      <li key={participant.id} className="flex items-center gap-2">
                        <Avatar className="size-6">
                          {participant.avatarUrl ? (
                            <AvatarImage src={participant.avatarUrl} alt="" />
                          ) : null}
                          <AvatarFallback className="text-[9px]">
                            {getInitials(participant.fullName)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm">{participant.fullName}</span>
                        {participant.isLead ? <Badge variant="default">Lead</Badge> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <Separator />

              <section className="space-y-3">
                <h3 className="flex items-center gap-1.5 text-sm font-medium">
                  <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  Scorecard
                </h3>
                {record.hasFeedback ? (
                  <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-0.5" aria-label={`${record.rating} out of 5`}>
                        {[1, 2, 3, 4, 5].map((value) => (
                          <Star
                            key={value}
                            className={cn(
                              'size-4',
                              value <= (record.rating ?? 0)
                                ? 'fill-warning text-warning'
                                : 'text-muted-foreground',
                            )}
                            aria-hidden="true"
                          />
                        ))}
                      </span>
                      <span className="text-xs text-muted-foreground">{record.rating} / 5</span>
                    </div>
                    {record.feedback ? <p className="text-sm">{record.feedback}</p> : null}
                    {record.strengths ? (
                      <p className="text-xs">
                        <span className="font-medium">Strengths: </span>
                        {record.strengths}
                      </p>
                    ) : null}
                    {record.concerns ? (
                      <p className="text-xs">
                        <span className="font-medium">Concerns: </span>
                        {record.concerns}
                      </p>
                    ) : null}
                    {record.feedbackAt ? (
                      <p className="text-2xs text-muted-foreground">
                        {record.submittedBy ? `${record.submittedBy.fullName} · ` : ''}
                        {formatRelativeTime(record.feedbackAt)}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No scorecard recorded yet.</p>
                )}

                {canScore && record.status !== 'CANCELLED' ? (
                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" onClick={() => setFeedbackOpen(true)}>
                      {record.hasFeedback ? 'Update scorecard' : 'Record feedback'}
                    </Button>
                  </div>
                ) : null}
              </section>

              {canUpdate && record.status !== 'CANCELLED' ? (
                <>
                  <Separator />
                  <section className="space-y-3">
                    <h3 className="text-sm font-medium">Move the status</h3>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <div className="flex-1 space-y-1.5">
                        <Label htmlFor="interview-status">New status</Label>
                        <Select
                          value={nextStatus || undefined}
                          onValueChange={(value) => setNextStatus(value as InterviewStatus)}
                        >
                          <SelectTrigger id="interview-status">
                            <SelectValue placeholder="Pick a status" />
                          </SelectTrigger>
                          <SelectContent>
                            {MANUAL_STATUSES.map((status) => (
                              <SelectItem key={status} value={status}>
                                {INTERVIEW_STATUS_LABELS[status]}
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
                  </section>
                </>
              ) : null}

              {canDelete && record.status !== 'CANCELLED' ? (
                <>
                  <Separator />
                  <ConfirmDialog
                    destructive
                    title="Cancel this interview?"
                    description="It is removed from the agenda and marked cancelled. The history stays on the application."
                    confirmLabel="Cancel interview"
                    cancelLabel="Keep it"
                    onConfirm={async () => {
                      await cancelInterview.mutateAsync();
                    }}
                    trigger={
                      <Button variant="destructive" size="sm">
                        Cancel interview
                      </Button>
                    }
                  />
                </>
              ) : null}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <InterviewFeedbackDialog
        interviewId={interviewId}
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        candidateName={record?.application.candidate.fullName ?? null}
      />
    </>
  );
}
