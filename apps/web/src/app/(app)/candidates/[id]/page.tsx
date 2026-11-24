'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flame, Mail, Pencil, ShieldOff, Trash2, UserCog, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  CANDIDATE_STATUS_LABELS,
  type CandidateDetail,
  type CandidateStatus,
  type Paginated,
  type UserListItem,
} from '@talentflow/types';
import { formatDate, getInitials } from '@talentflow/ui';

import { CandidateDetailTabs } from '@/components/candidates/candidate-detail-tabs';
import { CandidateForm } from '@/components/candidates/candidate-form';
import { ComposeEmailDialog } from '@/components/email/compose-email-dialog';
import { PageHeader } from '@/components/shell/page-header';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const STATUS_VARIANT: Record<CandidateStatus, BadgeProps['variant']> = {
  ACTIVE: 'success',
  PASSIVE: 'secondary',
  DO_NOT_CONTACT: 'destructive',
  PLACED: 'info',
  ARCHIVED: 'muted',
};

const UNASSIGNED = '__unassigned__';

/** Edit / reassign-owner / delete controls for the candidate detail header. */
function CandidateHeaderActions({ candidate }: { candidate: CandidateDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { has } = useSession();

  const canUpdate = has('candidate:update');
  const canDelete = has('candidate:delete');

  const [editOpen, setEditOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [ownerId, setOwnerId] = useState(UNASSIGNED);

  useEffect(() => {
    if (ownerOpen) setOwnerId(candidate.owner?.id ?? UNASSIGNED);
  }, [ownerOpen, candidate.owner]);

  const users = useQuery({
    queryKey: queryKeys.users.list({ pageSize: 100, status: 'ACTIVE' }),
    queryFn: () =>
      api.get<Paginated<UserListItem>>('/users', { query: { pageSize: 100, status: 'ACTIVE' } }),
    enabled: ownerOpen && canUpdate,
    staleTime: 60_000,
  });

  const reassign = useMutation({
    mutationFn: () =>
      api.patch<CandidateDetail>(`/candidates/${candidate.id}/owner`, {
        ownerId: ownerId === UNASSIGNED ? null : ownerId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.candidates.all });
      toast.success('Owner updated');
      setOwnerOpen(false);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not update the owner');
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete<{ deleted: true }>(`/candidates/${candidate.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.candidates.all });
      toast.success('Candidate deleted');
      router.push('/candidates');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not delete this candidate');
    },
  });

  const owners = users.data?.items ?? [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canUpdate ? (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Edit candidate</DialogTitle>
              <DialogDescription>Update the profile for {candidate.fullName}.</DialogDescription>
            </DialogHeader>
            <CandidateForm
              mode="edit"
              candidate={candidate}
              onSuccess={() => setEditOpen(false)}
              onCancel={() => setEditOpen(false)}
            />
          </DialogContent>
        </Dialog>
      ) : null}

      {canUpdate ? (
        <Dialog open={ownerOpen} onOpenChange={setOwnerOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <UserCog className="size-4" aria-hidden="true" />
              Reassign
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Reassign owner</DialogTitle>
              <DialogDescription>
                Choose the recruiter who owns {candidate.fullName}.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="candidate-owner">Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger id="candidate-owner">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {owners.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {users.isError ? (
                <p className="text-xs text-destructive">Could not load people. Close and try again.</p>
              ) : null}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOwnerOpen(false)} disabled={reassign.isPending}>
                Cancel
              </Button>
              <Button
                loading={reassign.isPending}
                disabled={users.isPending}
                onClick={() => reassign.mutate()}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {canDelete ? (
        <ConfirmDialog
          destructive
          title={`Delete ${candidate.fullName}?`}
          description="The candidate is archived and removed from the talent pool. Resumes and history are retained."
          confirmLabel="Delete candidate"
          trigger={
            <Button variant="outline" size="sm" className="text-destructive">
              <Trash2 className="size-4" aria-hidden="true" />
              Delete
            </Button>
          }
          onConfirm={() => remove.mutateAsync().then(() => undefined)}
        />
      ) : null}
    </div>
  );
}

export default function CandidateDetailPage() {
  const params = useParams();
  const candidateId = typeof params.id === 'string' ? params.id : (params.id?.[0] ?? '');
  const { has, tenant } = useSession();

  const canRead = has('candidate:read_all') || has('candidate:read_own');

  const candidate = useQuery({
    queryKey: queryKeys.candidates.detail(candidateId),
    queryFn: () => api.get<CandidateDetail>(`/candidates/${candidateId}`),
    enabled: canRead && candidateId.length > 0,
  });

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader
          title="Candidate"
          breadcrumbs={[{ label: 'Candidates', href: '/candidates' }, { label: 'Candidate' }]}
        />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to this candidate"
          description="Ask a workspace administrator for the “View candidates” permission."
        />
      </div>
    );
  }

  if (candidate.isPending) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6" aria-busy="true">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (candidate.isError || !candidate.data) {
    const notFound = candidate.error instanceof ApiError && candidate.error.isNotFound;
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader
          title="Candidate"
          breadcrumbs={[{ label: 'Candidates', href: '/candidates' }, { label: 'Candidate' }]}
        />
        <EmptyState
          icon={notFound ? UserRound : ShieldOff}
          title={notFound ? 'Candidate not found' : 'Could not load this candidate'}
          description={
            notFound
              ? 'This record may have been merged into another candidate or removed.'
              : candidate.error instanceof Error
                ? candidate.error.message
                : 'Please try again in a moment.'
          }
          action={
            <div className="flex items-center gap-2">
              {notFound ? null : (
                <Button variant="outline" size="sm" onClick={() => void candidate.refetch()}>
                  Retry
                </Button>
              )}
              <Button asChild variant="ghost" size="sm">
                <Link href="/candidates">Back to candidates</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const record = candidate.data;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        title={record.fullName}
        description={
          [record.currentTitle, record.currentCompany, record.location].filter(Boolean).join(' · ') ||
          'Candidate profile'
        }
        breadcrumbs={[{ label: 'Candidates', href: '/candidates' }, { label: record.fullName }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ComposeEmailDialog
              entityType="CANDIDATE"
              entityId={record.id}
              candidateId={record.id}
              defaultTo={record.email ?? undefined}
              trigger={
                <Button variant="outline" size="sm">
                  <Mail className="size-4" aria-hidden="true" />
                  Send email
                </Button>
              }
            />
            <CandidateHeaderActions candidate={record} />
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[record.status]}>{CANDIDATE_STATUS_LABELS[record.status]}</Badge>
        {record.isHot ? (
          <Badge variant="destructive">
            <Flame className="size-3" aria-hidden="true" />
            Hot
          </Badge>
        ) : null}
        {record.experienceLevel ? <Badge variant="outline">{record.experienceLevel}</Badge> : null}
        {record.lists.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            {record.lists.length} hotlist{record.lists.length === 1 ? '' : 's'}
          </span>
        ) : null}
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {record.owner ? (
            <>
              <Avatar className="size-5">
                {record.owner.avatarUrl ? <AvatarImage src={record.owner.avatarUrl} alt="" /> : null}
                <AvatarFallback className="text-[9px]">
                  {getInitials(record.owner.fullName)}
                </AvatarFallback>
              </Avatar>
              {record.owner.fullName}
            </>
          ) : (
            'Unassigned'
          )}
          <span aria-hidden="true">·</span>
          {`Added ${formatDate(record.createdAt, 'DD MMM YYYY', tenant?.timezone)}`}
        </span>
      </div>

      <CandidateDetailTabs candidate={record} />
    </div>
  );
}
