'use client';

import { useQuery } from '@tanstack/react-query';
import { BriefcaseBusiness, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import {
  JOB_STATUS_LABELS,
  JOB_TYPE_LABELS,
  PRIORITY_LABELS,
  REMOTE_TYPE_LABELS,
  type JobDetail,
  type JobStats,
  type JobStatus,
  type Priority,
} from '@talentflow/types';

import { ActivityTimeline } from '@/components/activity/activity-timeline';
import { JobHeaderActions } from '@/components/jobs/job-actions-menu';
import { JobBoard } from '@/components/jobs/job-board';
import { JobOverview } from '@/components/jobs/job-overview';
import { NotesPanel } from '@/components/notes/notes-panel';
import { PageHeader } from '@/components/shell/page-header';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const STATUS_VARIANT: Record<JobStatus, BadgeProps['variant']> = {
  DRAFT: 'muted',
  OPEN: 'success',
  ON_HOLD: 'warning',
  CLOSED: 'muted',
  FILLED: 'info',
  CANCELLED: 'destructive',
};

const PRIORITY_VARIANT: Record<Priority, BadgeProps['variant']> = {
  LOW: 'muted',
  MEDIUM: 'secondary',
  HIGH: 'warning',
  URGENT: 'destructive',
};

export default function JobDetailPage() {
  const params = useParams();
  const jobId = typeof params.id === 'string' ? params.id : (params.id?.[0] ?? '');
  const { has } = useSession();

  const canRead = has('job:read_all') || has('job:read_own');

  const job = useQuery({
    queryKey: queryKeys.jobs.detail(jobId),
    queryFn: () => api.get<JobDetail>(`/jobs/${jobId}`),
    enabled: canRead && jobId.length > 0,
  });

  const stats = useQuery({
    queryKey: queryKeys.jobs.stats(jobId),
    queryFn: () => api.get<JobStats>(`/jobs/${jobId}/stats`),
    enabled: canRead && jobId.length > 0,
    staleTime: 30_000,
  });

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader
          title="Requisition"
          breadcrumbs={[{ label: 'Jobs', href: '/jobs' }, { label: 'Requisition' }]}
        />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to this requisition"
          description="Ask a workspace administrator for the “View jobs” permission."
        />
      </div>
    );
  }

  if (job.isPending) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6" aria-busy="true">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (job.isError || !job.data) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader
          title="Requisition"
          breadcrumbs={[{ label: 'Jobs', href: '/jobs' }, { label: 'Requisition' }]}
        />
        <EmptyState
          icon={BriefcaseBusiness}
          title="Could not load this requisition"
          description={job.error instanceof Error ? job.error.message : 'Please try again in a moment.'}
          action={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void job.refetch()}>
                Retry
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/jobs">Back to jobs</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const record = job.data;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        title={record.title}
        description={[
          record.referenceCode,
          JOB_TYPE_LABELS[record.jobType],
          REMOTE_TYPE_LABELS[record.remoteType],
          record.location,
        ]
          .filter(Boolean)
          .join(' · ')}
        breadcrumbs={[{ label: 'Jobs', href: '/jobs' }, { label: record.referenceCode }]}
        actions={<JobHeaderActions job={record} />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[record.status]}>{JOB_STATUS_LABELS[record.status]}</Badge>
        <Badge variant={PRIORITY_VARIANT[record.priority]}>{PRIORITY_LABELS[record.priority]}</Badge>
        {record.client ? <Badge variant="outline">{record.client.name}</Badge> : null}
        <span className="text-xs text-muted-foreground">
          {record.applicantCount} in pipeline
          {record.newApplicantCount > 0 ? ` · ${record.newApplicantCount} new` : ''}
        </span>
      </div>

      <Tabs defaultValue="pipeline" className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline">
          <JobBoard jobId={record.id} />
        </TabsContent>

        <TabsContent value="overview">
          <JobOverview job={record} stats={stats.data} />
        </TabsContent>

        <TabsContent value="activity">
          <ActivityTimeline entityType="JOB" entityId={record.id} />
        </TabsContent>

        <TabsContent value="notes">
          <NotesPanel entityType="JOB" entityId={record.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
