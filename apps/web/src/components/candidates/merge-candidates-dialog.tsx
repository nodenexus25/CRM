'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GitMerge } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import {
  CANDIDATE_STATUS_LABELS,
  type CandidateDetail,
  type CandidateListItem,
  type CandidateStatus,
} from '@talentflow/types';
import { cn, formatDate, getInitials } from '@talentflow/ui';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const STATUS_VARIANT: Record<CandidateStatus, BadgeProps['variant']> = {
  ACTIVE: 'success',
  PASSIVE: 'secondary',
  DO_NOT_CONTACT: 'destructive',
  PLACED: 'info',
  ARCHIVED: 'muted',
};

function orDash(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : '—';
}

/** One label/value pair in a candidate column. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

interface MergeCandidatesDialogProps {
  /** The records to merge; the first is suggested as the surviving record. */
  candidates: CandidateListItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Side-by-side merge. The recruiter picks which record survives; every other
 * selected candidate is absorbed into it and soft-deleted by the API. Child
 * records (emails, phones, experiences) are all retained by default so nothing
 * is lost in the merge.
 */
export function MergeCandidatesDialog({
  candidates,
  open,
  onOpenChange,
}: MergeCandidatesDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tenant } = useSession();

  const [primaryId, setPrimaryId] = useState('');
  const [keepAllChildRecords, setKeepAllChildRecords] = useState(true);

  useEffect(() => {
    if (!open) return;
    setPrimaryId(candidates[0]?.id ?? '');
    setKeepAllChildRecords(true);
  }, [open, candidates]);

  const merge = useMutation({
    mutationFn: () =>
      api.post<CandidateDetail>('/candidates/merge', {
        primaryId,
        duplicateIds: candidates.filter((entry) => entry.id !== primaryId).map((entry) => entry.id),
        fieldSources: {},
        keepAllChildRecords,
      }),
    onSuccess: (merged) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.candidates.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.candidateLists.all });
      toast.success(`Merged into ${merged.fullName}`);
      onOpenChange(false);
      router.push(`/candidates/${merged.id}`);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not merge these candidates');
    },
  });

  const mergeable = candidates.length >= 2 && primaryId.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="size-4 text-primary" aria-hidden="true" />
            Merge candidates
          </DialogTitle>
          <DialogDescription>
            Choose the record to keep. Emails, phone numbers, experience and every other child record
            from the merged candidates are folded into it, then the duplicates are archived.
          </DialogDescription>
        </DialogHeader>

        {candidates.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Select at least two candidates to merge them.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {candidates.map((candidate) => {
              const isPrimary = candidate.id === primaryId;
              return (
                <label
                  key={candidate.id}
                  className={cn(
                    'flex cursor-pointer flex-col gap-3 rounded-lg border p-4 transition-colors',
                    'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
                    isPrimary ? 'border-primary/50 bg-primary/5' : 'border-border',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Avatar className="size-8">
                        {candidate.owner?.avatarUrl ? (
                          <AvatarImage src={candidate.owner.avatarUrl} alt="" />
                        ) : null}
                        <AvatarFallback className="text-[10px]">
                          {getInitials(candidate.fullName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">{candidate.fullName}</span>
                    </div>
                    <input
                      type="radio"
                      name="merge-primary"
                      className="size-4 accent-primary"
                      checked={isPrimary}
                      onChange={() => setPrimaryId(candidate.id)}
                      aria-label={`Keep ${candidate.fullName} as the primary record`}
                    />
                  </div>

                  <dl className="space-y-2">
                    <Field label="Email">{orDash(candidate.email)}</Field>
                    <Field label="Phone">{orDash(candidate.phone)}</Field>
                    <Field label="Company">{orDash(candidate.currentCompany)}</Field>
                    <Field label="Title">{orDash(candidate.currentTitle)}</Field>
                    <Field label="Status">
                      <Badge variant={STATUS_VARIANT[candidate.status]}>
                        {CANDIDATE_STATUS_LABELS[candidate.status]}
                      </Badge>
                    </Field>
                    <Field label="Owner">{orDash(candidate.owner?.fullName)}</Field>
                    <Field label="Created">
                      {formatDate(candidate.createdAt, 'DD MMM YYYY', tenant?.timezone)}
                    </Field>
                  </dl>

                  {isPrimary ? (
                    <p className="text-2xs font-medium text-primary">Surviving record</p>
                  ) : (
                    <p className="text-2xs text-muted-foreground">Will be merged and archived</p>
                  )}
                </label>
              );
            })}
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3">
          <Checkbox
            checked={keepAllChildRecords}
            onCheckedChange={(checked) => setKeepAllChildRecords(checked === true)}
            aria-label="Keep every child record"
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">Keep every email, phone and history entry</span>
            <span className="block text-xs text-muted-foreground">
              Recommended. Turn this off to keep only the surviving record&apos;s children.
            </span>
          </span>
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={merge.isPending}>
            Cancel
          </Button>
          <Button
            loading={merge.isPending}
            disabled={!mergeable}
            onClick={() => merge.mutate()}
          >
            Merge {candidates.length} candidates
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
