'use client';

import { ShieldOff } from 'lucide-react';

import { JobForm } from '@/components/jobs/job-form';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { useSession } from '@/providers/session-provider';

export default function NewJobPage() {
  const { has } = useSession();

  if (!has('job:create')) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <PageHeader
          title="New requisition"
          description="Create a requisition and start a pipeline for it."
          breadcrumbs={[{ label: 'Jobs', href: '/jobs' }, { label: 'New' }]}
        />
        <EmptyState
          icon={ShieldOff}
          title="You cannot create requisitions"
          description="Ask a workspace administrator for the “Create jobs” permission."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title="New requisition"
        description="Capture the role, its requirements and how it is compensated. Candidates can be added to the pipeline once it is saved."
        breadcrumbs={[{ label: 'Jobs', href: '/jobs' }, { label: 'New' }]}
      />
      <JobForm />
    </div>
  );
}
