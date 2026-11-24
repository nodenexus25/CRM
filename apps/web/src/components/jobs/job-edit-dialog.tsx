'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import type { JobDetail } from '@talentflow/types';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { JobForm } from '@/components/jobs/job-form';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

interface JobEditDialogProps {
  jobId: string;
  /** Prefetched on the detail page; the list rows let the dialog fetch it. */
  job?: JobDetail;
  trigger: ReactNode;
}

/** Opens the requisition form in edit mode; the dialog owns its open state. */
export function JobEditDialog({ jobId, job, trigger }: JobEditDialogProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const detail = useQuery({
    queryKey: queryKeys.jobs.detail(jobId),
    queryFn: () => api.get<JobDetail>(`/jobs/${jobId}`),
    enabled: open,
    initialData: job,
  });

  const current = job ?? detail.data;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit requisition</DialogTitle>
          <DialogDescription>
            Update the details of {current ? current.referenceCode : 'this requisition'}. Use the
            status menu to move it through its lifecycle.
          </DialogDescription>
        </DialogHeader>

        {current ? (
          <JobForm
            mode="edit"
            job={current}
            onSuccess={() => {
              void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.detail(jobId) });
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        ) : detail.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <p className="text-sm text-destructive">
            {detail.error instanceof Error ? detail.error.message : 'Could not load this requisition.'}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
