'use client';

import { ShieldOff } from 'lucide-react';

import { ClientForm } from '@/components/clients/client-form';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { useSession } from '@/providers/session-provider';

export default function NewClientPage() {
  const { has } = useSession();

  if (!has('client:create')) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <PageHeader
          title="New client"
          description="Add a company you recruit for."
          breadcrumbs={[{ label: 'Clients', href: '/clients' }, { label: 'New' }]}
        />
        <EmptyState
          icon={ShieldOff}
          title="You cannot create clients"
          description="Ask a workspace administrator for the “Create clients” permission."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title="New client"
        description="Capture the company, its billing details and the commercial terms that seed new requisitions."
        breadcrumbs={[{ label: 'Clients', href: '/clients' }, { label: 'New' }]}
      />
      <ClientForm />
    </div>
  );
}
