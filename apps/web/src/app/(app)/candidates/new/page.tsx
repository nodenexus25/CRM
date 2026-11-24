'use client';

import { ShieldOff } from 'lucide-react';

import { CandidateForm } from '@/components/candidates/candidate-form';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { useSession } from '@/providers/session-provider';

export default function NewCandidatePage() {
  const { has } = useSession();

  if (!has('candidate:create')) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <PageHeader
          title="New candidate"
          description="Add a person to the talent pool."
          breadcrumbs={[{ label: 'Candidates', href: '/candidates' }, { label: 'New' }]}
        />
        <EmptyState
          icon={ShieldOff}
          title="You cannot create candidates"
          description="Ask a workspace administrator for the “Create candidates” permission."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title="New candidate"
        description="Capture the profile, contact details, rate expectations and availability. Experience, education and skills are added from the candidate's profile once it is saved."
        breadcrumbs={[{ label: 'Candidates', href: '/candidates' }, { label: 'New' }]}
      />
      <CandidateForm mode="create" />
    </div>
  );
}
