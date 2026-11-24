'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, FileUser, Mail, ShieldOff, Star } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';

import {
  APPLICATION_STATUS_LABELS,
  INTERVIEW_STATUS_LABELS,
  INTERVIEW_TYPE_LABELS,
  SUBMISSION_STATUS_LABELS,
  type ApplicationDetail,
  type ApplicationStatus,
  type InterviewStatus,
  type InterviewType,
  type SubmissionStatus,
} from '@talentflow/types';
import { cn, formatDate, formatDateTime, getInitials, humanizeEnum } from '@talentflow/ui';

import { ActivityTimeline } from '@/components/activity/activity-timeline';
import { ComposeEmailDialog } from '@/components/email/compose-email-dialog';
import { NotesPanel } from '@/components/notes/notes-panel';
import { OfferPanel } from '@/components/offers/offer-panel';
import { PageHeader } from '@/components/shell/page-header';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const APPLICATION_STATUS_VARIANT: Record<ApplicationStatus, BadgeProps['variant']> = {
  ACTIVE: 'success',
  ON_HOLD: 'warning',
  REJECTED: 'destructive',
  WITHDRAWN: 'muted',
  PLACED: 'info',
};

const SUBMISSION_STATUS_VARIANT: Record<SubmissionStatus, BadgeProps['variant']> = {
  DRAFT: 'muted',
  SUBMITTED: 'info',
  CLIENT_VIEWED: 'info',
  SHORTLISTED: 'success',
  INTERVIEWING: 'secondary',
  OFFERED: 'success',
  REJECTED: 'destructive',
  WITHDRAWN: 'muted',
};

const INTERVIEW_STATUS_VARIANT: Record<InterviewStatus, BadgeProps['variant']> = {
  SCHEDULED: 'info',
  CONFIRMED: 'success',
  COMPLETED: 'muted',
  CANCELLED: 'destructive',
  NO_SHOW: 'destructive',
  RESCHEDULED: 'warning',
};

/**
 * One application in full: who the candidate is, where they sit in the
 * requisition, the offers raised and the placement it produced, their
 * interviews and everything logged against them.
 */
