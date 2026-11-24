'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, Mail, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { CLIENT_STATUS_LABELS, type ClientDetail } from '@talentflow/types';

import { ActivityTimeline } from '@/components/activity/activity-timeline';
import { ClientHeaderActions } from '@/components/clients/client-actions-menu';
import { ClientContactsPanel } from '@/components/clients/client-contacts-panel';
import { ClientJobsPanel, ClientOverview } from '@/components/clients/client-overview';
import { ComposeEmailDialog } from '@/components/email/compose-email-dialog';
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

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  PROSPECT: 'info',
  ACTIVE: 'success',
  INACTIVE: 'muted',
  CHURNED: 'destructive',
};

export default function ClientDetailPage() {
  const params = useParams();
  const clientId = typeof params.id === 'string' ? params.id : (params.id?.[0] ?? '');
  const { has } = useSession();

  const canRead = has('client:read_all') || has('client:read_own');

  const client = useQuery({
    queryKey: queryKeys.clients.detail(clientId),
    queryFn: () => api.get<ClientDetail>(`/clients/${clientId}`),
    enabled: canRead && clientId.length > 0,
  });

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader title="Client" breadcrumbs={[{ label: 'Clients', href: '/clients' }, { label: 'Client' }]} />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to this client"
          description="Ask a workspace administrator for the “View clients” permission."
        />
      </div>
    );
  }

  if (client.isPending) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6" aria-busy="true">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (client.isError || !client.data) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader title="Client" breadcrumbs={[{ label: 'Clients', href: '/clients' }, { label: 'Client' }]} />
        <EmptyState
          icon={Building2}
          title="Could not load this client"
          description={client.error instanceof Error ? client.error.message : 'Please try again in a moment.'}
          action={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void client.refetch()}>
                Retry
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/clients">Back to clients</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const record = client.data;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        title={record.name}
        description={[record.industry, record.city, record.country].filter(Boolean).join(' · ') || undefined}
        breadcrumbs={[{ label: 'Clients', href: '/clients' }, { label: record.name }]}
        actions={
          <div className="flex items-center gap-2">
            <ComposeEmailDialog
              entityType="CLIENT"
              entityId={record.id}
              trigger={
                <Button variant="outline" size="sm">
                  <Mail className="size-4" aria-hidden="true" />
                  Send email
                </Button>
              }
            />
            <ClientHeaderActions client={record} />
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[record.status] ?? 'muted'}>
          {CLIENT_STATUS_LABELS[record.status]}
        </Badge>
        {record.legalName ? <Badge variant="outline">{record.legalName}</Badge> : null}
        <span className="text-xs text-muted-foreground">
          {record.contactCount} {record.contactCount === 1 ? 'contact' : 'contacts'} · {record.openJobs} open{' '}
          {record.openJobs === 1 ? 'requisition' : 'requisitions'}
        </span>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <ClientOverview client={record} />
        </TabsContent>

        <TabsContent value="contacts">
          <ClientContactsPanel client={record} />
        </TabsContent>

        <TabsContent value="jobs">
          <ClientJobsPanel client={record} />
        </TabsContent>

        <TabsContent value="activity">
          <ActivityTimeline entityType="CLIENT" entityId={record.id} />
        </TabsContent>

        <TabsContent value="notes">
          <NotesPanel entityType="CLIENT" entityId={record.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
