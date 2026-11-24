'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  JOB_STATUS_LABELS,
  JOB_STATUS_TRANSITIONS,
  jobStatusSchema,
  type JobDetail,
  type JobListItem,
  type JobStatus,
} from '@talentflow/types';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DialogTrigger } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { JobEditDialog } from '@/components/jobs/job-edit-dialog';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

/** The statuses a requisition may move to next, per the server's state machine. */
function transitionsFor(status: JobStatus): JobStatus[] {
  return (JOB_STATUS_TRANSITIONS[status] ?? []).flatMap((value) => {
    const parsed = jobStatusSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Status / clone / delete writes shared by the row menu and the header actions. */
function useJobMutations(jobId: string, onDeleted?: () => void) {
  const queryClient = useQueryClient();

  const changeStatus = useMutation({
    mutationFn: (status: JobStatus) => api.post<JobDetail>(`/jobs/${jobId}/status`, { status }),
    onSuccess: (job) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      toast.success(`${job.referenceCode} is now ${JOB_STATUS_LABELS[job.status].toLowerCase()}`);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not change the status');
    },
  });

  const clone = useMutation({
    mutationFn: () => api.post<JobDetail>(`/jobs/${jobId}/clone`, {}),
    onSuccess: (job) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      toast.success(`Cloned as ${job.referenceCode}`);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not clone this requisition');
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete<{ deleted: true }>(`/jobs/${jobId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      toast.success('Requisition deleted');
      onDeleted?.();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not delete this requisition');
    },
  });

  return { changeStatus, clone, remove };
}

function StatusItems({
  transitions,
  onSelect,
}: {
  transitions: readonly JobStatus[];
  onSelect: (status: JobStatus) => void;
}) {
  return (
    <>
      {transitions.map((status) => (
        <DropdownMenuItem key={status} onSelect={() => onSelect(status)}>
          {JOB_STATUS_LABELS[status]}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** The "⋯" menu on a requisitions list row. */
export function JobRowActionsMenu({ job }: { job: JobListItem }) {
  const { has } = useSession();
  const mutations = useJobMutations(job.id);
  const transitions = transitionsFor(job.status);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${job.title}`}>
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{job.referenceCode}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href={`/jobs/${job.id}`}>View requisition</Link>
        </DropdownMenuItem>

        {has('job:update') ? (
          <JobEditDialog
            jobId={job.id}
            trigger={
              <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </DropdownMenuItem>
            }
          />
        ) : null}

        {has('job:clone') ? (
          <DropdownMenuItem disabled={mutations.clone.isPending} onSelect={() => mutations.clone.mutate()}>
            <Copy className="size-4" aria-hidden="true" />
            Clone
          </DropdownMenuItem>
        ) : null}

        {has('job:update') && transitions.length > 0 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ArrowRightLeft className="size-4" aria-hidden="true" />
              Change status
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <StatusItems
                transitions={transitions}
                onSelect={(status) => mutations.changeStatus.mutate(status)}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}

        {has('job:delete') ? (
          <>
            <DropdownMenuSeparator />
            <ConfirmDialog
              destructive
              title={`Delete ${job.referenceCode}?`}
              description="The requisition is removed from every list. Its applications and history are retained."
              confirmLabel="Delete requisition"
              trigger={
                <DialogTrigger asChild>
                  <DropdownMenuItem destructive onSelect={(event) => event.preventDefault()}>
                    <Trash2 className="size-4" aria-hidden="true" />
                    Delete
                  </DropdownMenuItem>
                </DialogTrigger>
              }
              onConfirm={() => mutations.remove.mutateAsync().then(() => undefined)}
            />
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The status / edit / clone / delete actions on the requisition detail header. */
export function JobHeaderActions({ job }: { job: JobDetail }) {
  const { has } = useSession();
  const router = useRouter();
  const mutations = useJobMutations(job.id, () => router.push('/jobs'));
  const transitions = transitionsFor(job.status);

  return (
    <>
      {has('job:update') && transitions.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <ArrowRightLeft className="size-4" aria-hidden="true" />
              Status
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel>Move to</DropdownMenuLabel>
            <StatusItems
              transitions={transitions}
              onSelect={(status) => mutations.changeStatus.mutate(status)}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {has('job:update') ? (
        <JobEditDialog
          jobId={job.id}
          job={job}
          trigger={
            <Button variant="outline" size="sm">
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
          }
        />
      ) : null}

      {has('job:clone') ? (
        <Button
          variant="outline"
          size="sm"
          loading={mutations.clone.isPending}
          onClick={() => mutations.clone.mutate()}
        >
          <Copy className="size-4" aria-hidden="true" />
          Clone
        </Button>
      ) : null}

      {has('job:delete') ? (
        <ConfirmDialog
          destructive
          title={`Delete ${job.referenceCode}?`}
          description="The requisition is removed from every list. Its applications and history are retained."
          confirmLabel="Delete requisition"
          trigger={
            <Button variant="outline" size="sm" className="text-destructive">
              <Trash2 className="size-4" aria-hidden="true" />
              Delete
            </Button>
          }
          onConfirm={() => mutations.remove.mutateAsync().then(() => undefined)}
        />
      ) : null}
    </>
  );
}