export default function ApplicationDetailPage() {
  const params = useParams();
  const applicationId = typeof params.id === 'string' ? params.id : (params.id?.[0] ?? '');
  const { has, tenant } = useSession();

  const canRead = has('application:read_all') || has('application:read_own');

  const application = useQuery({
    queryKey: queryKeys.applications.detail(applicationId),
    queryFn: () => api.get<ApplicationDetail>(`/applications/${applicationId}`),
    enabled: canRead && applicationId.length > 0,
    staleTime: 15_000,
  });

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader
          title="Application"
          breadcrumbs={[{ label: 'Submissions', href: '/submissions' }, { label: 'Application' }]}
        />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to this application"
          description="Ask a workspace administrator for the “View applications” permission."
        />
      </div>
    );
  }

  if (application.isPending) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6" aria-busy="true">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (application.isError || !application.data) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader
          title="Application"
          breadcrumbs={[{ label: 'Submissions', href: '/submissions' }, { label: 'Application' }]}
        />
        <EmptyState
          icon={FileUser}
          title="Could not load this application"
          description={
            application.error instanceof Error ? application.error.message : 'Please try again.'
          }
          action={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void application.refetch()}>
                Retry
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/submissions">Back to submissions</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const record = application.data;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        title={record.candidate.fullName}
        description={`${record.job.title} · ${record.job.referenceCode}`}
        breadcrumbs={[
          { label: 'Jobs', href: '/jobs' },
          { label: record.job.referenceCode, href: `/jobs/${record.job.id}` },
          { label: record.candidate.fullName },
        ]}
        actions={
          <ComposeEmailDialog
            entityType="APPLICATION"
            entityId={record.id}
            candidateId={record.candidate.id}
            jobId={record.job.id}
            defaultTo={record.candidate.email ?? undefined}
            trigger={
              <Button variant="outline" size="sm">
                <Mail className="size-4" aria-hidden="true" />
                Send email
              </Button>
            }
          />
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={APPLICATION_STATUS_VARIANT[record.status]}>
          {APPLICATION_STATUS_LABELS[record.status]}
        </Badge>
        <Badge variant={SUBMISSION_STATUS_VARIANT[record.submissionStatus]}>
          {SUBMISSION_STATUS_LABELS[record.submissionStatus]}
        </Badge>
        <Badge variant="outline">
          <span
            className="size-2 rounded-full border border-black/10"
            style={{ backgroundColor: record.stage.color }}
            aria-hidden="true"
          />
          {record.stage.name}
        </Badge>
        {record.slaBreached ? <Badge variant="destructive">SLA breached</Badge> : null}
        <span className="text-xs text-muted-foreground">
          {record.daysInStage === 0 ? 'Entered this stage today' : `${record.daysInStage}d in stage`}
        </span>
        {record.owner ? (
          <span className="text-xs text-muted-foreground">· Owner {record.owner.fullName}</span>
        ) : null}
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="offers">Offers &amp; placement</TabsTrigger>
          <TabsTrigger value="interviews">Interviews</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Candidate</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Avatar className="size-12">
                    {record.candidate.avatarUrl ? (
                      <AvatarImage src={record.candidate.avatarUrl} alt="" />
                    ) : null}
                    <AvatarFallback>{getInitials(record.candidate.fullName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <Link
                      href={`/candidates/${record.candidate.id}`}
                      className="block truncate text-sm font-medium transition-colors hover:text-primary hover:underline"
                    >
                      {record.candidate.fullName}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {record.candidate.email ?? 'No email on file'}
                    </p>
                  </div>
                </div>

                <Separator />

                <dl className="grid gap-3 sm:grid-cols-2">
                  <Field label="Requisition">
                    <Link
                      href={`/jobs/${record.job.id}`}
                      className="transition-colors hover:text-primary hover:underline"
                    >
                      {record.job.title}
                    </Link>
                    <span className="block font-mono text-2xs text-muted-foreground">
                      {record.job.referenceCode}
                    </span>
                  </Field>
                  <Field label="Source">
                    {record.source ? humanizeEnum(record.source) : 'Not recorded'}
                  </Field>
                  <Field label="Applied">
                    {formatDate(record.appliedAt, 'DD MMM YYYY', tenant?.timezone)}
                  </Field>
                  <Field label="Submitted to client">
                    {record.submittedAt
                      ? formatDateTime(record.submittedAt, tenant?.timezone)
                      : 'Not submitted'}
                  </Field>
                  <Field label="Rating">
                    {record.rating ? (
                      <span className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }).map((_, index) => (
                          <Star
                            key={index}
                            className={cn(
                              'size-3.5',
                              index < (record.rating ?? 0)
                                ? 'fill-warning text-warning'
                                : 'text-muted-foreground/40',
                            )}
                            aria-hidden="true"
                          />
                        ))}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {record.rating}/5
                        </span>
                      </span>
                    ) : (
                      'Not rated'
                    )}
                  </Field>
                  <Field label="Résumé">{record.resumeId ? 'Attached' : 'None attached'}</Field>
                </dl>

                {record.clientFeedback ? (
                  <div className="rounded-md border border-border bg-muted/40 p-3">
                    <p className="text-2xs uppercase tracking-wide text-muted-foreground">
                      Client feedback
                    </p>
                    <p className="mt-1 text-sm">{record.clientFeedback}</p>
                    {record.clientFeedbackAt ? (
                      <p className="mt-1 text-2xs text-muted-foreground">
                        {formatDateTime(record.clientFeedbackAt, tenant?.timezone)}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {record.rejectedReason ? (
                  <p className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                    Rejected: {record.rejectedReason}
                    {record.rejectedAt
                      ? ` · ${formatDate(record.rejectedAt, 'DD MMM YYYY', tenant?.timezone)}`
                      : ''}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Stage history</CardTitle>
              </CardHeader>
              <CardContent>
                {record.history.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No stage moves recorded yet.</p>
                ) : (
                  <ol className="space-y-4">
                    {record.history.map((entry) => (
                      <li key={entry.id} className="flex gap-3">
                        <span
                          className="mt-1 size-2.5 shrink-0 rounded-full border border-black/10"
                          style={{ backgroundColor: entry.toStage.color }}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="truncate text-sm">
                            {entry.fromStage ? (
                              <>
                                <span className="text-muted-foreground">{entry.fromStage.name}</span>
                                {' → '}
                              </>
                            ) : null}
                            <span className="font-medium">{entry.toStage.name}</span>
                          </p>
                          {entry.note ? (
                            <p className="text-xs text-muted-foreground">{entry.note}</p>
                          ) : null}
                          <p className="text-2xs text-muted-foreground">
                            {entry.changedBy ? `${entry.changedBy.fullName} · ` : ''}
                            {formatDateTime(entry.createdAt, tenant?.timezone)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="offers">
          <OfferPanel applicationId={record.id} />
        </TabsContent>

        <TabsContent value="interviews">
          {record.interviews.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No interviews scheduled"
              description="Interviews booked for this candidate will appear here."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/interviews">Open interviews</Link>
                </Button>
              }
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Interviews</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-4">
                  {record.interviews.map((interview) => (
                    <li key={interview.id} className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <p className="truncate text-sm font-medium">
                          {interview.title ??
                            `${INTERVIEW_TYPE_LABELS[interview.type as InterviewType] ?? interview.type} · Round ${interview.round}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {interview.scheduledAt
                            ? formatDateTime(interview.scheduledAt, tenant?.timezone)
                            : 'Not scheduled'}
                        </p>
                      </div>
                      <Badge
                        variant={
                          INTERVIEW_STATUS_VARIANT[interview.status as InterviewStatus] ?? 'muted'
                        }
                      >
                        {INTERVIEW_STATUS_LABELS[interview.status as InterviewStatus] ??
                          interview.status}
                      </Badge>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="activity">
          <ActivityTimeline entityType="APPLICATION" entityId={record.id} />
        </TabsContent>

        <TabsContent value="notes">
          <NotesPanel
            entityType="APPLICATION"
            entityId={record.id}
            candidateId={record.candidate.id}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}
